package software.greysky.remindme

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognizerIntent
import android.util.Log
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val TAG = "VoiceQuickCreate"
private const val REQUEST_VOICE = 9001

/**
 * Mirrors QuickCreateWidgetProvider's TIME_FORMAT: the en-US `jm` pattern
 * ("5:08 PM") rather than the device's 12/24-hour setting, so a toast here
 * reads the same as the reminder does everywhere else.
 */
private val TIME_FORMAT = SimpleDateFormat("h:mm a", Locale.US)

/**
 * Trampoline for the reminder-list widget's mic button (PLAN.md follow-up):
 * a dedicated, invisible Activity — not MainActivity — so tapping the mic
 * never visibly opens the app. `Theme.Translucent.NoDisplay` in the manifest
 * means nothing is ever drawn; onCreate launches the system speech
 * recognizer immediately and every other path finishes without ever calling
 * setContentView.
 *
 * Unlike QuickCreateWidgetProvider's preset buttons, whose fire-and-forget
 * broadcast can't fail validation by construction, a voice transcript
 * genuinely can fail to parse or to schedule — so this sends an *ordered*
 * broadcast to CreateReminderReceiver and reads back its actual result code
 * rather than guessing, since accurate feedback (there is no screen open to
 * notice a wrong guess on) is the whole point of this button existing.
 */
class VoiceQuickCreateActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      .putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.voice_reminder_prompt))
    try {
      @Suppress("DEPRECATION") // The ActivityResultContracts replacement needs no webview here either way.
      startActivityForResult(intent, REQUEST_VOICE)
    } catch (_: Exception) {
      toastAndFinish(getString(R.string.voice_reminder_no_recognizer))
    }
  }

  @Deprecated("Deprecated in Java")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION")
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_VOICE) {
      finish()
      return
    }

    val transcript = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
    if (resultCode != RESULT_OK || transcript.isNullOrBlank()) {
      // A deliberate cancel (user backed out of the recognizer dialog) is
      // silent — same policy as the in-app mic button's cancel path.
      finish()
      return
    }

    val parsed = SpokenReminderParser.parse(transcript)
    if (parsed == null) {
      Log.i(TAG, "unparseable transcript: \"$transcript\"")
      toastAndFinish(getString(R.string.voice_reminder_unparseable))
      return
    }

    createReminder(parsed)
  }

  private fun createReminder(parsed: ParsedReminder) {
    val intent = Intent(this, CreateReminderReceiver::class.java)
      .setAction(ACTION_CREATE_REMINDER)
      .putExtra(EXTRA_DETAILS, parsed.details)
      .putExtra(EXTRA_FIRE_AT, parsed.fireAtMillis)
    sendOrderedBroadcast(
      intent,
      null,
      object : BroadcastReceiver() {
        override fun onReceive(context: Context, result: Intent) {
          toastAndFinish(messageFor(resultCode, parsed.fireAtMillis))
        }
      },
      Handler(Looper.getMainLooper()),
      Activity.RESULT_OK, // Initial code; CreateReminderReceiver always overwrites it on an ordered broadcast.
      null,
      null,
    )
  }

  private fun messageFor(resultCode: Int, fireAtMillis: Long): String = when (resultCode) {
    RESULT_SCHEDULED ->
      getString(R.string.widget_status_set, TIME_FORMAT.format(Date(fireAtMillis)))
    RESULT_SCHEDULED_NOTIFICATIONS_DISABLED ->
      getString(R.string.widget_status_set_muted, TIME_FORMAT.format(Date(fireAtMillis)))
    else -> getString(R.string.voice_reminder_failed)
  }

  private fun toastAndFinish(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    finish()
  }
}
