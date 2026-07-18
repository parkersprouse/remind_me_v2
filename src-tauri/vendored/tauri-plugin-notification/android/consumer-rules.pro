# VENDORED FIX: this file is declared in build.gradle.kts
# (consumerProguardFiles) but never existed upstream, so the consuming app's
# minified release build ran R8 over the plugin with only the tauri-android
# AAR's generic rules. Those keep @InvokeArg classes, @JsonDeserialize /
# @JsonSerialize annotated classes, and Json(De)Serializer subclasses — but
# NOT the plain model types Jackson reaches through them by reflection:
#
#   - NotificationInterval (Schedule.every): enum constants stripped/renamed
#     → "No enum constants for class NotificationInterval" — every
#     `every`-schedule notify() rejects on release builds while working in
#     debug.
#   - DateMatch (Schedule.interval): field names minified away from Jackson
#     → all match fields deserialize to null, silently collapsing the
#     schedule to "fire now, once".
#   - NotificationAttachment / PendingNotification / Importance / Visibility:
#     same reflective surface, same latent breakage.
#
# One-shot Schedule.at payloads only touch kept classes, which is why plain
# reminders work on release builds and only repeating ones break. Keep the
# whole plugin package: it is small, Jackson also persists these objects to
# SharedPreferences (NotificationStorage) so field names must stay stable
# across app updates, and a targeted list would rot the next time a model
# class is added.
-keep class app.tauri.notification.** { *; }
