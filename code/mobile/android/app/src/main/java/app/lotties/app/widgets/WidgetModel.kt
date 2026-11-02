package app.lotties.app.widgets

import org.json.JSONException
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/*
 * `widget-snapshot.json` as the widgets read it (docs/design/37-widgets-siri.md 2.1, 9, 10, 11), the Android twin of
 * `WidgetSnapshot` in code/mobile/ios/App/Shared/LottiesShared.swift; the writer is code/web/src/widgets/snapshot.ts.
 * Plain Kotlin and org.json only (no Android UI), so it runs in the JVM unit tests. Times are epoch milliseconds.
 */

data class WidgetSnapshot(
    val signedIn: Boolean,
    val selectedBabyId: String?,
    /** Names are left out on a lock screen (keyguard host) unless this is false. */
    val hideNamesOnLockScreen: Boolean,
    /** The app's language, "pt-BR" or "en"; null when the snapshot has none (the phone's language is used). */
    val language: String?,
    val babies: List<Baby>,
) {
    /** The selected baby, else the first one (same rule as iOS). */
    val selectedBaby: Baby? get() = babies.firstOrNull { it.id == selectedBabyId } ?: babies.firstOrNull()

    data class Baby(
        val id: String,
        val name: String,
        val sleep: Sleep? = null,
        val lastFeed: Feed? = null,
        val lastDiaper: Diaper? = null,
        val lastActivity: Map<String, Long> = emptyMap(),
        val runningFeed: RunningFeed? = null,
        val nextNap: NapWindow? = null,
        val nextFeed: NextFeed? = null,
        val nextDiaper: NextDiaper? = null,
    )

    data class Sleep(val asleep: Boolean, val startedAt: Long?)
    data class Feed(val at: Long, val kind: String, val amountMl: Int?, val side: String?)
    data class Diaper(val at: Long, val kind: String)
    data class RunningFeed(val kind: String, val since: Long, val paused: Boolean, val elapsedSeconds: Int)
    data class NapWindow(val earliest: Long, val expected: Long, val latest: Long)
    data class NextFeed(val at: Long, val amountMl: Int?)
    data class NextDiaper(val at: Long, val kind: String)

    companion object {
        /** The snapshot, or null when the text is missing or not one (the widgets then show "Open Lotties"). */
        fun parse(text: String?): WidgetSnapshot? {
            if (text.isNullOrBlank()) return null
            return try {
                val root = JSONObject(text)
                val babies = root.optJSONArray("babies")
                WidgetSnapshot(
                    signedIn = root.optBoolean("signedIn", false),
                    selectedBabyId = root.optStringOrNull("selectedBabyId"),
                    hideNamesOnLockScreen = root.optBoolean("hideNamesOnLockScreen", true),
                    language = root.optStringOrNull("language"),
                    babies = if (babies == null) emptyList()
                    else (0 until babies.length()).mapNotNull { babies.optJSONObject(it)?.let(::parseBaby) },
                )
            } catch (_: JSONException) {
                null
            }
        }

        private fun parseBaby(o: JSONObject): Baby? {
            val id = o.optStringOrNull("id") ?: return null
            return Baby(
                id = id,
                name = o.optStringOrNull("name") ?: "",
                sleep = o.optJSONObject("sleep")?.let { s ->
                    Sleep(s.optString("state") == "asleep", Iso.parse(s.optStringOrNull("startedAt")))
                },
                lastFeed = o.optJSONObject("lastFeed")?.let { f ->
                    val at = Iso.parse(f.optStringOrNull("at")) ?: return@let null
                    Feed(at, f.optStringOrNull("kind") ?: "other", f.optIntOrNull("amountMl"), f.optStringOrNull("side"))
                },
                lastDiaper = o.optJSONObject("lastDiaper")?.let { d ->
                    val at = Iso.parse(d.optStringOrNull("at")) ?: return@let null
                    Diaper(at, d.optStringOrNull("kind") ?: "other")
                },
                lastActivity = o.optJSONObject("lastActivity")?.let { a ->
                    a.keys().asSequence().mapNotNull { key -> Iso.parse(a.optStringOrNull(key))?.let { key to it } }.toMap()
                } ?: emptyMap(),
                runningFeed = o.optJSONObject("runningFeed")?.let { r ->
                    val since = Iso.parse(r.optStringOrNull("since")) ?: return@let null
                    RunningFeed(r.optString("kind"), since, r.optBoolean("paused"), r.optInt("elapsedSeconds"))
                },
                nextNap = o.optJSONObject("nextNap")?.let { n ->
                    val expected = Iso.parse(n.optStringOrNull("expected")) ?: return@let null
                    NapWindow(
                        Iso.parse(n.optStringOrNull("earliest")) ?: expected,
                        expected,
                        Iso.parse(n.optStringOrNull("latest")) ?: expected,
                    )
                },
                nextFeed = o.optJSONObject("nextFeed")?.let { n ->
                    val at = Iso.parse(n.optStringOrNull("at")) ?: return@let null
                    NextFeed(at, n.optIntOrNull("amountMl"))
                },
                nextDiaper = o.optJSONObject("nextDiaper")?.let { n ->
                    val at = Iso.parse(n.optStringOrNull("at")) ?: return@let null
                    NextDiaper(at, n.optStringOrNull("kind") ?: "wet")
                },
            )
        }
    }
}

internal fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotEmpty() } else null

internal fun JSONObject.optIntOrNull(key: String): Int? =
    if (has(key) && !isNull(key)) (opt(key) as? Number)?.toInt() else null

/** ISO 8601 in UTC as the web app writes it (`Date.toISOString()`), without java.time (minSdk 24). */
object Iso {
    private val pattern = Regex(
        """(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?""",
    )

    /** Epoch milliseconds, or null when the text is not an ISO 8601 date-time. A missing zone counts as UTC. */
    fun parse(text: String?): Long? {
        val match = pattern.matchEntire(text?.trim() ?: return null) ?: return null
        val g = match.groupValues
        val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.US)
        calendar.clear()
        calendar.set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt())
        val millis = if (g[7].isEmpty()) 0 else g[7].padEnd(3, '0').take(3).toInt()
        var result = calendar.timeInMillis + millis
        val zone = g[8]
        if (zone.isNotEmpty() && zone != "Z") {
            val digits = zone.substring(1).replace(":", "")
            val offset = (digits.substring(0, 2).toInt() * 60 + digits.substring(2, 4).toInt()) * 60_000L
            result -= if (zone[0] == '+') offset else -offset
        }
        return result
    }

    /** `2026-11-01T10:00:00.000Z` (what `Date.toISOString()` writes; `Date.parse` in the web app reads it). */
    fun format(millis: Long): String {
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        formatter.timeZone = TimeZone.getTimeZone("UTC")
        return formatter.format(millis)
    }
}
