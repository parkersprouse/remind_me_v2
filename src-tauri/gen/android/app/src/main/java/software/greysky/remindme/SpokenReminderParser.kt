package software.greysky.remindme

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.Month
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

/** Mirrors DETAILS_MAX_LENGTH in CreateReminderReceiver.kt / src/lib/createRequest.ts. */
private const val DETAILS_MAX_LENGTH = 240

/** Result of a successful parse, ready to hand to CreateReminderReceiver as-is. */
data class ParsedReminder(val details: String, val fireAtMillis: Long)

/**
 * A small, dependency-free grammar parser for VoiceQuickCreateActivity —
 * deliberately narrower than the in-app mic button's chrono-node parser (see
 * src/lib/voiceReminder.ts), because there is no JS runtime to run
 * chrono-node in out here, and this project has twice avoided adding a new
 * Gradle dependency to this hand-edited tree specifically to dodge R8 risk
 * (see CLAUDE.md — Jetpack Glance was rejected for the same reason).
 *
 * Understands exactly two shapes, matching what the user actually asked for:
 *   "in <number> <minute(s)/hour(s)/day(s)/week(s)>"
 *   "on <Month> <Day>[, <Year>]" / "today" / "tomorrow", optionally
 *     followed by "at <hour>[:<minute>] am/pm"
 *
 * A clock time missing am/pm is treated as unparseable rather than guessed at
 * (a silent wrong guess is worse here than nowhere to see it was wrong, since
 * there's no screen open to notice on). An absolute date with no time at all
 * defaults to 9:00 AM — that's a documented fallback for a genuinely absent
 * value, not a guess about intent, unlike an ambiguous hour.
 *
 * Anything this can't parse fails with null, and VoiceQuickCreateActivity
 * tells the user to open the app instead.
 */
object SpokenReminderParser {
  private val NUMBER_WORDS = mapOf(
    "a" to 1, "an" to 1, "one" to 1, "two" to 2, "three" to 3, "four" to 4,
    "five" to 5, "six" to 6, "seven" to 7, "eight" to 8, "nine" to 9,
    "ten" to 10, "eleven" to 11, "twelve" to 12,
  )
  private val UNIT_MILLIS = mapOf(
    "minute" to 60_000L, "minutes" to 60_000L,
    "hour" to 3_600_000L, "hours" to 3_600_000L,
    "day" to 86_400_000L, "days" to 86_400_000L,
    "week" to 604_800_000L, "weeks" to 604_800_000L,
  )
  // Both full ("august") and abbreviated ("aug") names, so "Aug 6th" and
  // "August 6th" both resolve.
  private val MONTHS_BY_NAME: Map<String, Month> = Month.entries.flatMap { month ->
    listOf(
      month.getDisplayName(TextStyle.FULL, Locale.US).lowercase() to month,
      month.getDisplayName(TextStyle.SHORT, Locale.US).lowercase() to month,
    )
  }.toMap()

  private val RELATIVE = Regex(
    """\bin\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+""" +
      """(minute|minutes|hour|hours|day|days|week|weeks)\b""",
    RegexOption.IGNORE_CASE,
  )
  private val ABSOLUTE_DATE = Regex(
    """\bon\s+([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?""",
    RegexOption.IGNORE_CASE,
  )
  private val TODAY_TOMORROW = Regex("""\b(today|tomorrow)\b""", RegexOption.IGNORE_CASE)
  private val TIME_OF_DAY = Regex(
    """\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b""",
    RegexOption.IGNORE_CASE,
  )
  // A clock time with no am/pm: still matched so its presence can be treated
  // as "ambiguous, reject" rather than silently falling through and being
  // read as details text.
  private val AMBIGUOUS_TIME_OF_DAY = Regex("""\bat\s+\d{1,2}(?::\d{2})?\b""", RegexOption.IGNORE_CASE)

  private val FILLER_PREFIX =
    Regex("""^(please\s+)?(set|create)\s+(up\s+)?(a|an)\s+reminder\s*""", RegexOption.IGNORE_CASE)
  private val REMIND_ME_PREFIX = Regex("""^(please\s+)?remind\s+me\s*""", RegexOption.IGNORE_CASE)
  private val CONNECTOR_PREFIX = Regex("""^(for|to|that)\s+""", RegexOption.IGNORE_CASE)
  private val TRAILING_PREPOSITION = Regex("""\b(on|in|at)\s*$""", RegexOption.IGNORE_CASE)

  fun parse(
    rawTranscript: String,
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
  ): ParsedReminder? {
    val clean = rawTranscript.trim()
    if (clean.isEmpty()) return null

    val relative = RELATIVE.find(clean)
    if (relative != null) {
      val amount = NUMBER_WORDS[relative.groupValues[1].lowercase()]
        ?: relative.groupValues[1].toIntOrNull()
        ?: return null
      val unitMillis = UNIT_MILLIS[relative.groupValues[2].lowercase()] ?: return null
      val fireAt = now + amount * unitMillis
      val details = extractDetails(clean, listOf(relative.range)) ?: return null
      return ParsedReminder(details, fireAt)
    }

    val absoluteMatch = ABSOLUTE_DATE.find(clean) ?: TODAY_TOMORROW.find(clean)
    if (absoluteMatch == null) return null
    // An ambiguous hour ("at 3", no am/pm) is only worth rejecting outright if
    // there's otherwise a valid date to attach it to — that's the case this
    // parser can get partly right and get wrong silently.
    val timeMatch = TIME_OF_DAY.find(clean)
    if (timeMatch == null && AMBIGUOUS_TIME_OF_DAY.containsMatchIn(clean)) return null

    val date = resolveDate(absoluteMatch, now, zone) ?: return null
    val time = timeMatch?.let(::resolveTime) ?: LocalTime.of(9, 0)
    val fireAt = LocalDateTime.of(date, time).atZone(zone).toInstant().toEpochMilli()

    val consumed = listOfNotNull(absoluteMatch.range, timeMatch?.range)
    val details = extractDetails(clean, consumed) ?: return null
    return ParsedReminder(details, fireAt)
  }

  private fun resolveDate(match: MatchResult, now: Long, zone: ZoneId): LocalDate? {
    val today = LocalDate.ofInstant(java.time.Instant.ofEpochMilli(now), zone)
    if (match.groupValues.size == 2) {
      // TODAY_TOMORROW: single capture group, "today" or "tomorrow".
      return if (match.groupValues[1].equals("tomorrow", ignoreCase = true)) today.plusDays(1) else today
    }

    val month = MONTHS_BY_NAME[match.groupValues[1].lowercase()] ?: return null
    val day = match.groupValues[2].toIntOrNull() ?: return null
    val explicitYear = match.groupValues[3].toIntOrNull()
    val year = explicitYear ?: today.year
    val candidate = try {
      LocalDate.of(year, month, day)
    } catch (_: java.time.DateTimeException) {
      return null
    }
    // No explicit year, and the day has already passed this year: roll
    // forward rather than silently arming a reminder in the past (mirrors
    // chrono-node's forwardDate option on the in-app side).
    return if (explicitYear == null && candidate.isBefore(today)) candidate.plusYears(1) else candidate
  }

  private fun resolveTime(match: MatchResult): LocalTime? {
    var hour = match.groupValues[1].toIntOrNull() ?: return null
    val minute = match.groupValues[2].ifEmpty { "0" }.toIntOrNull() ?: return null
    val isPm = match.groupValues[3].startsWith("p", ignoreCase = true)
    if (hour !in 1..12 || minute !in 0..59) return null
    if (hour == 12) hour = 0
    if (isPm) hour += 12
    return LocalTime.of(hour, minute)
  }

  /**
   * Removes the matched time-clause ranges from the transcript, strips filler
   * phrasing and the dangling preposition/connector words those clauses leave
   * behind, and caps the result the same way CreateReminderReceiver does.
   * Null means nothing usable survived.
   */
  private fun extractDetails(clean: String, consumedRanges: List<IntRange>): String? {
    val sorted = consumedRanges.sortedBy { it.first }
    val builder = StringBuilder()
    var cursor = 0
    for (range in sorted) {
      val before = clean.substring(cursor, range.first).replace(TRAILING_PREPOSITION, "")
      builder.append(before).append(' ')
      cursor = range.last + 1
    }
    builder.append(clean.substring(cursor))

    var remainder = builder.toString().trim()
    // A leading filler phrase can precede the time clause ("set a reminder in
    // one hour for..."), so strip it, then the connector that introduces the
    // details ("...for take out the trash"), then repeat once more in case
    // the filler was still ahead of a connector left behind by removal.
    repeat(2) {
      remainder = remainder.replace(FILLER_PREFIX, "").replace(REMIND_ME_PREFIX, "").trim()
      remainder = remainder.replace(CONNECTOR_PREFIX, "").trim()
    }

    if (remainder.isEmpty()) return null
    return if (remainder.length > DETAILS_MAX_LENGTH) remainder.take(DETAILS_MAX_LENGTH) else remainder
  }
}
