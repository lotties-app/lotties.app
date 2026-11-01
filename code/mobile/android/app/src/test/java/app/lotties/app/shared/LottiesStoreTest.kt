package app.lotties.app.shared

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class LottiesStoreTest {
    @get:Rule
    val folder = TemporaryFolder()

    private fun dir(): File = File(folder.root, LottiesStore.DIRECTORY)

    private fun entry(id: String) = JSONObject()
        .put("id", id).put("babyId", "b1").put("type", "diaper")
        .put("occurredAt", "2026-11-01T10:00:00Z").put("payload", JSONObject().put("kind", "wet"))
        .put("source", "widget").toString()

    private fun ids(json: String): List<String> {
        val array = JSONArray(json)
        return (0 until array.length()).map { array.getJSONObject(it).getString("id") }
    }

    @Test
    fun missingFilesReadAsNothing() {
        val dir = dir()
        assertNull(LottiesStore.readSnapshot(dir))
        assertEquals("[]", LottiesStore.readOutbox(dir))
        assertEquals(-1L, LottiesStore.fileBytes(dir, LottiesStore.SNAPSHOT_FILE))
    }

    @Test
    fun snapshotIsStoredAsIsAndReplaced() {
        val dir = dir()
        LottiesStore.writeSnapshot(dir, """{"version":1,"signedIn":true}""")
        LottiesStore.writeSnapshot(dir, """{"version":1,"signedIn":false}""")
        assertEquals("""{"version":1,"signedIn":false}""", LottiesStore.readSnapshot(dir))
        assertTrue(LottiesStore.fileBytes(dir, LottiesStore.SNAPSHOT_FILE) > 0)
    }

    @Test
    fun writesLeaveNoTemporaryFiles() {
        val dir = dir()
        repeat(5) { LottiesStore.writeSnapshot(dir, """{"n":$it}""") }
        LottiesStore.appendOutbox(dir, entry("a"))
        val names = dir.list()!!.toSet()
        assertEquals(setOf(".lock", LottiesStore.SNAPSHOT_FILE, LottiesStore.OUTBOX_FILE), names)
    }

    @Test
    fun readersNeverSeeHalfASnapshot() {
        val dir = dir()
        val big = (0 until 2000).joinToString(",", "[", "]") { "\"item-$it\"" }
        val a = """{"v":"a","items":$big}"""
        val b = """{"v":"b","items":$big}"""
        LottiesStore.writeSnapshot(dir, a)
        val pool = Executors.newFixedThreadPool(2)
        val bad = AtomicInteger()
        val writer = pool.submit { repeat(200) { LottiesStore.writeSnapshot(dir, if (it % 2 == 0) b else a) } }
        val reader = pool.submit {
            repeat(2000) {
                val text = LottiesStore.readSnapshot(dir)
                if (text != a && text != b) bad.incrementAndGet()
            }
        }
        writer.get(30, TimeUnit.SECONDS)
        reader.get(30, TimeUnit.SECONDS)
        pool.shutdown()
        assertEquals(0, bad.get())
    }

    @Test
    fun concurrentAppendsKeepEveryEntry() {
        val dir = dir()
        val threads = 8
        val perThread = 25
        val pool = Executors.newFixedThreadPool(threads)
        val start = CountDownLatch(1)
        val futures = (0 until threads).map { t ->
            pool.submit {
                start.await()
                repeat(perThread) { LottiesStore.appendOutbox(dir, entry("t$t-$it")) }
            }
        }
        start.countDown()
        futures.forEach { it.get(60, TimeUnit.SECONDS) }
        pool.shutdown()
        val stored = ids(LottiesStore.readOutbox(dir))
        assertEquals(threads * perThread, stored.size)
        assertEquals(threads * perThread, stored.toSet().size)
    }

    @Test
    fun appendWithSameIdReplaces() {
        val dir = dir()
        LottiesStore.appendOutbox(dir, entry("a"))
        LottiesStore.appendOutbox(dir, entry("a"))
        assertEquals(listOf("a"), ids(LottiesStore.readOutbox(dir)))
    }

    @Test
    fun removeDropsOnlyTheGivenIds() {
        val dir = dir()
        listOf("a", "b", "c").forEach { LottiesStore.appendOutbox(dir, entry(it)) }
        LottiesStore.removeOutbox(dir, listOf("a", "c", "missing"))
        val left = JSONArray(LottiesStore.readOutbox(dir))
        assertEquals(1, left.length())
        assertEquals("b", left.getJSONObject(0).getString("id"))
        assertEquals("wet", left.getJSONObject(0).getJSONObject("payload").getString("kind"))
    }

    @Test
    fun brokenOutboxCountsAsEmpty() {
        val dir = dir()
        dir.mkdirs()
        File(dir, LottiesStore.OUTBOX_FILE).writeText("not json")
        LottiesStore.appendOutbox(dir, entry("a"))
        assertEquals(listOf("a"), ids(LottiesStore.readOutbox(dir)))
    }

    @Test
    fun clearAllDeletesBothFilesAndNotifies() {
        val dir = dir()
        val calls = AtomicInteger()
        val listener = SnapshotListener { calls.incrementAndGet() }
        LottiesStore.addListener(listener)
        try {
            LottiesStore.writeSnapshot(dir, "{}")
            LottiesStore.appendOutbox(dir, entry("a"))
            LottiesStore.clearAll(dir)
            assertNull(LottiesStore.readSnapshot(dir))
            assertEquals("[]", LottiesStore.readOutbox(dir))
            assertEquals(2, calls.get())
        } finally {
            LottiesStore.removeListener(listener)
        }
    }

    @Test
    fun failingListenerDoesNotFailTheWrite() {
        val dir = dir()
        val listener = SnapshotListener { throw IllegalStateException("boom") }
        LottiesStore.addListener(listener)
        try {
            LottiesStore.writeSnapshot(dir, "{}")
            assertEquals("{}", LottiesStore.readSnapshot(dir))
        } finally {
            LottiesStore.removeListener(listener)
        }
    }
}
