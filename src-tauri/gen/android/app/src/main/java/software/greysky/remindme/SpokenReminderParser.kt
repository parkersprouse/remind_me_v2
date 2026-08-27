package software.greysky.remindme

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.Month
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.TextStyle
import java.util.Locale

/** Mirrors DETAILS_MAX_LENGTH in CreateReminderReceiver.kt / src/lib/createRequest.ts. */
private const val DETAILS_MAX_LENGTH = 240

/**
 * Hour used when the phrase named a day but no clock time ("remind me
 * tomorrow to call mom"). Mirrors DEFAULT_HOUR in src/lib/voiceReminder.ts,
 * which applies the same override to chrono-node — left to itself chrono fills
 * such a phrase in with noon, or with whatever time the user happened to be
 * speaking at, neither of which is what a bare "tomorrow" means.
 */
private const val DEFAULT_HOUR = 9

/**
 * A successful parse. `fireAtMillis` is null when the phrase named no time at
 * all ("remind me to call mom") — still a reminder worth keeping, but one
 * only the New Reminder form can finish, so VoiceQuickCreateActivity prefills
 * it instead of creating it.
 */
data class ParsedReminder(val details: String, val fireAtMillis: Long?)

/**
 * A small, dependency-free grammar parser for VoiceQuickCreateActivity —
 * necessarily narrower than the in-app mic button's chrono-node parser (see
 * src/lib/voiceReminder.ts), because there is no JS runtime to run
 * chrono-node in out here, and this project has twice avoided adding a new
 * Gradle dependency to this hand-edited tree specifically to dodge R8 risk
 * (see CLAUDE.md — Jetpack Glance was rejected for the same reason).
 *
 * "Narrower" is a grammar budget, not a different set of rules: every shape
 * it *does* understand has to resolve to the same moment and the same details
 * text the in-app parser produces for the same sentence, or the same spoken
 * phrase creates two different reminders depending on which mic button heard
 * it. The shared policy, mirrored on both sides:
 *
 *   - The phrase names a clock time ("at 4:00", "1:00 p.m.", "17:30", "noon")
 *     -> that time. A 1-12 reading with no am/pm resolves to whichever of the
 *     two readings is the *next one to occur* from `now` — "at 4:00" said at
 *     3:30 PM means 4:00 PM today, not 4:00 AM tomorrow (see
 *     resolveAmbiguousTime, and voiceReminder.ts's resolveAmbiguousMeridiem,
 *     which overrides chrono-node's own literal-then-roll-a-day guess to
 *     match).
 *   - The phrase names only a day ("tomorrow", "on Friday", "August 6th")
 *     -> DEFAULT_HOUR that day.
 *   - The phrase names a pure offset ("in 20 minutes", "in 3 days")
 *     -> exactly that far from now, clock time included.
 *
 * The shapes understood here, each with the preposition that introduces it
 * optional (a speech recognizer writes "set a reminder for 1:00 p.m." as
 * readily as "at 1:00 p.m.", and requiring "at" is what made this parser
 * reject sentences the in-app one accepted):
 *
 *   offsets    "[in|within|after|for] <number> <minutes|hours|days|weeks|
 *                months|years>", "<number> <unit> from now", "half an hour"
 *   days       "today", "tonight", "tomorrow", "[this|next] <weekday>",
 *              "next week|month|year", "<Month> <day>[, <year>]",
 *              "the <day> of <Month>", "M/D[/YYYY]"
 *   times      "[at|for|by|around] <hour>[:<minute>] [am|pm]", "<hour> o'clock",
 *              "noon", "midnight", "morning", "afternoon", "evening", "night"
 *
 * A day and a time combine ("tomorrow at 9am", "August 6th at 5pm"); either
 * alone is enough, and neither is required: a sentence with no time in it at
 * all still parses, to details with a null fireAtMillis, which
 * VoiceQuickCreateActivity opens the New Reminder form for. Only a transcript
 * with nothing left after the filler is stripped fails with null, and there
 * it tells the user to open the app instead.
 */
object SpokenReminderParser {
  private val NUMBER_WORDS = mapOf(
    "a" to 1.0, "an" to 1.0, "one" to 1.0, "two" to 2.0, "three" to 3.0,
    "four" to 4.0, "five" to 5.0, "six" to 6.0, "seven" to 7.0, "eight" to 8.0,
    "nine" to 9.0, "ten" to 10.0, "eleven" to 11.0, "twelve" to 12.0,
    "fifteen" to 15.0, "twenty" to 20.0, "thirty" to 30.0, "forty" to 40.0,
    "forty five" to 45.0, "forty-five" to 45.0, "fifty" to 50.0, "sixty" to 60.0,
    "ninety" to 90.0, "a couple" to 2.0, "a couple of" to 2.0, "couple" to 2.0,
    "half a" to 0.5, "half an" to 0.5, "half" to 0.5,
  )

  /** Casual times of day, resolved to the same hours chrono-node uses for them. */
  private val CASUAL_HOURS = mapOf(
    "morning" to 6, "noon" to 12, "midday" to 12, "afternoon" to 15,
    "evening" to 20, "night" to 20, "tonight" to 22, "midnight" to 0,
  )

  // Both full ("august") and abbreviated ("aug") names, so "Aug 6th" and
  // "August 6th" both resolve.
  private val MONTHS_BY_NAME: Map<String, Month> = Month.entries.flatMap { month ->
    listOf(
      month.getDisplayName(TextStyle.FULL, Locale.US).lowercase() to month,
      month.getDisplayName(TextStyle.SHORT, Locale.US).lowercase() to month,
    )
  }.toMap()

  // Full weekday names only: the three-letter abbreviations collide with
  // ordinary words a reminder is likely to contain ("sun", "sat", "mon"), and
  // a speech recognizer spells weekdays out anyway.
  private val WEEKDAYS_BY_NAME: Map<String, DayOfWeek> = DayOfWeek.entries.associateBy { day ->
    day.getDisplayName(TextStyle.FULL, Locale.US).lowercase()
  }

  private val NUMBER_WORD_ALTERNATION =
    NUMBER_WORDS.keys.sortedByDescending { it.length }.joinToString("|") { Regex.escape(it) }
  private val MONTH_ALTERNATION =
    MONTHS_BY_NAME.keys.sortedByDescending { it.length }.joinToString("|")
  private val WEEKDAY_ALTERNATION = WEEKDAYS_BY_NAME.keys.joinToString("|")
  private val CASUAL_ALTERNATION = CASUAL_HOURS.keys.joinToString("|")

  /**
   * An offset from now. The leading preposition and the trailing "from now"
   * are both optional individually but at least one has to be present, or
   * every "45 minutes" inside a reminder's own text would read as one — see
   * the check in matchOffset.
   */
  private val OFFSET = Regex(
    """(?:\b(in|within|after|for)\s+)?\b($NUMBER_WORD_ALTERNATION|\d{1,4})\s+""" +
      """(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b(\s+from\s+(?:now|today))?""",
    RegexOption.IGNORE_CASE,
  )

  private val DATE_TODAY = Regex("""\b(today|tonight)\b""", RegexOption.IGNORE_CASE)
  private val DATE_TOMORROW = Regex("""\btomorrow\b""", RegexOption.IGNORE_CASE)
  private val DATE_WEEKDAY = Regex(
    """(?:\b(this|next)\s+)?\b($WEEKDAY_ALTERNATION)\b""",
    RegexOption.IGNORE_CASE,
  )
  private val DATE_NEXT_UNIT = Regex(
    """\b(?:this|next)\s+(week|month|year)\b""",
    RegexOption.IGNORE_CASE,
  )
  private val DATE_MONTH_DAY = Regex(
    """\b(?:the\s+)?($MONTH_ALTERNATION)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?!\d)""",
    RegexOption.IGNORE_CASE,
  )
  private val DATE_DAY_MONTH = Regex(
    """\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+of\s+($MONTH_ALTERNATION)\b""",
    RegexOption.IGNORE_CASE,
  )
  private val DATE_NUMERIC = Regex("""\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?!\d)""")

  /**
   * A clock time. Everything but the hour is optional, so a match only counts
   * when something marks it as a time rather than a number inside the
   * reminder's own text: a leading preposition, ":30" minutes, an am/pm, or
   * "o'clock" (see matchClockTime). The trailing (?!\w) rather than \b is
   * what lets the meridiem swallow the final "." of "p.m." — with \b the
   * regex backtracks to "p.m" and strands the period at the head of the
   * details.
   */
  private val TIME_OF_DAY = Regex(
    """(?:\b(at|for|by|around)\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?""" +
      """(\s*o'?\s?clock)?(?!\w)""",
    RegexOption.IGNORE_CASE,
  )
  // The determiner rides along in the match ("*this* afternoon"), or it would
  // be left stranded at the head of the details.
  private val CASUAL_TIME = Regex(
    """(?:\b(?:this|in\s+the|the)\s+)?\b($CASUAL_ALTERNATION)\b""",
    RegexOption.IGNORE_CASE,
  )

  // Mirrors the identically-named constants in src/lib/voiceReminder.ts.
  private val FILLER_PREFIX =
    Regex("""^(please\s+)?(set|create)\s+(up\s+)?(a|an)\s+reminder\s*""", RegexOption.IGNORE_CASE)
  private val REMIND_ME_PREFIX = Regex("""^(please\s+)?remind\s+me\s*""", RegexOption.IGNORE_CASE)
  private val CONNECTOR_PREFIX = Regex("""^(for|to|that)\s+""", RegexOption.IGNORE_CASE)
  private val TRAILING_PREPOSITION = Regex("""\b(on|in|at|for|by|around)\s*$""", RegexOption.IGNORE_CASE)
  private val LEADING_PUNCTUATION = Regex("""^[\s,.;:!?]+""")
  private val WHITESPACE_RUN = Regex("""\s+""")

  /**
   * A matched day, and the span of the transcript it was read from.
   * `fromWeekday` marks the days that were named relatively ("on Wednesday"),
   * which roll a week on when the moment they resolve to has already gone —
   * see rollForwardIfImplied.
   */
  private data class DateMatch(val date: LocalDate, val range: IntRange, val fromWeekday: Boolean = false)

  /**
   * Outcome of the day scan. Invalid — a day expression that can't be a real
   * date, "February 30" — is deliberately not the same as None: chrono-node
   * discards the whole time clause in-app rather than reading a time out of
   * the rest of the sentence, so the phrase is treated as naming no time.
   */
  private sealed interface DateResult {
    class Found(val match: DateMatch) : DateResult
    object Invalid : DateResult
    object None : DateResult
  }

  /**
   * A matched time of day: either a clock reading (hour, with optional minute
   * and am/pm) or a casual word resolved to a fixed hour, never both.
   */
  private data class TimeMatch(
    val range: IntRange,
    val hour: Int = 0,
    val minute: Int = 0,
    val isPm: Boolean? = null,
    val casualHour: Int? = null,
  )

  fun parse(
    rawTranscript: String,
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
  ): ParsedReminder? {
    val clean = rawTranscript.trim()
    if (clean.isEmpty()) return null

    val nowLocal = LocalDateTime.ofInstant(Instant.ofEpochMilli(now), zone)

    val offset = matchOffset(clean, now)
    if (offset != null) {
      val details = extractDetails(clean, listOf(offset.second)) ?: return null
      return ParsedReminder(details, offset.first)
    }

    val dateResult = matchDate(clean, nowLocal.toLocalDate())
    if (dateResult is DateResult.Invalid) {
      return extractDetails(clean, emptyList())?.let { ParsedReminder(it, null) }
    }
    val date = (dateResult as? DateResult.Found)?.match
    // A date is matched first so the time scan can skip the digits it already
    // claimed: "9/1/2026 at 5:30pm" otherwise reads the "for 9" of "for
    // 9/1/2026" as the time and leaves the real one in the details.
    val time = matchClockTime(clean, date?.range) ?: matchCasualTime(clean, date?.range)

    val details = extractDetails(clean, listOfNotNull(date?.range, time?.range)) ?: return null
    // Nothing about *when* in the sentence ("remind me to call mom"): still a
    // usable reminder, just one only the New Reminder form can finish — the
    // in-app parser hands back the same details-with-no-time result, and
    // VoiceQuickCreateActivity opens the form prefilled with it.
    if (date == null && time == null) return ParsedReminder(details, null)

    val moment = compose(date, time, nowLocal) ?: return null
    return ParsedReminder(details, moment.toEpochMilli(zone))
  }

  /** Combines whichever of the day and the time the phrase supplied. */
  private fun compose(date: DateMatch?, time: TimeMatch?, now: LocalDateTime): LocalDateTime? {
    val day = date?.date ?: now.toLocalDate()

    // A day with no clock time at all.
    if (time == null) {
      return rollForwardIfImplied(LocalDateTime.of(day, LocalTime.of(DEFAULT_HOUR, 0)), date, now)
    }

    // "this afternoon", "tonight", "tomorrow morning": a fixed hour. With no
    // day named, one that has already passed means the next one — the same
    // roll-forward chrono-node applies in-app.
    if (time.casualHour != null) {
      return rollForwardIfImplied(LocalDateTime.of(day, LocalTime.of(time.casualHour, 0)), date, now)
    }

    if (time.minute !in 0..59) return null
    // An explicit am/pm, or a 24-hour reading that can't be anything else.
    if (time.isPm != null) {
      if (time.hour !in 1..12) return null
      val hour = when {
        time.hour == 12 && !time.isPm -> 0
        time.hour == 12 -> 12
        time.isPm -> time.hour + 12
        else -> time.hour
      }
      return rollForwardIfImplied(LocalDateTime.of(day, LocalTime.of(hour, time.minute)), date, now)
    }
    if (time.hour == 0 || time.hour in 13..23) {
      return rollForwardIfImplied(LocalDateTime.of(day, LocalTime.of(time.hour, time.minute)), date, now)
    }
    if (time.hour !in 1..12) return null
    return resolveAmbiguousTime(day, time.hour, time.minute, now)
  }

  /**
   * A time of day the user named without saying which day ("at 5 p.m.", "this
   * evening") means the next one to come round, so a reading that has already
   * passed today belongs to tomorrow — the same roll-forward chrono-node
   * applies in-app. A weekday rolls the same way, by a week: said late on a
   * Wednesday, "Wednesday night" is next Wednesday. A day named outright
   * ("tomorrow", "August 6th") is left alone.
   */
  private fun rollForwardIfImplied(moment: LocalDateTime, date: DateMatch?, now: LocalDateTime): LocalDateTime = when {
    !moment.isBefore(now) -> moment
    date == null -> moment.plusDays(1)
    date.fromWeekday -> moment.plusWeeks(1)
    else -> moment
  }

  /** "in two hours", "30 minutes from now". */
  private fun matchOffset(clean: String, now: Long): Pair<Long, IntRange>? {
    val match = OFFSET.findAll(clean).firstOrNull { candidate ->
      // Neither "in ..." nor "... from now": just a number inside the details.
      candidate.groupValues[1].isNotEmpty() || candidate.groupValues[4].isNotEmpty()
    } ?: return null

    val rawAmount = match.groupValues[2].lowercase()
    val amount = NUMBER_WORDS[rawAmount] ?: rawAmount.toDoubleOrNull() ?: return null
    val unit = match.groupValues[3].lowercase().trimEnd('s')
    // Added in UTC, so an offset is a fixed span of time rather than a walk
    // across the calendar: "in 7 days" over a daylight-saving change lands
    // 168 hours out, an hour off the local wall clock, which is what
    // chrono-node hands the in-app parser for the same phrase.
    val base = LocalDateTime.ofInstant(Instant.ofEpochMilli(now), ZoneOffset.UTC)
    val moment = when {
      unit.startsWith("min") -> base.plusSeconds((amount * 60).toLong())
      unit.startsWith("h") -> base.plusSeconds((amount * 3600).toLong())
      unit == "day" -> base.plusDays(amount.toLong())
      unit == "week" -> base.plusWeeks(amount.toLong())
      unit == "month" -> base.plusMonths(amount.toLong())
      unit == "year" -> base.plusYears(amount.toLong())
      else -> return null
    }
    return moment.toInstant(ZoneOffset.UTC).toEpochMilli() to match.range
  }

  /** The earliest day expression in the transcript, whichever shape it takes. */
  private fun matchDate(clean: String, today: LocalDate): DateResult {
    val weekday = DATE_WEEKDAY.find(clean)
    val candidates: List<Pair<MatchResult, LocalDate?>> = listOfNotNull(
      DATE_TODAY.find(clean)?.let { it to today },
      DATE_TOMORROW.find(clean)?.let { it to today.plusDays(1) },
      weekday?.let { it to resolveWeekday(it, today) },
      DATE_NEXT_UNIT.find(clean)?.let {
        it to when (it.groupValues[1].lowercase()) {
          "week" -> today.plusWeeks(1)
          "month" -> today.plusMonths(1)
          else -> today.plusYears(1)
        }
      },
      DATE_MONTH_DAY.find(clean)?.let { it to resolveMonthDay(it, today) },
      DATE_DAY_MONTH.find(clean)?.let { it to resolveDayMonth(it, today) },
      DATE_NUMERIC.find(clean)?.let { it to resolveNumericDate(it, today) },
    )
    val earliest = candidates.minByOrNull { it.first.range.first } ?: return DateResult.None
    val date = earliest.second ?: return DateResult.Invalid
    return DateResult.Found(
      DateMatch(date, earliest.first.range, fromWeekday = weekday?.range == earliest.first.range),
    )
  }

  /**
   * A bare or "this"-prefixed weekday is the next one to come round, today
   * included. "next <weekday>" is that weekday in the *following* calendar
   * week, which is how chrono-node reads it in-app: said on a Wednesday,
   * "next Monday" is five days out and "next Friday" is nine, not two.
   */
  private fun resolveWeekday(match: MatchResult, today: LocalDate): LocalDate? {
    val weekday = WEEKDAYS_BY_NAME[match.groupValues[2].lowercase()] ?: return null
    if (match.groupValues[1].equals("next", ignoreCase = true)) {
      val daysToNextMonday = ((DayOfWeek.MONDAY.value - today.dayOfWeek.value + 7) % 7).let {
        if (it == 0) 7 else it
      }
      return today.plusDays(daysToNextMonday.toLong() + (weekday.value - 1))
    }
    return today.plusDays(((weekday.value - today.dayOfWeek.value + 7) % 7).toLong())
  }

  private fun resolveMonthDay(match: MatchResult, today: LocalDate): LocalDate? {
    val month = MONTHS_BY_NAME[match.groupValues[1].lowercase()] ?: return null
    val day = match.groupValues[2].toIntOrNull() ?: return null
    val explicitYear = match.groupValues[3].toIntOrNull()
    return calendarDate(explicitYear, month.value, day, today)
  }

  private fun resolveDayMonth(match: MatchResult, today: LocalDate): LocalDate? {
    val day = match.groupValues[1].toIntOrNull() ?: return null
    val month = MONTHS_BY_NAME[match.groupValues[2].lowercase()] ?: return null
    return calendarDate(null, month.value, day, today)
  }

  private fun resolveNumericDate(match: MatchResult, today: LocalDate): LocalDate? {
    val month = match.groupValues[1].toIntOrNull() ?: return null
    val day = match.groupValues[2].toIntOrNull() ?: return null
    if (month !in 1..12) return null
    val explicitYear = match.groupValues[3].toIntOrNull()?.let { if (it < 100) 2000 + it else it }
    return calendarDate(explicitYear, month, day, today)
  }

  /**
   * No explicit year, and the day has already passed this year: roll forward
   * rather than silently arming a reminder in the past (mirrors chrono-node's
   * forwardDate option on the in-app side).
   */
  private fun calendarDate(explicitYear: Int?, month: Int, day: Int, today: LocalDate): LocalDate? {
    val candidate = try {
      LocalDate.of(explicitYear ?: today.year, month, day)
    } catch (_: java.time.DateTimeException) {
      return null
    }
    return if (explicitYear == null && candidate.isBefore(today)) candidate.plusYears(1) else candidate
  }

  /**
   * The first digit group that actually reads as a time. A number with no
   * preposition, no minutes, no am/pm and no "o'clock" is part of the
   * reminder's own text ("pay the 300 dollar bill"), not a time, so the scan
   * keeps going.
   */
  private fun matchClockTime(clean: String, dateRange: IntRange?): TimeMatch? {
    val match = TIME_OF_DAY.findAll(clean).firstOrNull { candidate ->
      if (candidate.range.overlaps(dateRange)) return@firstOrNull false
      // Validated here rather than in compose(): a reading that can't be a
      // time ("at 5:75") is part of the reminder's own text, so the scan has
      // to keep going instead of failing the parse.
      val hour = candidate.groupValues[2].toIntOrNull() ?: return@firstOrNull false
      val minute = candidate.groupValues[3].ifEmpty { "0" }.toIntOrNull() ?: return@firstOrNull false
      if (hour > 23 || minute > 59) return@firstOrNull false
      if (candidate.groupValues[4].isNotEmpty() && hour !in 1..12) return@firstOrNull false
      candidate.groupValues[1].isNotEmpty() ||
        candidate.groupValues[3].isNotEmpty() ||
        candidate.groupValues[4].isNotEmpty() ||
        candidate.groupValues[5].isNotEmpty()
    } ?: return null

    val meridiem = match.groupValues[4]
    return TimeMatch(
      range = match.range,
      hour = match.groupValues[2].toIntOrNull() ?: return null,
      minute = match.groupValues[3].ifEmpty { "0" }.toIntOrNull() ?: return null,
      isPm = if (meridiem.isEmpty()) null else meridiem.startsWith("p", ignoreCase = true),
    )
  }

  private fun matchCasualTime(clean: String, dateRange: IntRange?): TimeMatch? {
    // "tonight" is read as both the day and the time, so an overlap with the
    // day's own match is expected there and only the *other* patterns need
    // skipping — see mergeRanges in extractDetails.
    val match = CASUAL_TIME.findAll(clean).firstOrNull { candidate ->
      CASUAL_HOURS.containsKey(candidate.groupValues[1].lowercase()) &&
        (!candidate.range.overlaps(dateRange) || candidate.groupValues[1].equals("tonight", ignoreCase = true))
    } ?: return null
    val hour = CASUAL_HOURS[match.groupValues[1].lowercase()] ?: return null
    return TimeMatch(range = match.range, casualHour = hour)
  }

  private fun IntRange.overlaps(other: IntRange?): Boolean =
    other != null && first <= other.last && other.first <= last

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
   * is already >= `now`, so this simply picks the AM reading — the same
   * result a fixed-AM reading would give, so this is a pure generalization of
   * it, not a regression for that case.
   *
   * Note hour 12 has two same-day readings too (00:00 then 12:00), so a
   * bare "at 12:00" late in the day can resolve to the *next calendar day's
   * midnight* rather than the more colloquial "noon" — accepted, since it is
   * still the literal nearest future occurrence of "12:00" and this function
   * has no way to know "noon" was meant instead.
   */
  private fun resolveAmbiguousTime(date: LocalDate, hour: Int, minute: Int, now: LocalDateTime): LocalDateTime {
    val amHour = if (hour == 12) 0 else hour
    val pmHour = if (hour == 12) 12 else hour + 12
    val candidates = listOf(
      LocalDateTime.of(date, LocalTime.of(amHour, minute)),
      LocalDateTime.of(date, LocalTime.of(pmHour, minute)),
      LocalDateTime.of(date.plusDays(1), LocalTime.of(amHour, minute)),
    )
    return candidates.firstOrNull { !it.isBefore(now) } ?: candidates.last()
  }

  /**
   * Removes the matched time-clause ranges from the transcript, strips filler
   * phrasing and the dangling preposition/connector words and punctuation
   * those clauses leave behind, and caps the result the same way
   * CreateReminderReceiver does. Mirrors cleanRemainder in
   * src/lib/voiceReminder.ts. Null means nothing usable survived.
   */
  private fun extractDetails(clean: String, consumedRanges: List<IntRange>): String? {
    val builder = StringBuilder()
    var cursor = 0
    // A day and a time can be read from the same words ("tonight" is both), so
    // overlapping ranges are merged rather than cut out twice.
    for (range in mergeRanges(consumedRanges)) {
      if (range.first > cursor) {
        builder.append(clean.substring(cursor, range.first).replace(TRAILING_PREPOSITION, ""))
      }
      builder.append(' ')
      cursor = maxOf(cursor, range.last + 1)
    }
    builder.append(clean.substring(cursor))

    var remainder = builder.toString().replace(WHITESPACE_RUN, " ").trim()
    // A leading filler phrase can precede the time clause ("set a reminder in
    // one hour for take out the trash"), so strip it, then the connector that
    // introduces the details ("...for take out the trash"), then repeat once
    // more in case the filler was still ahead of a connector left behind by
    // removal.
    repeat(2) {
      remainder = remainder.replace(LEADING_PUNCTUATION, "")
      remainder = remainder.replace(FILLER_PREFIX, "").replace(REMIND_ME_PREFIX, "").trim()
      remainder = remainder.replace(CONNECTOR_PREFIX, "").trim()
    }
    remainder = remainder.replace(LEADING_PUNCTUATION, "").trim()

    if (remainder.isEmpty()) return null
    return if (remainder.length > DETAILS_MAX_LENGTH) remainder.take(DETAILS_MAX_LENGTH) else remainder
  }

  private fun mergeRanges(ranges: List<IntRange>): List<IntRange> {
    val sorted = ranges.sortedBy { it.first }
    val merged = mutableListOf<IntRange>()
    for (range in sorted) {
      val last = merged.lastOrNull()
      if (last != null && range.first <= last.last + 1) {
        merged[merged.size - 1] = last.first..maxOf(last.last, range.last)
      } else {
        merged.add(range)
      }
    }
    return merged
  }

  private fun LocalDateTime.toEpochMilli(zone: ZoneId): Long =
    atZone(zone).toInstant().toEpochMilli()
}
