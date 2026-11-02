package app.lotties.app.voice

/*
 * What each Android voice entry point does (docs/design/37-widgets-siri.md section 14): the launcher shortcuts and the
 * Google Assistant App Actions of res/xml/shortcuts.xml carry a feature id (the shortcut id); each one is the MCP tool the
 * matching Siri intent calls (code/mobile/ios/App/App/LottiesSiriIntents.swift). Pure Kotlin, unit tested.
 * Medication has no tool and no entry by design (docs/design/32-assistants.md). No free text is ever sent: every
 * argument is a fixed value or a number picked from a list.
 */

/** One `tools/call`. [write] adds a fresh `idempotencyKey` (VoiceRunner), so a retry of the same request logs once. */
data class ToolCall(val tool: String, val arguments: Map<String, Any> = emptyMap(), val write: Boolean = false)

/** An activity of the generic "Log an activity" entry; the key is the string resource suffix (voice_activity_<key>). */
data class VoiceActivityItem(val key: String, val tool: String, val takesMinutes: Boolean)

/** A question of the "Ask" entry; the key is the string resource suffix (voice_ask_<key>). */
data class VoiceTopic(val key: String, val tool: String)

/** What a feature id starts. */
sealed class VoiceFeature {
    /** Runs at once. */
    data class Direct(val call: ToolCall) : VoiceFeature()

    /** Pick the bottle amount, then log it. */
    object Bottle : VoiceFeature()

    /** Pick an activity (and its minutes when it takes them), then log it. */
    object Activity : VoiceFeature()

    /** Pick temperature, symptom or belly pain (and its value), then log it. */
    object Health : VoiceFeature()

    /** Pick a question, then say the answer. */
    object Ask : VoiceFeature()
}

object VoiceCatalog {
    const val EXTRA_FEATURE = "feature"

    /** Launcher order (the launcher shows the first four or five). Same ids as res/xml/shortcuts.xml. */
    val FEATURE_IDS = listOf(
        "diaper_wet", "diaper_dirty", "bottle", "fell_asleep", "woke_up", "breastfeed", "diaper_both",
        "activity", "health", "ask_last_feed", "ask", "undo",
    )

    /** Same list and tools as `SiriActivity` (iOS), and the same five that take `minutes`. */
    val ACTIVITIES = listOf(
        VoiceActivityItem("bath", "log_bath", false),
        VoiceActivityItem("tummy_time", "log_tummy_time", true),
        VoiceActivityItem("belly_massage", "log_belly_massage", true),
        VoiceActivityItem("nasal_suction", "log_nasal_suction", false),
        VoiceActivityItem("nail_trim", "log_nail_trim", false),
        VoiceActivityItem("skin_care", "log_skin_care", false),
        VoiceActivityItem("outdoor", "log_outdoor", true),
        VoiceActivityItem("fussy", "log_fussy", true),
        VoiceActivityItem("spit_up", "log_spit_up", false),
        VoiceActivityItem("teething", "log_teething", false),
        VoiceActivityItem("breast_pump", "log_breast_pump", true),
    )

    /** Same list and tools as `SiriAskTopic` (iOS). */
    val TOPICS = listOf(
        VoiceTopic("last_feed", "get_last_feed"),
        VoiceTopic("next_nap_window", "get_next_nap_window"),
        VoiceTopic("next_feed", "get_next_feed"),
        VoiceTopic("next_diaper", "get_next_diaper"),
        VoiceTopic("last_diaper", "get_last_diaper"),
        VoiceTopic("diapers_today", "get_diapers_today"),
        VoiceTopic("bottles_today", "get_bottle_today"),
        VoiceTopic("feeds_today", "get_feeds_today"),
        VoiceTopic("sleep_today", "get_sleep_today"),
        VoiceTopic("day_summary", "get_day_summary"),
        VoiceTopic("week_summary", "get_week_summary"),
        VoiceTopic("next_appointment", "get_next_appointment"),
        VoiceTopic("due_vaccines", "get_due_vaccines"),
    )

    val HEALTH_KEYS = listOf("temperature", "symptom", "belly_pain")

    /** The choices offered (no free text): bottle ml, minutes (0 = start a timer), °C, pain level. */
    val BOTTLE_ML = listOf(30, 60, 90, 120, 150, 180, 210, 240)
    val MINUTES = listOf(0, 5, 10, 15, 20, 30, 45, 60)
    val TEMPERATURES_C: List<Double> = (0..20).map { (360 + it * 2) / 10.0 } // 36.0 .. 40.0 by 0.2
    val PAIN_LEVELS = (1..5).toList()

    const val MIN_MINUTES = 1
    const val MAX_MINUTES = 720

    fun feature(id: String?): VoiceFeature? = when (id) {
        "diaper_wet" -> VoiceFeature.Direct(diaper("wet"))
        "diaper_dirty" -> VoiceFeature.Direct(diaper("dirty"))
        "diaper_both" -> VoiceFeature.Direct(diaper("both"))
        "bottle" -> VoiceFeature.Bottle
        "breastfeed" -> VoiceFeature.Direct(ToolCall("log_nursing", write = true))
        "fell_asleep" -> VoiceFeature.Direct(ToolCall("log_sleep_start", write = true))
        "woke_up" -> VoiceFeature.Direct(ToolCall("log_sleep_end", write = true))
        "activity" -> VoiceFeature.Activity
        "health" -> VoiceFeature.Health
        "ask_last_feed" -> VoiceFeature.Direct(ToolCall("get_last_feed"))
        "ask" -> VoiceFeature.Ask
        // Asks to delete; the app asks the parent to confirm (assistants never delete, docs/design/32 section 5.3).
        "undo" -> VoiceFeature.Direct(ToolCall("request_delete_last_entry", write = true))
        else -> null
    }

    fun diaper(kind: String) = ToolCall("log_diaper", mapOf("kind" to kind), write = true)

    /** The bottle content is not asked: the tool says to omit it when unknown. */
    fun bottle(ml: Int): ToolCall? = if (ml > 0) ToolCall("log_bottle", mapOf("amountMl" to ml), write = true) else null

    /** `minutes` only for the five that take it and only in 1..720; 0 or none starts a timer on the server. */
    fun activity(item: VoiceActivityItem, minutes: Int?): ToolCall {
        val arguments = if (item.takesMinutes && minutes != null && minutes in MIN_MINUTES..MAX_MINUTES) {
            mapOf<String, Any>("minutes" to minutes)
        } else {
            emptyMap()
        }
        return ToolCall(item.tool, arguments, write = true)
    }

    fun temperature(celsius: Double) = ToolCall("log_temperature", mapOf("temperatureC" to celsius), write = true)

    fun bellyPain(level: Int): ToolCall? =
        if (level in 1..5) ToolCall("log_belly_pain", mapOf("level" to level), write = true) else null

    /** Logged without a choice, as on iOS (the tool's optional choice is not wired; never free text). */
    fun symptom() = ToolCall("log_symptom", write = true)

    fun topic(key: String): ToolCall? = TOPICS.firstOrNull { it.key == key }?.let { ToolCall(it.tool) }
}
