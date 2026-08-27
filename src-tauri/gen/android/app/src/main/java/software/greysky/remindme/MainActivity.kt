package software.greysky.remindme

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.RecognizerIntent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import java.time.Instant
import org.json.JSONObject

private const val HANDLED_ACTION_KEY = "handledNotificationAction"

/**
 * Internal-only action VoiceQuickCreateActivity uses to hand a parsed voice
 * transcript to MainActivity when Settings' "Auto-create from widget voice"
 * is off — an explicit component Intent, never a public deep link, since
 * unlike remindme://create this isn't part of the documented automation
 * surface (README.md#automation) and has no business being reachable from
 * outside the app. Reuses CreateReminderReceiver's EXTRA_DETAILS/EXTRA_FIRE_AT
 * constants rather than duplicating them. Not private: VoiceQuickCreateActivity
 * needs it too, and top-level `private` in Kotlin is file-scoped, not
 * package-scoped (same reason ACTION_CREATE_REMINDER isn't private).
 */
const val ACTION_VOICE_PREFILL = "software.greysky.remindme.VOICE_PREFILL"

/**
 * A `remindme://` deep link, ACTION_SEND share-text hand-off, or the widget's
 * voice-prefill request (ACTION_VOICE_PREFILL), parsed from the launching
 * intent (PLAN.md, phase 1; the `reminders` host is phases 5 and 6).
 * `replayKey` is what makes the request idempotent across a replayed intent
 * (see fingerprint()) — the full URI for a deep link (a caller-supplied `key`
 * query param just rides along as part of it), or the shared text itself for
 * a share.
 */
private data class CreateRequest(
  val details: String?,
  val atMillis: Long?,
  val source: String,
  val replayKey: String,
  /**
   * Which surface the request asks for: "new" (the New Reminder form) or
   * "list" (the scheduled-reminder list, PLAN.md phase 5). A "list" request
   * is navigation and nothing else — see extractCreateRequest, which reads
   * only `id` from that host's query string.
   */
  val target: String,
  /**
   * Which reminder a "list" request wants opened, from `?id=` (PLAN.md,
   * phase 6 — a widget row asking for its own reminder's details dialog).
   * Null everywhere else, and null for an id that did not parse: a miss just
   * shows the plain list.
   */
  val reminderId: Long? = null,
) {
  /**
   * Whether this request would actually create a reminder. A bare
   * `remindme://create` with no details — what the launcher shortcut sends
   * (PLAN.md, phase 2) — only asks the frontend to open the New Reminder
   * form, so it stays out of the replay guard: dedup is meaningless for a
   * request that creates nothing, and its replayKey is a constant, which
   * has no business occupying the single handled-fingerprint slot a real
   * create needs. Blank-handling matches normalizeDetails() in
   * src/lib/createRequest.ts so both sides agree on where "create" ends and
   * "navigate" begins.
   */
  val isCreate: Boolean
    get() = !details.isNullOrBlank()
}

// Arbitrary but distinctive request codes for the backup document pickers and
// the voice-capture recognizer; results for codes we don't own fall through
// to super (Tauri plugins).
private const val REQUEST_EXPORT_BACKUP = 41001
private const val REQUEST_IMPORT_BACKUP = 41002
private const val REQUEST_VOICE_CAPTURE = 41003

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  /**
   * Notification action tap waiting to be handed to the frontend as
   * `window.androidNotificationAction(id, actionId)`.
   *
   * The notification plugin's own "actionPerformed" event cannot be used for
   * this: on a cold start it fires during plugin load — before any JS
   * listener exists — and is dropped (no buffering), and its payload never
   * includes the notification id anyway (`sourceJson` is never populated in
   * plugin 2.3.3). The intent extras carry everything needed, so this bridge
   * delivers them itself, retrying until the frontend has booted far enough
   * to register the handler (see src/lib/notifications.ts).
   */
  private var pendingNotificationAction: Pair<Int, String>? = null

  /** Fingerprint ("id|actionId") of the action already delivered by this task. */
  private var handledActionFingerprint: String? = null

  /**
   * Create request (deep link / share) waiting to be handed to the frontend
   * as `window.androidCreateRequest(request)`. Same cold-start problem as a
   * notification action tap — a caller-launched intent can just as easily
   * arrive before the webview exists — so it gets the same retry treatment.
   */
  private var pendingCreateRequest: CreateRequest? = null

  /** Backup JSON waiting for the user to pick a destination in the SAF dialog. */
  private var pendingExportJson: String? = null

  /**
   * Nudges the frontend to drain the pending-ops journal the moment a receiver
   * writes to it — a background snooze (SnoozeActionReceiver) or a headless
   * create (CreateReminderReceiver).
   *
   * The frontend also drains at startup and from androidResume, which covers an
   * entry written while the app was dead or backgrounded. Neither covers the
   * remaining case: the app is in the foreground when it lands. Snoozing from
   * the shade never pauses the Activity (the shade is an overlay) and a
   * broadcast from another app doesn't either, so no resume ever arrives —
   * without this the reminder list would sit stale until the user navigated
   * away and back.
   */
  private val pendingOpsReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      webView?.evaluateJavascript("window.androidPendingOps && window.androidPendingOps()", null)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // The app bar is always black, so force light status-bar icons instead of
    // letting them follow the system theme (dark icons vanish on black).
    enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
    super.onCreate(savedInstanceState)

    // TauriActivity disables Tauri's own back handling (handleBackNavigation
    // = false), so without a callback every press would finish the activity.
    // Ask the frontend first; it returns "true" when the press was consumed
    // by in-app navigation (see src/lib/androidBack.ts).
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = webView
        if (wv == null) {
          moveTaskToBack(true)
          return
        }
        wv.evaluateJavascript(
          "window.androidBackHandler ? window.androidBackHandler() : false"
        ) { handled ->
          if (handled != "true") moveTaskToBack(true)
        }
      }
    })

    // Guard against replaying a stale action intent. A tap while the process
    // is dead recreates the activity with the notification intent, and
    // savedInstanceState may well be non-null (saved state survives process
    // death), so that alone cannot distinguish a fresh tap from a replay:
    //  - relaunch from Recents redelivers the task's base intent, flagged
    //    LAUNCHED_FROM_HISTORY;
    //  - in-process recreation redelivers the same intent together with the
    //    instance state that recorded it as already handled.
    ContextCompat.registerReceiver(
      this,
      pendingOpsReceiver,
      IntentFilter(PENDING_OPS_UPDATED),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )

    // Restore before comparing, and keep the restored value: without this the
    // guard survives exactly one recreation. The suppressed pass records
    // nothing (capture is skipped), so the *next* onSaveInstanceState writes
    // null, and the recreation after that sees no match and replays the
    // intent — a second duplicate reminder, one config change later.
    handledActionFingerprint = savedInstanceState?.getString(HANDLED_ACTION_KEY)

    val fromHistory = intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
    val currentFingerprint = fingerprint(intent)
    val alreadyHandled = currentFingerprint != null && handledActionFingerprint == currentFingerprint
    if (!fromHistory && !alreadyHandled) captureIncomingIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // Neither Activity nor TauriActivity/WryActivity calls setIntent, so
    // without this getIntent() would still return the *launch* intent after a
    // recreation. The replay guard reads getIntent(), so a second deep-link
    // create arriving here would leave the first one looking unhandled and
    // replay it — the same duplicate this guard exists to prevent.
    setIntent(intent)
    captureIncomingIntent(intent)
  }

  /**
   * Tell the frontend the app returned to the foreground. The webview's own
   * `window` "focus" / `visibilitychange` DOM events do not reliably track the
   * Android Activity lifecycle, so a user who leaves to toggle a permission in
   * system settings and comes back would otherwise never trigger a re-check
   * (see the permission gate in src/App.vue). Unlike the notification-action
   * bridge this needs no retry polling: a warm resume already has the handler
   * registered, and cold start is covered by the frontend's onMounted check
   * (webView may still be null here, before onWebViewCreate).
   */
  override fun onResume() {
    super.onResume()
    webView?.evaluateJavascript("window.androidResume && window.androidResume()", null)
  }

  override fun onDestroy() {
    unregisterReceiver(pendingOpsReceiver)
    super.onDestroy()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putString(HANDLED_ACTION_KEY, handledActionFingerprint)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    // Expose the JS -> native bridge as `window.AndroidNative` (see NativeBridge).
    webView.addJavascriptInterface(NativeBridge(), "AndroidNative")
  }

  /**
   * JS -> native bridge reachable from the webview as `window.AndroidNative`.
   * LandingView.vue calls openNotificationSettings() to send the user to this
   * app's Android notification settings after they deny the runtime permission
   * (the Flutter app used the app_settings plugin for the same "permanently
   * denied" path).
   */
  private inner class NativeBridge {
    /**
     * Export flow: stash the backup JSON and let the user pick a destination
     * with the system "create document" dialog (Storage Access Framework, so
     * no storage permission is needed — the grant covers just the chosen
     * file). The write happens in onActivityResult; the outcome is reported
     * to the frontend via window.androidBackupResult (see src/lib/backup.ts).
     */
    @JavascriptInterface
    fun exportBackup(json: String, fileName: String) {
      // @JavascriptInterface methods run on a WebView background thread.
      runOnUiThread {
        pendingExportJson = json
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
          .addCategory(Intent.CATEGORY_OPENABLE)
          .setType("application/json")
          .putExtra(Intent.EXTRA_TITLE, fileName)
        try {
          startActivityForResult(intent, REQUEST_EXPORT_BACKUP)
        } catch (_: Exception) {
          pendingExportJson = null
          deliverBackupResult("export-error", "no document picker available")
        }
      }
    }

    /**
     * Import flow: system "open document" dialog; the file's text is handed
     * to the frontend in onActivityResult. Providers don't reliably report
     * .json files as application/json (downloads often come back as
     * text/plain or octet-stream), hence the wildcard type + mime hint.
     */
    @JavascriptInterface
    fun importBackup() {
      runOnUiThread {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
          .addCategory(Intent.CATEGORY_OPENABLE)
          .setType("*/*")
          .putExtra(
            Intent.EXTRA_MIME_TYPES,
            arrayOf("application/json", "text/plain", "application/octet-stream")
          )
        try {
          startActivityForResult(intent, REQUEST_IMPORT_BACKUP)
        } catch (_: Exception) {
          deliverBackupResult("import-error", "no document picker available")
        }
      }
    }

    /**
     * Voice-driven reminder creation: launches the system speech recognizer;
     * the transcript (or cancellation/error) is delivered to the frontend via
     * window.androidVoiceResult, same as the backup pickers above and for the
     * same reason (no retry polling needed — this is only ever called from a
     * live webview). No RECORD_AUDIO permission needed: the resolved
     * recognizer activity (the Google app) does the actual recording, not
     * this app's process. And since this starts the activity directly and
     * catches the failure rather than calling resolveActivity() /
     * queryIntentActivities() first, API 30+ package-visibility filtering
     * doesn't apply either — don't "fix" this by adding a manifest <queries>
     * entry or a RECORD_AUDIO permission, neither is needed.
     */
    @JavascriptInterface
    fun startVoiceCapture() {
      runOnUiThread {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
          .putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
          )
          .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
          .putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.voice_reminder_prompt))
        try {
          startActivityForResult(intent, REQUEST_VOICE_CAPTURE)
        } catch (_: Exception) {
          deliverVoiceResult("voice-error", "no speech recognizer available")
        }
      }
    }

    /**
     * Hands over (and clears) the reminder bookkeeping the receivers performed
     * while no webview was around to update reminders.db. Returns a JSON array
     * string; unlike the backup methods this is synchronous, since
     * @JavascriptInterface return values cross straight back into JS.
     */
    @JavascriptInterface
    fun takePendingOps(): String = PendingOpsJournal.takeAll(this@MainActivity)

    /**
     * Mirrors the snooze action group the frontend just registered, so
     * CreateReminderReceiver can attach the same buttons to a reminder armed
     * headlessly. Empty string = snooze disabled, so no buttons (see
     * NotificationActionGroup).
     */
    @JavascriptInterface
    fun setNotificationActionGroup(actionTypeId: String) {
      NotificationActionGroup.set(this@MainActivity, actionTypeId)
    }

    /**
     * Mirrors Settings > Voice Reminders > "Auto-create from widget voice" so
     * VoiceQuickCreateActivity can read it without a live webview (see
     * VoiceWidgetSettings and syncVoiceWidgetAutoCreate in
     * src/lib/voiceReminder.ts) — same reasoning as
     * setNotificationActionGroup above.
     */
    @JavascriptInterface
    fun setVoiceWidgetAutoCreate(autoCreate: Boolean) {
      VoiceWidgetSettings.setAutoCreate(this@MainActivity, autoCreate)
    }

    /**
     * Hands the reminder-list widget its snapshot — formatted rows plus both
     * color schemes — and repaints any placed instances (PLAN.md, phase 5;
     * see WidgetSnapshot and src/lib/widget.ts). Synchronous like
     * takePendingOps: the write is a SharedPreferences commit and the widget
     * update a binder call, neither of which needs the UI thread.
     */
    @JavascriptInterface
    fun setWidgetSnapshot(json: String) {
      WidgetSnapshot.set(this@MainActivity, json)
    }

    @JavascriptInterface
    fun openNotificationSettings() {
      // @JavascriptInterface methods run on a WebView background thread; launch
      // the settings activity from the main thread.
      runOnUiThread {
        val intent =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
              .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
          } else {
            // ACTION_APP_NOTIFICATION_SETTINGS is API 26+; on 24-25 (minSdk is
            // 24) fall back to the app detail page, which has a notifications
            // entry.
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
              .setData(Uri.fromParts("package", packageName, null))
          }
        try {
          startActivity(intent)
        } catch (_: Exception) {
          // No settings activity resolvable on this device; nothing else to do.
        }
      }
    }
  }

  @Deprecated("Deprecated in Java")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION")
    super.onActivityResult(requestCode, resultCode, data)
    when (requestCode) {
      REQUEST_EXPORT_BACKUP -> {
        val json = pendingExportJson
        pendingExportJson = null
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null || json == null) {
          deliverBackupResult("export-cancelled", "")
          return
        }
        try {
          // "wt" truncates when the user overwrites an existing file; some
          // providers only accept "w", which is equivalent for the fresh
          // documents CREATE_DOCUMENT normally returns.
          val stream =
            try {
              contentResolver.openOutputStream(uri, "wt")
            } catch (_: Exception) {
              contentResolver.openOutputStream(uri)
            } ?: throw IllegalStateException("provider returned no stream")
          stream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
          deliverBackupResult("export-done", "")
        } catch (e: Exception) {
          deliverBackupResult("export-error", e.message ?: "write failed")
        }
      }
      REQUEST_IMPORT_BACKUP -> {
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) {
          deliverBackupResult("import-cancelled", "")
          return
        }
        try {
          val text = contentResolver.openInputStream(uri)
            ?.bufferedReader(Charsets.UTF_8)
            ?.use { it.readText() }
            ?: throw IllegalStateException("provider returned no stream")
          deliverBackupResult("import-data", text)
        } catch (e: Exception) {
          deliverBackupResult("import-error", e.message ?: "read failed")
        }
      }
      REQUEST_VOICE_CAPTURE -> {
        val transcript = data
          ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
          ?.firstOrNull()
        if (resultCode != RESULT_OK || transcript.isNullOrBlank()) {
          deliverVoiceResult("voice-cancelled", "")
        } else {
          deliverVoiceResult("voice-result", transcript)
        }
      }
    }
  }

  /**
   * Hand a backup picker outcome to the frontend. Unlike the notification
   * action bridge this needs no retry polling: the picker was launched from
   * the settings page, so the frontend is booted and its handler registered.
   */
  private fun deliverBackupResult(event: String, payload: String) {
    val js =
      "window.androidBackupResult && window.androidBackupResult(" +
        "${JSONObject.quote(event)}, ${JSONObject.quote(payload)})"
    runOnUiThread { webView?.evaluateJavascript(js, null) }
  }

  /** Hand a voice-capture outcome to the frontend — see deliverBackupResult. */
  private fun deliverVoiceResult(event: String, payload: String) {
    val js =
      "window.androidVoiceResult && window.androidVoiceResult(" +
        "${JSONObject.quote(event)}, ${JSONObject.quote(payload)})"
    runOnUiThread { webView?.evaluateJavascript(js, null) }
  }

  // Extra keys defined by tauri-plugin-notification's TauriNotificationManager.
  private fun extractAction(intent: Intent?): Pair<Int, String>? {
    val id = intent?.getIntExtra("NotificationId", Int.MIN_VALUE) ?: return null
    if (id == Int.MIN_VALUE) return null
    val actionId = intent.getStringExtra("NotificationUserAction") ?: return null
    return Pair(id, actionId)
  }

  /**
   * Parses a `remindme://create` deep link or an ACTION_SEND text/plain
   * share intent into a create request; null for anything else (including a
   * notification action intent, handled separately by extractAction).
   */
  private fun extractCreateRequest(intent: Intent?): CreateRequest? {
    if (intent == null) return null
    return when (intent.action) {
      Intent.ACTION_VIEW -> {
        val uri = intent.data ?: return null
        if (uri.scheme != "remindme") return null
        when (uri.host) {
          "create" -> {
            val details = uri.getQueryParameter("details")
            val atMillis = uri.getQueryParameter("at")?.let {
              runCatching { Instant.parse(it).toEpochMilli() }.getOrNull()
            }
            CreateRequest(details, atMillis, "deeplink", uri.toString(), "new")
          }
          // Navigate-only (PLAN.md, phases 5 and 6): open the reminder list,
          // optionally on one reminder's details dialog. Exactly one query
          // parameter is read, narrowly — a positive integer `id`, with a
          // miss falling back to the plain list. details and at stay unread
          // and nulled by construction, so isCreate stays false and this host
          // cannot become a create surface reachable from any web page (the
          // filter is BROWSABLE); reading an id only opens a dialog over text
          // the user already wrote, which needs no replay guard because it
          // writes nothing. src/lib/createRequest.ts mirrors both halves.
          "reminders" -> CreateRequest(
            null,
            null,
            "deeplink",
            uri.toString(),
            "list",
            uri.getQueryParameter("id")?.toLongOrNull()?.takeIf { it > 0 },
          )
          else -> null
        }
      }
      Intent.ACTION_SEND -> {
        if (intent.type != "text/plain") return null
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
        CreateRequest(text, null, "share", "share:$text", "new")
      }
      // VoiceQuickCreateActivity's auto-create-off path: always prefills on
      // the frontend (src/lib/createRequest.ts treats "voice" like "share"),
      // regardless of how complete the parse was — the user already chose to
      // review before creating, by turning the setting off.
      ACTION_VOICE_PREFILL -> {
        val details = intent.getStringExtra(EXTRA_DETAILS) ?: return null
        val atMillis = intent.getLongExtra(EXTRA_FIRE_AT, Long.MIN_VALUE)
          .takeIf { it != Long.MIN_VALUE }
        CreateRequest(details, atMillis, "voice", "voice:$details|$atMillis", "new")
      }
      else -> null
    }
  }

  private fun fingerprint(intent: Intent?): String? =
    extractAction(intent)?.let { (id, actionId) -> "$id|$actionId" }
      ?: extractCreateRequest(intent)?.takeIf { it.isCreate }?.replayKey

  /**
   * Single entry point for both onCreate and onNewIntent: an incoming intent
   * is either a notification action tap or a create request, never both.
   */
  private fun captureIncomingIntent(intent: Intent?) {
    if (extractAction(intent) != null) {
      captureNotificationAction(intent)
    } else {
      captureCreateRequest(intent)
    }
  }

  private fun captureNotificationAction(intent: Intent?) {
    val action = extractAction(intent) ?: return
    val (id, actionId) = action
    handledActionFingerprint = "$id|$actionId"
    pendingNotificationAction = action
    deliverNotificationAction(0)
  }

  private fun deliverNotificationAction(attempt: Int) {
    val (id, actionId) = pendingNotificationAction ?: return
    if (attempt > 80) { // Frontend never came up; give up after ~20s.
      pendingNotificationAction = null
      return
    }
    val retry = Runnable { deliverNotificationAction(attempt + 1) }
    val wv = webView
    if (wv == null) {
      Handler(Looper.getMainLooper()).postDelayed(retry, 250)
      return
    }
    wv.evaluateJavascript(
      "window.androidNotificationAction ? window.androidNotificationAction($id, ${JSONObject.quote(actionId)}) : false"
    ) { handled ->
      if (handled == "true") {
        pendingNotificationAction = null
      } else {
        Handler(Looper.getMainLooper()).postDelayed(retry, 250)
      }
    }
  }

  private fun captureCreateRequest(intent: Intent?) {
    val request = extractCreateRequest(intent) ?: return
    // Only creating requests are recorded as handled — the same isCreate test
    // fingerprint() uses, so the two can't drift apart.
    if (request.isCreate) handledActionFingerprint = request.replayKey
    pendingCreateRequest = request
    deliverCreateRequest(0)
  }

  private fun deliverCreateRequest(attempt: Int) {
    val request = pendingCreateRequest ?: return
    if (attempt > 80) { // Frontend never came up; give up after ~20s.
      pendingCreateRequest = null
      return
    }
    val retry = Runnable { deliverCreateRequest(attempt + 1) }
    val wv = webView
    if (wv == null) {
      Handler(Looper.getMainLooper()).postDelayed(retry, 250)
      return
    }
    val payload = JSONObject().apply {
      put("details", request.details ?: JSONObject.NULL)
      put("atMillis", request.atMillis ?: JSONObject.NULL)
      put("source", request.source)
      put("target", request.target)
      put("reminderId", request.reminderId ?: JSONObject.NULL)
    }
    wv.evaluateJavascript(
      "window.androidCreateRequest ? window.androidCreateRequest($payload) : false"
    ) { handled ->
      if (handled == "true") {
        pendingCreateRequest = null
      } else {
        Handler(Looper.getMainLooper()).postDelayed(retry, 250)
      }
    }
  }
}
