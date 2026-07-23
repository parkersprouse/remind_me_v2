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
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import org.json.JSONObject

private const val HANDLED_ACTION_KEY = "handledNotificationAction"

// Arbitrary but distinctive request codes for the backup document pickers;
// results for codes we don't own fall through to super (Tauri plugins).
private const val REQUEST_EXPORT_BACKUP = 41001
private const val REQUEST_IMPORT_BACKUP = 41002

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

  /** Backup JSON waiting for the user to pick a destination in the SAF dialog. */
  private var pendingExportJson: String? = null

  /**
   * Nudges the frontend to drain the snooze journal the moment a background
   * snooze lands (SnoozeActionReceiver).
   *
   * The frontend also drains at startup and from androidResume, which covers a
   * snooze taken while the app was dead or backgrounded. Neither covers the
   * remaining case: the app is in the foreground and the user snoozes a
   * heads-up notification. The notification shade is an overlay, so the
   * Activity never pauses and no resume ever arrives — without this the
   * reminder list would sit stale until the user navigated away and back.
   */
  private val snoozeJournalReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      webView?.evaluateJavascript("window.androidSnoozeJournal && window.androidSnoozeJournal()", null)
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
      snoozeJournalReceiver,
      IntentFilter(SNOOZE_JOURNAL_UPDATED),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )

    val fromHistory = intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
    val currentFingerprint = fingerprint(intent)
    val alreadyHandled =
      currentFingerprint != null && savedInstanceState?.getString(HANDLED_ACTION_KEY) == currentFingerprint
    if (!fromHistory && !alreadyHandled) captureNotificationAction(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    captureNotificationAction(intent)
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
    unregisterReceiver(snoozeJournalReceiver)
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
     * Hands over (and clears) the snoozes performed by SnoozeActionReceiver
     * while no webview was around to update reminders.db. Returns a JSON array
     * string; unlike the backup methods this is synchronous, since
     * @JavascriptInterface return values cross straight back into JS.
     */
    @JavascriptInterface
    fun takeSnoozeJournal(): String = SnoozeJournal.takeAll(this@MainActivity)

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

  // Extra keys defined by tauri-plugin-notification's TauriNotificationManager.
  private fun extractAction(intent: Intent?): Pair<Int, String>? {
    val id = intent?.getIntExtra("NotificationId", Int.MIN_VALUE) ?: return null
    if (id == Int.MIN_VALUE) return null
    val actionId = intent.getStringExtra("NotificationUserAction") ?: return null
    return Pair(id, actionId)
  }

  private fun fingerprint(intent: Intent?): String? =
    extractAction(intent)?.let { (id, actionId) -> "$id|$actionId" }

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
}
