package app.lotties.app.widgets

import java.util.Calendar
import java.util.TimeZone

/*
 * The widgets' rules without any Android UI (docs/design/37-widgets-siri.md 9-12), ported from
 * code/mobile/ios/App/Shared/LottiesShared.swift and LottiesIntents.swift so the two platforms behave the same.
 * Covered by app/src/test/java/app/lotties/app/widgets/WidgetLogicTest.kt.
 */

/** What is coming up at a moment: from 20 minutes before an estimate until 30 minutes after it. Estimates only. */
data class Due(val nap: Boolean = false, val feed: Boolean = false, val diaperKind: String? = null) {
    val any: Boolean get() = nap || feed || diaperKind != null
}

object DueRules {
    const val LEAD_MS = 20 * 60_000L
    const val GRACE_MS = 30 * 60_000L
    private const val HORIZON_MS = 24 * 3_600_000L

    private fun inside(time: Long, now: Long) = now >= time - LEAD_MS && now <= time + GRACE_MS

    fun due(baby: WidgetSnapshot.Baby, now: Long): Due {
        val nap = baby.sleep?.asleep != true && baby.nextNap?.let { inside(it.expected, now) } == true
        val feed = baby.nextFeed?.let { inside(it.at, now) } == true
        val diaper = baby.nextDiaper?.takeIf { inside(it.at, now) }?.kind
        return Due(nap, feed, diaper)
    }

    /** The moments after [now] (within a day) at which [due] changes, soonest first. */
    fun dueChanges(baby: WidgetSnapshot.Baby, now: Long): List<Long> =
        listOfNotNull(baby.nextNap?.expected, baby.nextFeed?.at, baby.nextDiaper?.at)
            .flatMap { listOf(it - LEAD_MS, it + GRACE_MS) }
            .filter { it > now && it < now + HORIZON_MS }
            .sorted()
}

/** How long ago, as parts; the widget formats them with its string resources (same words in both languages). */
sealed class Ago {
    data object JustNow : Ago()
    data class Minutes(val minutes: Int) : Ago()
    data class Hours(val hours: Int, val minutes: Int) : Ago()
    /** Rounded down to the half hour, with a plus: "2 h+" (half = false), "2 h 30+" (half = true). */
    data class HoursPlus(val hours: Int, val half: Boolean) : Ago()
    data class Days(val days: Int, val hours: Int) : Ago()

    /** The number part ("35 min", "2 h 10 min", "2 h+", "2 h 30+", "1 d 3 h"), the same in both languages; null for now. */
    fun units(): String? = when (this) {
        JustNow -> null
        is Minutes -> "$minutes min"
        is Hours -> if (minutes == 0) "$hours h" else "$hours h $minutes min"
        is HoursPlus -> if (half) "$hours h 30+" else "$hours h+"
        is Days -> "$days d $hours h"
    }

    companion object {
        /** "2 h 10 min", "35 min", "agora"/"just now" (LottiesText.ago). */
        fun of(at: Long, now: Long): Ago {
            val minutes = maxOf(0L, (now - at) / 60_000L).toInt()
            if (minutes < 1) return JustNow
            if (minutes < 60) return Minutes(minutes)
            val hours = minutes / 60
            if (hours >= 24) return Days(hours / 24, hours % 24)
            return Hours(hours, minutes % 60)
        }

        /** The rows' text: minutes under an hour, then down to the half hour with a plus; a day or more as [of]. */
        fun rounded(at: Long, now: Long): Ago {
            val minutes = maxOf(0L, (now - at) / 60_000L).toInt()
            if (minutes < 60 || minutes >= 24 * 60) return of(at, now)
            return HoursPlus(minutes / 60, minutes % 60 >= 30)
        }
    }
}

/** Same calendar day as [now] in [zone] (the rows say "Nothing today" for an older one, as on iOS). */
fun isSameDay(at: Long, now: Long, zone: TimeZone = TimeZone.getDefault()): Boolean {
    val a = Calendar.getInstance(zone).apply { timeInMillis = at }
    val b = Calendar.getInstance(zone).apply { timeInMillis = now }
    return a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
}

enum class Category { SLEEP, FEEDING, DIAPER, CARE }

/** What a widget button can log (`WidgetActivity` in LottiesIntents.swift); [eventKey] is the outbox `payload.kind`. */
enum class WidgetActivity(val key: String, val eventKey: String?, val icon: String, val category: Category) {
    BOTTLE("bottle", null, "bottle", Category.FEEDING),
    BREAST("breast", null, "heart", Category.FEEDING),
    DIAPER("diaper", null, "diaper", Category.DIAPER),
    BATH("bath", "bath", "bath", Category.CARE),
    BELLY_MASSAGE("bellyMassage", "belly_massage", "massage", Category.CARE),
    TUMMY_TIME("tummyTime", "tummy_time", "baby_carriage", Category.CARE),
    NASAL_SUCTION("nasalSuction", "nasal_suction", "wind", Category.CARE),
    NAIL_TRIM("nailTrim", "nail_trim", "scissors", Category.CARE),
    SKIN_CARE("skinCare", "skin_care", "droplet_half_2", Category.CARE),
    OUTDOOR("outdoor", "outdoor", "trees", Category.CARE),
    FUSSY("fussy", "fussy", "mood_cry", Category.CARE);

    /** The choices a tap opens; null for the ones that log at once. */
    val pickerTarget: PickerTarget?
        get() = when (this) {
            BOTTLE -> PickerTarget.BOTTLE
            BREAST -> PickerTarget.BREAST
            DIAPER -> PickerTarget.DIAPER
            else -> null
        }

    val isFeed: Boolean get() = this == BOTTLE || this == BREAST

    /** Whether this tile is highlighted as coming up. */
    fun isDue(due: Due): Boolean = when (this) {
        BOTTLE, BREAST -> due.feed
        DIAPER -> due.diaperKind != null
        else -> false
    }

    /** When the last one was (the rows' "há 35 min"). */
    fun lastAt(baby: WidgetSnapshot.Baby): Long? = when (this) {
        BOTTLE -> baby.lastFeed?.takeIf { it.kind == "bottle" }?.at
        BREAST -> baby.lastFeed?.takeIf { it.kind != "bottle" }?.at
        DIAPER -> baby.lastDiaper?.at
        else -> eventKey?.let { baby.lastActivity[it] }
    }

    /** The estimate shown under the row's name ("próx. 11:30"). */
    fun nextAt(baby: WidgetSnapshot.Baby): Long? = when (this) {
        BOTTLE -> baby.nextFeed?.at
        DIAPER -> baby.nextDiaper?.at
        else -> null
    }

    companion object {
        /** The Summary and Quick-actions buttons (iOS default slots; no configuration screen on Android yet). */
        val defaultSlots = listOf(BOTTLE, DIAPER, BREAST)

        /** The eight non-everyday activities of the Activities widget and of "More", in order. */
        val panel = listOf(BATH, BELLY_MASSAGE, TUMMY_TIME, NASAL_SUCTION, NAIL_TRIM, SKIN_CARE, OUTDOOR, FUSSY)

        /** The activity keys the web app accepts (code/web/src/widgets/activities.ts `WIDGET_ACTIVITY_KEYS`). */
        val webActivityKeys: List<String> = panel.mapNotNull { it.eventKey }

        fun fromKey(key: String?): WidgetActivity? = entries.firstOrNull { it.key == key }
    }
}

/** Which choices the widget shows in place of its buttons. */
enum class PickerTarget(val key: String) {
    DIAPER("diaper"), BOTTLE("bottle"), BREAST("breast"), MORE("more");

    companion object {
        fun fromKey(key: String?): PickerTarget? = entries.firstOrNull { it.key == key }
    }
}

/** The open choice and when it closes by itself (`LottiesPicker` on iOS: 25 seconds). */
data class OpenPicker(val target: PickerTarget, val until: Long) {
    companion object {
        const val LIFETIME_MS = 25_000L

        fun opening(target: PickerTarget, now: Long) = OpenPicker(target, now + LIFETIME_MS)

        /** The stored choice if it is still open at [now]; null when there is none, it expired or is unknown. */
        fun current(storedTarget: String?, storedUntil: Long, now: Long): OpenPicker? {
            val target = PickerTarget.fromKey(storedTarget) ?: return null
            return if (storedUntil > now) OpenPicker(target, storedUntil) else null
        }
    }
}

object Choices {
    /** Bottle choices: the last bottle's ml first (when there is one), then 60, 90, 120, 150; four at most. */
    fun bottleAmounts(baby: WidgetSnapshot.Baby): List<Int> {
        val list = mutableListOf<Int>()
        baby.lastFeed?.takeIf { it.kind == "bottle" }?.amountMl?.takeIf { it > 0 }?.let { list.add(it) }
        for (ml in listOf(60, 90, 120, 150)) if (ml !in list) list.add(ml)
        return list.take(4)
    }

    val diaperKinds = listOf("wet", "dirty", "mixed")
    val breastSides = listOf("left", "right")
}

/** The tiles of the quick-actions widget: the three buttons (pause/resume and stop while a feed runs) and More. */
sealed class QuickItem {
    data class Activity(val activity: WidgetActivity) : QuickItem()
    data class Pause(val paused: Boolean) : QuickItem()
    data object Stop : QuickItem()
    data object More : QuickItem()

    companion object {
        fun items(slots: List<WidgetActivity>, run: WidgetSnapshot.RunningFeed?): List<QuickItem> {
            val items = mutableListOf<QuickItem>()
            if (run != null) {
                if (run.kind == "bottle") items.add(Pause(run.paused))
                items.add(Stop)
                items.addAll(slots.filter { !it.isFeed }.map { Activity(it) })
            } else {
                items.addAll(slots.map { Activity(it) })
            }
            return items.take(3) + More
        }
    }
}

object RefreshPlan {
    /** iOS rebuilds the timeline every 15 minutes; the rows' "ago" is at most that old. */
    const val PERIOD_MS = 15 * 60_000L

    /** When the widgets should render again: the picker's end, the next highlight change, or 15 minutes from now. */
    fun next(now: Long, baby: WidgetSnapshot.Baby?, picker: OpenPicker?): Long {
        val candidates = mutableListOf(now + PERIOD_MS)
        picker?.until?.takeIf { it > now }?.let { candidates.add(it) }
        baby?.let { DueRules.dueChanges(it, now).firstOrNull() }?.let { candidates.add(it) }
        return candidates.min()
    }
}
