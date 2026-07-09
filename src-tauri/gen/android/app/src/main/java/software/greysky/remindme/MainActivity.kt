package software.greysky.remindme

import android.content.Intent
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
import org.json.JSONObject

private const val HANDLED_ACTION_KEY = "handledNotificationAction"

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
    val fromHistory = intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
    val alreadyHandled =
      fingerprint(intent) != null &&
        savedInstanceState?.getString(HANDLED_ACTION_KEY) == fingerprint(intent)
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

  private fun fingerprint(intent: Intent?): String? {
    // Extra keys defined by tauri-plugin-notification's TauriNotificationManager.
    val id = intent?.getIntExtra("NotificationId", Int.MIN_VALUE) ?: return null
    if (id == Int.MIN_VALUE) return null
    val actionId = intent.getStringExtra("NotificationUserAction") ?: return null
    return "$id|$actionId"
  }

  private fun captureNotificationAction(intent: Intent?) {
    val id = intent?.getIntExtra("NotificationId", Int.MIN_VALUE) ?: return
    if (id == Int.MIN_VALUE) return
    val actionId = intent.getStringExtra("NotificationUserAction") ?: return
    handledActionFingerprint = "$id|$actionId"
    pendingNotificationAction = Pair(id, actionId)
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
