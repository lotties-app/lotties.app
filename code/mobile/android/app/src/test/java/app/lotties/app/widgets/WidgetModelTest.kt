package app.lotties.app.widgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetModelTest {
    @Test
    fun isoReadsWhatTheWebWritesAndOffsets() {
        val utc = Iso.parse("2026-11-01T10:00:00.000Z")!!
        assertEquals(utc, Iso.parse("2026-11-01T10:00:00Z"))
        assertEquals(utc, Iso.parse("2026-11-01T07:00:00-03:00"))
        assertEquals(utc + 120, Iso.parse("2026-11-01T10:00:00.12Z"))
        assertEquals("2026-11-01T10:00:00.000Z", Iso.format(utc))
        assertNull(Iso.parse("yesterday"))
        assertNull(Iso.parse(null))
    }

    @Test
    fun parsesTheSnapshotOfTheWebApp() {
        val text = """
            {"version":1,"updatedAt":"2026-11-01T14:00:00.000Z","signedIn":true,"selectedBabyId":"b1",
             "hideNamesOnLockScreen":false,"language":"en",
             "babies":[{"id":"b1","name":"Lia",
               "sleep":{"state":"asleep","startedAt":"2026-11-01T13:00:00.000Z"},
               "lastFeed":{"at":"2026-11-01T12:00:00.000Z","kind":"bottle","amountMl":120},
               "lastDiaper":{"at":"2026-11-01T12:30:00.000Z","kind":"mixed"},
               "lastActivity":{"bath":"2026-10-31T19:00:00.000Z","bogus":"nope"},
               "nextFeed":{"at":"2026-11-01T15:00:00.000Z"}}]}
        """.trimIndent()
        val snapshot = WidgetSnapshot.parse(text)!!
        assertTrue(snapshot.signedIn)
        assertFalse(snapshot.hideNamesOnLockScreen)
        assertEquals("en", snapshot.language)
        val baby = snapshot.selectedBaby!!
        assertEquals("Lia", baby.name)
        assertTrue(baby.sleep!!.asleep)
        assertEquals(120, baby.lastFeed!!.amountMl)
        assertEquals("mixed", baby.lastDiaper!!.kind)
        assertEquals(setOf("bath"), baby.lastActivity.keys)
        assertNull(baby.nextFeed!!.amountMl)
        assertNull(baby.runningFeed)
    }

    @Test
    fun missingOrBrokenSnapshotIsNone() {
        assertNull(WidgetSnapshot.parse(null))
        assertNull(WidgetSnapshot.parse(""))
        assertNull(WidgetSnapshot.parse("[1,2"))
        val signedOut = WidgetSnapshot.parse("""{"signedIn":false,"babies":[]}""")!!
        assertFalse(signedOut.signedIn)
        assertNull(signedOut.selectedBaby)
        assertTrue(signedOut.hideNamesOnLockScreen) // names hidden on a lock screen unless the app says otherwise
    }
}
