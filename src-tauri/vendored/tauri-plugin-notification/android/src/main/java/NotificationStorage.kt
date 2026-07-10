// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package app.tauri.notification

import android.content.Context
import android.content.SharedPreferences
import com.fasterxml.jackson.annotation.JsonAutoDetect
import com.fasterxml.jackson.annotation.PropertyAccessor
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import java.lang.Exception

// Key for private preferences
private const val NOTIFICATION_STORE_ID = "NOTIFICATION_STORE"
// Key used to save action types
private const val ACTION_TYPES_ID = "ACTION_TYPE_STORE"

// VENDORED FIX: the broadcast receivers (boot restore, timed publisher,
// dismiss) constructed a bare ObjectMapper(), while the plugin writes through
// Tauri's invoke mapper (field visibility ANY, unknown properties tolerated —
// see PluginManager in tauri-android). A bare mapper cannot deserialize what
// the configured one serialized (e.g. JSObject's `nameValuePairs` field), so
// every read outside the plugin process failed and boot restore was a no-op.
// This mirrors the tauri-android mapper config; use it wherever a
// NotificationStorage is created without a live plugin instance.
fun storageJsonMapper(): ObjectMapper = ObjectMapper()
  .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
  .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
  .setVisibility(PropertyAccessor.FIELD, JsonAutoDetect.Visibility.ANY)

class NotificationStorage(private val context: Context, private val jsonMapper: ObjectMapper) {
  fun appendNotifications(localNotifications: List<Notification>) {
    val storage = getStorage(NOTIFICATION_STORE_ID)
    val editor = storage.edit()
    for (request in localNotifications) {
      if (request.schedule != null) {
        val key: String = request.id.toString()
        // VENDORED FIX: upstream stored request.sourceJson, but sourceJson is
        // never assigned anywhere in the plugin, so every entry was the literal
        // string "null" and getSavedNotification() could never deserialize it —
        // which silently broke LocalNotificationRestoreReceiver (no scheduled
        // notification survived a reboot). Serializing the object itself also
        // captures the restore receiver's fast-forwarded dates when it re-saves.
        editor.putString(key, jsonMapper.writeValueAsString(request))
      }
    }
    editor.apply()
  }

  fun getSavedNotificationIds(): List<String> {
    val storage = getStorage(NOTIFICATION_STORE_ID)
    val all = storage.all
    return if (all != null) {
      ArrayList(all.keys)
    } else ArrayList()
  }

  fun getSavedNotifications(): List<Notification> {
    val storage = getStorage(NOTIFICATION_STORE_ID)
    val all = storage.all
    if (all != null) {
      val notifications = ArrayList<Notification>()
      for (key in all.keys) {
        val notificationString = all[key] as String?
        try {
          val notification = jsonMapper.readValue(notificationString, Notification::class.java)
          notifications.add(notification)
        } catch (_: Exception) { }
      }
      return notifications
    }
    return ArrayList()
  }

  fun getSavedNotification(key: String): Notification? {
    val storage = getStorage(NOTIFICATION_STORE_ID)
    val notificationString = try {
      storage.getString(key, null)
    } catch (ex: ClassCastException) {
      return null
    } ?: return null

    return try {
      jsonMapper.readValue(notificationString, Notification::class.java)
    } catch (ex: Exception) {
      // VENDORED FIX: was `catch (ex: JSONException)`, but Jackson throws its
      // own exception hierarchy (org.json is never involved here), so any bad
      // entry — e.g. the "null" strings written by unpatched builds — crashed
      // the caller (including the boot-restore receiver) instead of skipping.
      null
    }
  }

  fun deleteNotification(id: String?) {
    val editor = getStorage(NOTIFICATION_STORE_ID).edit()
    editor.remove(id)
    editor.apply()
  }

  private fun getStorage(key: String): SharedPreferences {
    return context.getSharedPreferences(key, Context.MODE_PRIVATE)
  }

  fun writeActionGroup(actions: List<ActionType>) {
    for (type in actions) {
      val editor = getStorage(ACTION_TYPES_ID + type.id).edit()
      editor.clear()
      editor.putInt("count", type.actions.size)
      // VENDORED FIX: upstream 2.3.3 keyed every action with the action TYPE
      // id here ("id$i" where i was type.id), so all actions overwrote one
      // another while getActionGroup reads "id0"/"id1"/… — every action came
      // back with an empty id and title (invisible buttons, unidentifiable
      // taps). Key by the action's index, matching getActionGroup.
      for ((index, action) in type.actions.withIndex()) {
        editor.putString("id$index", action.id)
        editor.putString("title$index", action.title)
        editor.putBoolean("input$index", action.input ?: false)
      }
      editor.apply()
    }
  }

  fun getActionGroup(forId: String): Array<NotificationAction?> {
    val storage = getStorage(ACTION_TYPES_ID + forId)
    val count = storage.getInt("count", 0)
    val actions: Array<NotificationAction?> = arrayOfNulls(count)
    for (i in 0 until count) {
      val id = storage.getString("id$i", "")
      val title = storage.getString("title$i", "")
      val input = storage.getBoolean("input$i", false)

      val action = NotificationAction()
      action.id = id ?: ""
      action.title = title
      action.input = input
      actions[i] = action
    }
    return actions
  }
}