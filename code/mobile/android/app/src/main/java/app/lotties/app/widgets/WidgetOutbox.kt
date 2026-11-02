package app.lotties.app.widgets

import org.json.JSONException
import org.json.JSONObject
import java.util.UUID

/*
 * What a widget button writes (docs/design/37-widgets-siri.md 2.2, 10, 11): one `widget-outbox.json` entry in the shape
 * code/web/src/widgets/outbox.ts `parseOutbox` accepts, and the same change applied to the snapshot at once so the widget
 * shows it before the app opens (`LottiesLogger.log` in code/mobile/ios/App/Shared/LottiesIntents.swift). Plain Kotlin and
 * org.json, no Android UI: covered by WidgetOutboxTest.
 */

/** The outbox `type`s (code/web/src/widgets/outbox.ts `OutboxType`). */
object OutboxType {
    const val FEED = "feed"
    const val DIAPER = "diaper"
    const val SLEEP_START = "sleep_start"
    const val SLEEP_END = "sleep_end"
    const val ACTIVITY = "activity"
    const val FEED_PAUSE = "feed_pause"
    const val FEED_RESUME = "feed_resume"
    const val FEED_STOP = "feed_stop"

    val all = listOf(FEED, DIAPER, SLEEP_START, SLEEP_END, ACTIVITY, FEED_PAUSE, FEED_RESUME, FEED_STOP)
}

/** One request of a widget button, before it gets an id, a baby and a time. */
data class WidgetRequest(
    val type: String,
    val kind: String? = null,
    val amountMl: Int? = null,
    val side: String? = null,
) {
    companion object {
        fun diaper(kind: String) = WidgetRequest(OutboxType.DIAPER, kind = if (kind in Choices.diaperKinds) kind else "wet")
        fun bottle(amountMl: Int) = WidgetRequest(OutboxType.FEED, kind = "bottle", amountMl = amountMl)
        fun breast(side: String?) =
            WidgetRequest(OutboxType.FEED, kind = "breast", side = side?.takeIf { it in Choices.breastSides })
        fun sleepStart() = WidgetRequest(OutboxType.SLEEP_START)
        fun sleepEnd() = WidgetRequest(OutboxType.SLEEP_END)
        fun activity(eventKey: String) = WidgetRequest(OutboxType.ACTIVITY, kind = eventKey)
        fun feedPause() = WidgetRequest(OutboxType.FEED_PAUSE)
        fun feedResume() = WidgetRequest(OutboxType.FEED_RESUME)
        fun feedStop() = WidgetRequest(OutboxType.FEED_STOP)
    }
}

object WidgetOutbox {
    const val SOURCE = "widget"

    /**
     * The outbox entry: `{id, babyId, type, occurredAt, payload: {kind?, amountMl?, side?}, source: "widget"}`. Absent
     * payload fields are left out (as the iOS encoder does). [id] is the event GUID the app will use (idempotent drain).
     */
    fun entry(
        request: WidgetRequest,
        babyId: String,
        now: Long,
        id: String = UUID.randomUUID().toString(),
    ): JSONObject {
        val payload = JSONObject()
        request.kind?.let { payload.put("kind", it) }
        request.amountMl?.let { payload.put("amountMl", it) }
        request.side?.let { payload.put("side", it) }
        return JSONObject()
            .put("id", id)
            .put("babyId", babyId)
            .put("type", request.type)
            .put("occurredAt", Iso.format(now))
            .put("payload", payload)
            .put("source", SOURCE)
    }

    /** The baby a button logs for: the selected one, else the first; null when signed out or there is none. */
    fun targetBaby(snapshotText: String?): String? {
        val snapshot = WidgetSnapshot.parse(snapshotText) ?: return null
        if (!snapshot.signedIn) return null
        return snapshot.selectedBaby?.id
    }

    /**
     * The snapshot text with [request] applied for [babyId] at [now] (the estimate it answers is cleared, a breastfeed
     * starts running, a pause freezes the elapsed time...). Unknown fields are kept. Returns null when nothing changed
     * (no snapshot, unknown baby).
     */
    fun applyToSnapshot(snapshotText: String?, request: WidgetRequest, babyId: String, now: Long): String? {
        if (snapshotText.isNullOrBlank()) return null
        val root = try {
            JSONObject(snapshotText)
        } catch (_: JSONException) {
            return null
        }
        val babies = root.optJSONArray("babies") ?: return null
        val baby = (0 until babies.length()).mapNotNull { babies.optJSONObject(it) }
            .firstOrNull { it.optString("id") == babyId } ?: return null
        val at = Iso.format(now)
        when (request.type) {
            OutboxType.FEED -> {
                val kind = request.kind ?: "breast"
                val feed = JSONObject().put("at", at).put("kind", kind)
                request.amountMl?.let { feed.put("amountMl", it) }
                request.side?.let { feed.put("side", it) }
                baby.put("lastFeed", feed)
                baby.remove("nextFeed")
                if (kind == "breast") {
                    baby.put(
                        "runningFeed",
                        JSONObject().put("kind", "breast").put("since", at).put("paused", false).put("elapsedSeconds", 0),
                    )
                }
            }
            OutboxType.FEED_PAUSE -> baby.optJSONObject("runningFeed")?.let { run ->
                val since = Iso.parse(run.optStringOrNull("since")) ?: now
                run.put("paused", true)
                run.put("elapsedSeconds", maxOf(0L, (now - since) / 1000L).toInt())
            }
            OutboxType.FEED_RESUME -> baby.optJSONObject("runningFeed")?.let { run ->
                run.put("paused", false)
                run.put("since", Iso.format(now - run.optInt("elapsedSeconds") * 1000L))
            }
            OutboxType.FEED_STOP -> baby.remove("runningFeed")
            OutboxType.DIAPER -> {
                baby.put("lastDiaper", JSONObject().put("at", at).put("kind", request.kind ?: "wet"))
                baby.remove("nextDiaper")
            }
            OutboxType.SLEEP_START -> {
                baby.put("sleep", JSONObject().put("state", "asleep").put("startedAt", at))
                baby.remove("nextNap")
            }
            OutboxType.SLEEP_END -> baby.put("sleep", JSONObject().put("state", "awake").put("startedAt", at))
            OutboxType.ACTIVITY -> request.kind?.let { key ->
                val last = baby.optJSONObject("lastActivity") ?: JSONObject().also { baby.put("lastActivity", it) }
                last.put(key, at)
            }
        }
        root.put("updatedAt", at)
        return root.toString()
    }
}
