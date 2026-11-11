package app.lotties.app.widgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class WidgetLogicTest {
    private val now = Iso.parse("2026-11-01T15:00:00.000Z")!!
    private fun minutesAgo(m: Int) = now - m * 60_000L
    private fun minutesAhead(m: Int) = now + m * 60_000L

    // "ago" text (LottiesText.ago / agoRounded on iOS)

    @Test
    fun agoUnderAMinuteIsJustNow() {
        assertEquals(Ago.JustNow, Ago.of(now - 59_000L, now))
        assertNull(Ago.rounded(now, now).units())
        assertEquals(Ago.JustNow, Ago.of(now + 60_000L, now)) // a time ahead counts as now
    }

    @Test
    fun agoMinutesUnderAnHour() {
        assertEquals("1 min", Ago.rounded(minutesAgo(1), now).units())
        assertEquals("35 min", Ago.rounded(minutesAgo(35), now).units())
        assertEquals("59 min", Ago.rounded(minutesAgo(59), now).units())
    }

    @Test
    fun roundedHoursGoDownToTheHalfHourWithAPlus() {
        assertEquals("1 h+", Ago.rounded(minutesAgo(60), now).units())
        assertEquals("2 h+", Ago.rounded(minutesAgo(2 * 60 + 10), now).units())
        assertEquals("2 h+", Ago.rounded(minutesAgo(2 * 60 + 29), now).units())
        assertEquals("2 h 30+", Ago.rounded(minutesAgo(2 * 60 + 30), now).units())
        assertEquals("2 h 30+", Ago.rounded(minutesAgo(2 * 60 + 59), now).units())
        assertEquals("23 h 30+", Ago.rounded(minutesAgo(24 * 60 - 1), now).units())
    }

    @Test
    fun plainAgoKeepsTheMinutes() {
        assertEquals("2 h", Ago.of(minutesAgo(120), now).units())
        assertEquals("2 h 10 min", Ago.of(minutesAgo(130), now).units())
        assertEquals("1 d 3 h", Ago.of(minutesAgo(27 * 60 + 5), now).units())
        assertEquals("1 d 3 h", Ago.rounded(minutesAgo(27 * 60 + 5), now).units())
    }

    @Test
    fun sameDayFollowsTheZone() {
        val utc = TimeZone.getTimeZone("UTC")
        assertTrue(isSameDay(Iso.parse("2026-11-01T00:00:00Z")!!, now, utc))
        assertFalse(isSameDay(Iso.parse("2026-10-31T23:59:00Z")!!, now, utc))
        // 00:30 UTC on Nov 1 is still Oct 31 in Sao Paulo (UTC-3), where now is Nov 1 12:00.
        assertTrue(isSameDay(Iso.parse("2026-11-01T00:30:00Z")!!, now, utc))
        assertFalse(isSameDay(Iso.parse("2026-11-01T00:30:00Z")!!, now, TimeZone.getTimeZone("America/Sao_Paulo")))
    }

    // Coming up (WidgetSnapshot.Baby.due on iOS)

    private fun baby(
        asleep: Boolean = false,
        nap: Long? = null,
        feed: Long? = null,
        diaper: Long? = null,
    ) = WidgetSnapshot.Baby(
        id = "b1",
        name = "Lia",
        sleep = WidgetSnapshot.Sleep(asleep, minutesAgo(30)),
        nextNap = nap?.let { WidgetSnapshot.NapWindow(it - 600_000L, it, it + 600_000L) },
        nextFeed = feed?.let { WidgetSnapshot.NextFeed(it, 120) },
        nextDiaper = diaper?.let { WidgetSnapshot.NextDiaper(it, "dirty") },
    )

    @Test
    fun dueFromTwentyMinutesBeforeUntilThirtyAfter() {
        assertFalse(DueRules.due(baby(feed = minutesAhead(21)), now).feed)
        assertTrue(DueRules.due(baby(feed = minutesAhead(20)), now).feed)
        assertTrue(DueRules.due(baby(feed = now), now).feed)
        assertTrue(DueRules.due(baby(feed = minutesAgo(30)), now).feed)
        assertFalse(DueRules.due(baby(feed = minutesAgo(31)), now).feed)
    }

    @Test
    fun napIsNeverDueWhileAsleepAndDiaperCarriesItsKind() {
        assertTrue(DueRules.due(baby(nap = minutesAhead(5)), now).nap)
        assertFalse(DueRules.due(baby(asleep = true, nap = minutesAhead(5)), now).nap)
        assertEquals("dirty", DueRules.due(baby(diaper = minutesAgo(10)), now).diaperKind)
        assertNull(DueRules.due(baby(diaper = minutesAhead(60)), now).diaperKind)
        assertFalse(DueRules.due(baby(), now).any)
    }

    @Test
    fun dueChangesAreTheWindowEdgesAheadWithinADay() {
        val feed = minutesAhead(60)
        val diaper = minutesAgo(10) // window opened already; only its end is ahead
        val changes = DueRules.dueChanges(baby(feed = feed, diaper = diaper), now)
        assertEquals(listOf(diaper + DueRules.GRACE_MS, feed - DueRules.LEAD_MS, feed + DueRules.GRACE_MS), changes)
        assertTrue(DueRules.dueChanges(baby(feed = now + 25 * 3_600_000L), now).isEmpty())
    }

    // Choices inside the widget (LottiesPicker on iOS)

    @Test
    fun aChoiceStaysOpenForTwentyFiveSeconds() {
        val open = OpenPicker.opening(PickerTarget.DIAPER, now)
        assertEquals(now + 25_000L, open.until)
        assertEquals(open, OpenPicker.current("diaper", open.until, now + 24_999L))
        assertNull(OpenPicker.current("diaper", open.until, now + 25_000L))
        assertNull(OpenPicker.current("unknown", open.until, now))
        assertNull(OpenPicker.current(null, 0L, now))
    }

    @Test
    fun bottleChoicesPutTheLastAmountFirst() {
        fun withLast(ml: Int?, kind: String = "bottle") =
            baby().copy(lastFeed = WidgetSnapshot.Feed(minutesAgo(90), kind, ml, null))
        assertEquals(listOf(100, 60, 90, 120), Choices.bottleAmounts(withLast(100)))
        assertEquals(listOf(120, 60, 90, 150), Choices.bottleAmounts(withLast(120)))
        assertEquals(listOf(60, 90, 120, 150), Choices.bottleAmounts(withLast(null)))
        assertEquals(listOf(60, 90, 120, 150), Choices.bottleAmounts(withLast(80, kind = "breast")))
    }

    @Test
    fun quickTilesSwapTheFeedButtonsForPauseAndStopWhileAFeedRuns() {
        val slots = WidgetActivity.defaultSlots
        assertEquals(
            listOf(
                QuickItem.Activity(WidgetActivity.BOTTLE),
                QuickItem.Activity(WidgetActivity.DIAPER),
                QuickItem.Activity(WidgetActivity.BREAST),
                QuickItem.More,
            ),
            QuickItem.items(slots, null),
        )
        val bottle = WidgetSnapshot.RunningFeed("bottle", minutesAgo(5), paused = true, elapsedSeconds = 300)
        assertEquals(
            listOf(QuickItem.Pause(true), QuickItem.Stop, QuickItem.Activity(WidgetActivity.DIAPER), QuickItem.More),
            QuickItem.items(slots, bottle),
        )
        val breast = bottle.copy(kind = "breast", paused = false)
        assertEquals(
            listOf(QuickItem.Stop, QuickItem.Activity(WidgetActivity.DIAPER), QuickItem.More),
            QuickItem.items(slots, breast),
        )
    }

    @Test
    fun theActivityKeysAreTheWebOnes() {
        // code/web/src/widgets/activities.ts WIDGET_ACTIVITY_KEYS, in order.
        assertEquals(
            listOf("bath", "belly_massage", "tummy_time", "nasal_suction", "nail_trim", "skin_care", "outdoor", "fussy"),
            WidgetActivity.webActivityKeys,
        )
    }

    @Test
    fun theNextRenderIsTheSoonestOfChoiceEndHighlightChangeAndFifteenMinutes() {
        assertEquals(now + RefreshPlan.PERIOD_MS, RefreshPlan.next(now, null, null))
        val picker = OpenPicker.opening(PickerTarget.MORE, now)
        assertEquals(picker.until, RefreshPlan.next(now, baby(feed = minutesAhead(25)), picker))
        assertEquals(minutesAhead(5), RefreshPlan.next(now, baby(feed = minutesAhead(25)), null))
        // A row's "há 3 min" changes before the highlight and the 15 minutes.
        val changed = baby(feed = minutesAhead(25)).copy(lastDiaper = WidgetSnapshot.Diaper(minutesAgo(3) - 5_000L, "wet"))
        assertEquals(minutesAgo(3) - 5_000L + 4 * 60_000L, RefreshPlan.next(now, changed, null, utc))
    }

    // Texts that change with time alone (WidgetSnapshot.Baby.textChanges on iOS)

    private val utc = TimeZone.getTimeZone("UTC")

    @Test
    fun theAgoChangesEachMinuteInTheFirstHourThenEachHalfHourUntilADay() {
        val at = minutesAgo(10) - 15_000L
        assertEquals(at + 11 * 60_000L, TextChanges.agoChangeAfter(at, now))
        assertEquals(minutesAhead(1), TextChanges.agoChangeAfter(minutesAgo(59), now)) // "59 min" -> "1 h+"
        assertEquals(minutesAhead(29), TextChanges.agoChangeAfter(minutesAgo(61), now)) // "1 h+" -> "1 h 30+"
        assertEquals(minutesAhead(30), TextChanges.agoChangeAfter(minutesAgo(90), now))
        assertEquals(minutesAhead(1), TextChanges.agoChangeAfter(minutesAgo(24 * 60 - 1), now))
        assertNull(TextChanges.agoChangeAfter(minutesAgo(24 * 60), now))
        assertEquals(minutesAhead(3), TextChanges.agoChangeAfter(minutesAhead(2), now)) // ahead: "just now" until +1 min
    }

    @Test
    fun theAgoChangeIsExactlyWhenTheRoundedTextChanges() {
        for (seconds in 0L until 24 * 3600L step 173L) {
            val at = now - seconds * 1000L
            val change = TextChanges.agoChangeAfter(at, now) ?: continue
            assertTrue(change > now)
            assertEquals(Ago.rounded(at, now), Ago.rounded(at, change - 1))
            assertTrue(Ago.rounded(at, now) != Ago.rounded(at, change))
        }
    }

    @Test
    fun nextMidnightFollowsTheZone() {
        assertEquals(Iso.parse("2026-11-02T00:00:00Z"), TextChanges.nextMidnight(now, utc))
        // 15:00 UTC is 12:00 in Sao Paulo (UTC-3): its next midnight is 03:00 UTC.
        assertEquals(
            Iso.parse("2026-11-02T03:00:00Z"),
            TextChanges.nextMidnight(now, TimeZone.getTimeZone("America/Sao_Paulo")),
        )
    }

    @Test
    fun theNextTextChangeIsTheSoonestOfTheRowsTheEstimatesAndMidnight() {
        val quiet = baby()
        assertEquals(Iso.parse("2026-11-02T00:00:00Z"), TextChanges.next(quiet, now, utc))
        val fedAt = minutesAgo(90) - 20_000L
        val fed = quiet.copy(lastFeed = WidgetSnapshot.Feed(fedAt, "bottle", 120, null))
        assertEquals(fedAt + 120 * 60_000L, TextChanges.next(fed, now, utc))
        val estimate = fed.copy(nextFeed = WidgetSnapshot.NextFeed(minutesAhead(12), 120))
        assertEquals(minutesAhead(12), TextChanges.next(estimate, now, utc))
        val bathAt = minutesAgo(30) - 50_000L
        val bathed = estimate.copy(lastActivity = mapOf("bath" to bathAt))
        assertEquals(bathAt + 31 * 60_000L, TextChanges.next(bathed, now, utc))
    }
}
