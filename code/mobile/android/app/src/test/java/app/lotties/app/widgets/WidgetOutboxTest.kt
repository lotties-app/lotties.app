package app.lotties.app.widgets

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetOutboxTest {
    private val now = Iso.parse("2026-11-01T15:04:05.678Z")!!

    /** The checks of code/web/src/widgets/outbox.ts `parseOutbox` (an entry failing them is dropped by the app). */
    private fun assertWebAccepts(entry: JSONObject) {
        assertTrue(entry.get("id") is String)
        assertTrue(entry.get("babyId") is String)
        assertTrue(entry.getString("type") in OutboxType.all)
        assertNotNull(Iso.parse(entry.getString("occurredAt")))
        assertTrue(entry.get("payload") is JSONObject)
        assertEquals("widget", entry.getString("source"))
        assertEquals(setOf("id", "babyId", "type", "occurredAt", "payload", "source"), entry.keys().asSequence().toSet())
    }

    /** The payload's fields (the JVM org.json does not keep the key order). */
    private fun payload(request: WidgetRequest): Map<String, Any> {
        val json = WidgetOutbox.entry(request, "b1", now, id = "e1").getJSONObject("payload")
        return json.keys().asSequence().associateWith { json.get(it) }
    }

    @Test
    fun entryHasTheOutboxShape() {
        val entry = WidgetOutbox.entry(WidgetRequest.bottle(120), "b1", now, id = "e1")
        assertWebAccepts(entry)
        assertEquals("e1", entry.getString("id"))
        assertEquals("b1", entry.getString("babyId"))
        assertEquals("feed", entry.getString("type"))
        assertEquals("2026-11-01T15:04:05.678Z", entry.getString("occurredAt"))
        assertEquals(now, Iso.parse(entry.getString("occurredAt")))
    }

    @Test
    fun aNewIdEachTime() {
        val a = WidgetOutbox.entry(WidgetRequest.sleepStart(), "b1", now).getString("id")
        val b = WidgetOutbox.entry(WidgetRequest.sleepStart(), "b1", now).getString("id")
        assertTrue(a != b)
        assertTrue(Regex("[0-9a-f-]{36}").matches(a))
    }

    @Test
    fun payloadsMatchTheWebDrain() {
        // feed: bottle needs kind "bottle" and a positive amountMl; breast carries the side.
        assertEquals(mapOf("kind" to "bottle", "amountMl" to 90), payload(WidgetRequest.bottle(90)))
        assertEquals(mapOf("kind" to "breast", "side" to "left"), payload(WidgetRequest.breast("left")))
        assertEquals(mapOf("kind" to "breast"), payload(WidgetRequest.breast("middle")))
        // diaper: kind upper-cased by the app must be WET, DIRTY or MIXED.
        for (kind in listOf("wet", "dirty", "mixed")) {
            assertEquals(mapOf("kind" to kind), payload(WidgetRequest.diaper(kind)))
            assertTrue(kind.uppercase() in listOf("WET", "DIRTY", "MIXED"))
        }
        assertEquals(mapOf("kind" to "wet"), payload(WidgetRequest.diaper("both")))
        // activity: kind is the event type key.
        assertEquals(mapOf("kind" to "tummy_time"), payload(WidgetRequest.activity("tummy_time")))
        // sleep and the feed timer carry nothing.
        for (request in listOf(
            WidgetRequest.sleepStart(), WidgetRequest.sleepEnd(),
            WidgetRequest.feedPause(), WidgetRequest.feedResume(), WidgetRequest.feedStop(),
        )) {
            assertEquals(emptyMap<String, Any>(), payload(request))
            assertWebAccepts(WidgetOutbox.entry(request, "b1", now))
        }
        assertEquals(
            listOf("sleep_start", "sleep_end", "feed_pause", "feed_resume", "feed_stop"),
            listOf(
                WidgetRequest.sleepStart(), WidgetRequest.sleepEnd(),
                WidgetRequest.feedPause(), WidgetRequest.feedResume(), WidgetRequest.feedStop(),
            ).map { it.type },
        )
    }

    private val snapshot = """
        {"version":1,"updatedAt":"2026-11-01T14:00:00.000Z","signedIn":true,"selectedBabyId":"b2",
         "hideNamesOnLockScreen":true,"language":"pt-BR","futureField":{"kept":true},
         "babies":[
          {"id":"b1","name":"Ana"},
          {"id":"b2","name":"Lia","sleep":{"state":"awake","startedAt":"2026-11-01T13:00:00.000Z"},
           "nextNap":{"earliest":"2026-11-01T15:00:00.000Z","expected":"2026-11-01T15:10:00.000Z","latest":"2026-11-01T15:30:00.000Z"},
           "nextFeed":{"at":"2026-11-01T15:20:00.000Z","amountMl":120},
           "nextDiaper":{"at":"2026-11-01T15:30:00.000Z","kind":"wet"},
           "runningFeed":{"kind":"bottle","since":"2026-11-01T15:00:05.678Z","paused":false,"elapsedSeconds":0}}
         ]}
    """.trimIndent()

    @Test
    fun targetBabyIsTheSelectedOneElseTheFirstAndNoneWhenSignedOut() {
        assertEquals("b2", WidgetOutbox.targetBaby(snapshot))
        assertEquals("b1", WidgetOutbox.targetBaby(snapshot.replace("\"selectedBabyId\":\"b2\"", "\"selectedBabyId\":null")))
        assertNull(WidgetOutbox.targetBaby(snapshot.replace("\"signedIn\":true", "\"signedIn\":false")))
        assertNull(WidgetOutbox.targetBaby(null))
        assertNull(WidgetOutbox.targetBaby("not json"))
    }

    private fun applied(request: WidgetRequest): WidgetSnapshot.Baby {
        val text = WidgetOutbox.applyToSnapshot(snapshot, request, "b2", now)
        assertNotNull(text)
        assertTrue(JSONObject(text!!).has("futureField"))
        return WidgetSnapshot.parse(text)!!.babies.first { it.id == "b2" }
    }

    @Test
    fun loggingShowsAtOnceAndClearsTheEstimate() {
        val bottle = applied(WidgetRequest.bottle(150))
        assertEquals(WidgetSnapshot.Feed(now, "bottle", 150, null), bottle.lastFeed)
        assertNull(bottle.nextFeed)

        val breast = applied(WidgetRequest.breast("right"))
        assertEquals("right", breast.lastFeed?.side)
        assertEquals(WidgetSnapshot.RunningFeed("breast", now, false, 0), breast.runningFeed)

        val diaper = applied(WidgetRequest.diaper("dirty"))
        assertEquals(WidgetSnapshot.Diaper(now, "dirty"), diaper.lastDiaper)
        assertNull(diaper.nextDiaper)

        val asleep = applied(WidgetRequest.sleepStart())
        assertEquals(WidgetSnapshot.Sleep(true, now), asleep.sleep)
        assertNull(asleep.nextNap)

        assertEquals(WidgetSnapshot.Sleep(false, now), applied(WidgetRequest.sleepEnd()).sleep)
        assertEquals(now, applied(WidgetRequest.activity("bath")).lastActivity["bath"])
    }

    @Test
    fun feedTimerPauseFreezesTheElapsedTimeAndResumeShiftsTheStart() {
        val paused = applied(WidgetRequest.feedPause()).runningFeed!!
        assertTrue(paused.paused)
        assertEquals(240, paused.elapsedSeconds) // 15:00:05.678 to 15:04:05.678
        assertNull(applied(WidgetRequest.feedStop()).runningFeed)

        val pausedText = WidgetOutbox.applyToSnapshot(snapshot, WidgetRequest.feedPause(), "b2", now)
        val later = now + 600_000L
        val resumed = WidgetSnapshot.parse(
            WidgetOutbox.applyToSnapshot(pausedText, WidgetRequest.feedResume(), "b2", later),
        )!!.babies.first { it.id == "b2" }.runningFeed!!
        assertFalse(resumed.paused)
        assertEquals(later - 240_000L, resumed.since)
    }

    @Test
    fun nothingToApplyWithoutSnapshotOrBaby() {
        assertNull(WidgetOutbox.applyToSnapshot(null, WidgetRequest.sleepStart(), "b2", now))
        assertNull(WidgetOutbox.applyToSnapshot(snapshot, WidgetRequest.sleepStart(), "nobody", now))
        assertNull(WidgetOutbox.applyToSnapshot("{oops", WidgetRequest.sleepStart(), "b2", now))
    }
}
