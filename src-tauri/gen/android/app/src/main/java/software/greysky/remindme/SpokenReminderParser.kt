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
 * Understands three shapes, matching what the user actually asked for:
 *   "in <number> <minute(s)/hour(s)/day(s)/week(s)>"
 *   "on <Month> <Day>[, <Year>]" / "today" / "tomorrow", optionally
 *     followed by "at <hour>[:<minute>] [am/pm]"
 *   "at <hour>[:<minute>] [am/pm]" on its own, with no date word at all
 *
 * A clock time missing am/pm resolves to whichever of the two 12-hour
 * readings is the next one to occur from `now` — "at 4:00" said at 3:30 PM
 * means 4:00 PM today, not 4:00 AM tomorrow — matching the same override the
 * in-app parser applies to chrono-node's own (different, and here judged
 * wrong) default guess for the identical phrasing; see resolveAmbiguousTime
 * and voiceReminder.ts's resolveAmbiguousMeridiem. An absolute date with no
 * time at all defaults to 9:00 AM, and a bare time with no date at all
 * defaults to today — both roll forward (year, respectively day) when the
 * resolved moment has already passed, mirroring chrono-node's forwardDate
 * option.
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
  // The am/pm group is optional — see resolveTime for how an absent one is
  // read.
  private val TIME_OF_DAY = Regex(
    """\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b""",
    RegexOption.IGNORE_CASE,
  )

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

    val timeMatch = TIME_OF_DAY.find(clean)

    val absoluteMatch = ABSOLUTE_DATE.find(clean) ?: TODAY_TOMORROW.find(clean)
    if (absoluteMatch != null) {
      val date = resolveDate(absoluteMatch, now, zone) ?: return null
      val fireAt = resolveDateTime(date, timeMatch, now, zone) ?: return null
      val consumed = listOfNotNull(absoluteMatch.range, timeMatch?.range)
      val details = extractDetails(clean, consumed) ?: return null
      return ParsedReminder(details, fireAt)
    }

    // No date word at all ("remind me at 4:00 to order dinner"): default to
    // today — resolveDateTime rolls forward on its own if the resolved
    // moment has already passed.
    if (timeMatch != null) {
      val today = LocalDate.ofInstant(java.time.Instant.ofEpochMilli(now), zone)
      val fireAt = resolveDateTime(today, timeMatch, now, zone) ?: return null
      val details = extractDetails(clean, listOf(timeMatch.range)) ?: return null
      return ParsedReminder(details, fireAt)
    }

    return null
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

  /**
   * Combines a resolved calendar date with an optional matched time-of-day
   * clause into an epoch. No time match at all defaults to 9:00 AM on that
   * date; an explicit am/pm resolves the usual way. An ambiguous clock time
   * (no am/pm) is handed to resolveAmbiguousTime instead of being read as a
   * fixed hour, since which reading is correct depends on `now` — see that
   * function and the class doc comment.
   */
  private fun resolveDateTime(date: LocalDate, timeMatch: MatchResult?, now: Long, zone: ZoneId): Long? {
    if (timeMatch == null) {
      return LocalDateTime.of(date, LocalTime.of(9, 0)).atZone(zone).toInstant().toEpochMilli()
    }

    var hour = timeMatch.groupValues[1].toIntOrNull() ?: return null
    val minute = timeMatch.groupValues[2].ifEmpty { "0" }.toIntOrNull() ?: return null
    val meridiem = timeMatch.groupValues[3]
    if (hour !in 1..12 || minute !in 0..59) return null

    if (meridiem.isNotEmpty()) {
      val isPm = meridiem.startsWith("p", ignoreCase = true)
      if (hour == 12) hour = 0
      if (isPm) hour += 12
      return LocalDateTime.of(date, LocalTime.of(hour, minute)).atZone(zone).toInstant().toEpochMilli()
    }

    return resolveAmbiguousTime(date, hour, minute, now, zone)
  }

  /**
   * "at 4:00" with no am/pm resolves to whichever of the two 12-hour readings
   * is the *next one to occur* from `now` — not a fixed AM/PM guess. AM
   * always precedes PM on the same calendar day, so in chronological order
   * the only candidates that can possibly be "next" are: `date`'s AM
   * reading, `date`'s PM reading, then the following day's AM reading (which
   * is always still in the future once both of `date`'s have passed, so
   * nothing later ever needs checking). The first candidate at or after
   * `now` wins.
   *
   * For an explicit future `date` (e.g. "on September 1st"), every candidate
   * is already ≥ `now`, so this simply picks the AM reading — the same
   * result the previous fixed-AM behavior gave, so this is a pure
   * generalization of it, not a regression for that case.
   *
   * Note hour 12 has two same-day readings too (00:00 then 12:00), so a
   * bare "at 12:00" late in the day can resolve to the *next calendar day's
   * midnight* rather than the more colloquial "noon" — accepted, since it is
   * still the literal nearest future occurrence of "12:00" and this function
   * has no way to know "noon" was meant instead.
   */
  private fun resolveAmbiguousTime(date: LocalDate, hour: Int, minute: Int, now: Long, zone: ZoneId): Long {
    val amHour = if (hour == 12) 0 else hour
    val pmHour = if (hour == 12) 12 else hour + 12
    val candidates = listOf(
      LocalDateTime.of(date, LocalTime.of(amHour, minute)),
      LocalDateTime.of(date, LocalTime.of(pmHour, minute)),
      LocalDateTime.of(date.plusDays(1), LocalTime.of(amHour, minute)),
    ).map { it.atZone(zone).toInstant().toEpochMilli() }
    return candidates.firstOrNull { it >= now } ?: candidates.last()
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
