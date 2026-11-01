package app.lotties.app.shared

import android.content.Context
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.CopyOnWriteArrayList

/** Called after the snapshot changed or was deleted (the widgets refresh from it). */
fun interface SnapshotListener {
    fun onSnapshotChanged()
}

/**
 * The files the app, the widgets and the voice actions share (docs/design/37-widgets-siri.md section 2), the Android
 * twin of code/mobile/ios/App/Shared/LottiesShared.swift: `widget-snapshot.json` (written by the web app, read by the
 * widgets) and `widget-outbox.json` (appended by widget buttons and voice, drained by the web app), both in
 * `filesDir/lotties-shared`. Nothing here touches the network and nothing here is a secret.
 *
 * Safe from any thread and from a cold start (a widget receiver may run before the app ever opened): every call takes
 * the directory, or a [Context] to find it. Writes are atomic (temp file + rename: a reader sees the old or the new file,
 * never half of one); read-modify-write of the outbox runs under a process-wide lock plus a file lock (`.lock`).
 */
object LottiesStore {
    const val DIRECTORY = "lotties-shared"
    const val SNAPSHOT_FILE = "widget-snapshot.json"
    const val OUTBOX_FILE = "widget-outbox.json"
    private const val LOCK_FILE = ".lock"

    private val lock = Any()
    private val listeners = CopyOnWriteArrayList<SnapshotListener>()

    /** `filesDir/lotties-shared`, created when missing. */
    @JvmStatic
    fun directory(context: Context): File = File(context.applicationContext.filesDir, DIRECTORY).also { it.mkdirs() }

    // Listeners (process-wide; the widget code registers one from Application or a receiver).

    @JvmStatic
    fun addListener(listener: SnapshotListener) {
        listeners.addIfAbsent(listener)
    }

    @JvmStatic
    fun removeListener(listener: SnapshotListener) {
        listeners.remove(listener)
    }

    private fun notifyListeners() {
        for (listener in listeners) {
            try {
                listener.onSnapshotChanged()
            } catch (_: RuntimeException) {
                // A failing widget refresh must not fail the write.
            }
        }
    }

    // Snapshot

    /** Replaces the snapshot with [json] (the web app's text, stored as is), then calls the listeners. */
    @JvmStatic
    @Throws(IOException::class)
    fun writeSnapshot(context: Context, json: String) = writeSnapshot(directory(context), json)

    @JvmStatic
    @Throws(IOException::class)
    fun writeSnapshot(dir: File, json: String) {
        locked(dir) { writeAtomic(File(dir, SNAPSHOT_FILE), json) }
        notifyListeners()
    }

    /** The snapshot text, or null when there is none. */
    @JvmStatic
    fun readSnapshot(context: Context): String? = readSnapshot(directory(context))

    @JvmStatic
    fun readSnapshot(dir: File): String? = readText(File(dir, SNAPSHOT_FILE))

    // Outbox

    /** The outbox text (a JSON array), "[]" when there is none. */
    @JvmStatic
    fun readOutbox(context: Context): String = readOutbox(directory(context))

    @JvmStatic
    fun readOutbox(dir: File): String = readText(File(dir, OUTBOX_FILE)) ?: "[]"

    /**
     * Appends one entry (a JSON object with at least `id`, docs/design/37 section 2.2). An entry whose `id` is already
     * there replaces it (the id is the event GUID: a retry must not log twice).
     */
    @JvmStatic
    @Throws(IOException::class, JSONException::class)
    fun appendOutbox(context: Context, entryJson: String) = appendOutbox(directory(context), entryJson)

    @JvmStatic
    @Throws(IOException::class, JSONException::class)
    fun appendOutbox(dir: File, entryJson: String) {
        val entry = JSONObject(entryJson)
        val id = entry.optString("id")
        updateOutbox(dir) { entries ->
            val kept = entries.filter { it.optString("id") != id || id.isEmpty() }
            kept + entry
        }
    }

    /** Removes the entries with these ids (the web app drained them). */
    @JvmStatic
    @Throws(IOException::class)
    fun removeOutbox(context: Context, ids: Collection<String>) = removeOutbox(directory(context), ids)

    @JvmStatic
    @Throws(IOException::class)
    fun removeOutbox(dir: File, ids: Collection<String>) {
        if (ids.isEmpty()) return
        val remove = ids.toHashSet()
        updateOutbox(dir) { entries -> entries.filter { it.optString("id") !in remove } }
    }

    /** Sign-out and account erasure: nothing of the account stays. Calls the listeners. */
    @JvmStatic
    fun clearAll(context: Context) = clearAll(directory(context))

    @JvmStatic
    fun clearAll(dir: File) {
        locked(dir) {
            File(dir, SNAPSHOT_FILE).delete()
            File(dir, OUTBOX_FILE).delete()
        }
        notifyListeners()
    }

    /** Size of a file in bytes, -1 when it does not exist (the plugin's `diagnose`). */
    @JvmStatic
    fun fileBytes(dir: File, name: String): Long = File(dir, name).let { if (it.isFile) it.length() else -1L }

    // Internals

    /** Read-modify-write under one lock, so two writers never lose each other's entry. A broken file counts as empty. */
    private fun updateOutbox(dir: File, change: (List<JSONObject>) -> List<JSONObject>) {
        locked(dir) {
            val file = File(dir, OUTBOX_FILE)
            val entries = parseEntries(readText(file))
            val array = JSONArray()
            for (entry in change(entries)) array.put(entry)
            writeAtomic(file, array.toString())
        }
    }

    private fun parseEntries(text: String?): List<JSONObject> {
        if (text.isNullOrBlank()) return emptyList()
        return try {
            val array = JSONArray(text)
            (0 until array.length()).mapNotNull { array.optJSONObject(it) }
        } catch (_: JSONException) {
            emptyList()
        }
    }

    private fun <T> locked(dir: File, body: () -> T): T = synchronized(lock) {
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) throw IOException("Cannot create $dir")
        RandomAccessFile(File(dir, LOCK_FILE), "rw").use { file ->
            val fileLock = file.channel.lock()
            try {
                body()
            } finally {
                fileLock.release()
            }
        }
    }

    private fun readText(file: File): String? = try {
        if (file.isFile) file.readText(Charsets.UTF_8) else null
    } catch (_: IOException) {
        null
    }

    private fun writeAtomic(target: File, text: String) {
        val temp = File.createTempFile(target.name, ".tmp", target.parentFile)
        try {
            FileOutputStream(temp).use { out ->
                out.write(text.toByteArray(Charsets.UTF_8))
                out.fd.sync()
            }
            if (!temp.renameTo(target)) throw IOException("Cannot replace $target")
        } finally {
            if (temp.exists()) temp.delete()
        }
    }
}
