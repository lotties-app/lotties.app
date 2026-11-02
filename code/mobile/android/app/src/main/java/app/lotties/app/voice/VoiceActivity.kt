package app.lotties.app.voice

import android.content.Context
import android.os.Bundle
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import app.lotties.app.R
import java.text.NumberFormat

/**
 * The target of the voice shortcuts (res/xml/shortcuts.xml), with a transparent theme and no layout: reads the feature
 * id (extra `feature`), asks for the one missing value from a fixed list when the feature needs it (bottle ml, activity,
 * minutes, temperature, pain level, question: like Siri asking "How many ml?"), hands the tool call to [VoiceRunner] and
 * finishes. Not exported: the launcher starts shortcuts as the app itself.
 *
 * Google Assistant App Actions start it through the exported alias `.voice.VoiceAssistantEntry` (the capability intent
 * comes from another app). Any app can send that alias an intent, so from there a **write** asks for one tap first
 * ("Log this now?"); questions are answered directly (the answer is shown and spoken here, never returned to the caller).
 */
class VoiceActivity : AppCompatActivity() {

    private lateinit var text: Context

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        text = VoiceRunner.localized(this)
        if (!VoiceTokenStore.isConnected(this)) {
            VoiceRunner.say(applicationContext, text.getString(R.string.voice_not_connected))
            VoiceRunner.openSettings(this)
            finish()
            return
        }
        when (val feature = VoiceCatalog.feature(intent?.getStringExtra(VoiceCatalog.EXTRA_FEATURE))) {
            null -> {
                VoiceRunner.say(applicationContext, text.getString(R.string.voice_unknown))
                finish()
            }
            is VoiceFeature.Direct -> confirmThenRun(feature.call, labelOf(intent.getStringExtra(VoiceCatalog.EXTRA_FEATURE)))
            VoiceFeature.Bottle -> pickBottle()
            VoiceFeature.Activity -> pickActivity()
            VoiceFeature.Health -> pickHealth()
            VoiceFeature.Ask -> pickTopic()
        }
    }

    private val fromOtherApp: Boolean
        get() = intent?.component?.className?.endsWith(".VoiceAssistantEntry") == true

    private fun confirmThenRun(call: ToolCall?, label: String) {
        if (call == null) {
            VoiceRunner.say(applicationContext, text.getString(R.string.voice_nothing_logged))
            finish()
            return
        }
        if (!call.write || !fromOtherApp) {
            hand(call)
            return
        }
        AlertDialog.Builder(this)
            .setTitle(text.getString(R.string.voice_confirm_title))
            .setMessage(label)
            .setPositiveButton(text.getString(R.string.voice_confirm_log)) { _, _ -> hand(call) }
            .setNegativeButton(text.getString(R.string.voice_cancel)) { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun hand(call: ToolCall) {
        VoiceRunner.run(applicationContext, call)
        finish()
    }

    private fun choose(title: Int, labels: List<String>, picked: (Int) -> Unit) {
        AlertDialog.Builder(this)
            .setTitle(text.getString(title))
            .setItems(labels.toTypedArray()) { _, index -> picked(index) }
            .setNegativeButton(text.getString(R.string.voice_cancel)) { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun pickBottle() = choose(R.string.voice_pick_bottle, VoiceCatalog.BOTTLE_ML.map { text.getString(R.string.voice_ml_value, it) }) {
        val ml = VoiceCatalog.BOTTLE_ML[it]
        confirmThenRun(VoiceCatalog.bottle(ml), text.getString(R.string.voice_ml_value, ml))
    }

    private fun pickActivity() = choose(R.string.voice_pick_activity, VoiceCatalog.ACTIVITIES.map { text.getString(activityLabel(it.key)) }) {
        val item = VoiceCatalog.ACTIVITIES[it]
        if (!item.takesMinutes) {
            confirmThenRun(VoiceCatalog.activity(item, null), text.getString(activityLabel(item.key)))
            return@choose
        }
        val labels = VoiceCatalog.MINUTES.map { minutes ->
            if (minutes == 0) text.getString(R.string.voice_minutes_timer) else text.getString(R.string.voice_minutes_value, minutes)
        }
        choose(R.string.voice_pick_minutes, labels) { index ->
            confirmThenRun(VoiceCatalog.activity(item, VoiceCatalog.MINUTES[index]), "${text.getString(activityLabel(item.key))}, ${labels[index]}")
        }
    }

    private fun pickHealth() = choose(R.string.voice_pick_health, VoiceCatalog.HEALTH_KEYS.map { text.getString(healthLabel(it)) }) {
        when (VoiceCatalog.HEALTH_KEYS[it]) {
            "temperature" -> {
                val format = NumberFormat.getNumberInstance(text.resources.configuration.locales[0]).apply {
                    minimumFractionDigits = 1
                    maximumFractionDigits = 1
                }
                val labels = VoiceCatalog.TEMPERATURES_C.map { c -> text.getString(R.string.voice_celsius_value, format.format(c)) }
                choose(R.string.voice_pick_temperature, labels) { index ->
                    confirmThenRun(VoiceCatalog.temperature(VoiceCatalog.TEMPERATURES_C[index]), labels[index])
                }
            }
            "belly_pain" -> choose(R.string.voice_pick_pain, VoiceCatalog.PAIN_LEVELS.map { level -> level.toString() }) { index ->
                val level = VoiceCatalog.PAIN_LEVELS[index]
                confirmThenRun(VoiceCatalog.bellyPain(level), "${text.getString(R.string.voice_health_belly_pain)} $level")
            }
            else -> confirmThenRun(VoiceCatalog.symptom(), text.getString(R.string.voice_health_symptom))
        }
    }

    private fun pickTopic() = choose(R.string.voice_pick_topic, VoiceCatalog.TOPICS.map { text.getString(topicLabel(it.key)) }) {
        confirmThenRun(VoiceCatalog.topic(VoiceCatalog.TOPICS[it].key), "")
    }

    private fun labelOf(feature: String?): String = text.getString(
        when (feature) {
            "diaper_wet" -> R.string.voice_shortcut_diaper_wet_long
            "diaper_dirty" -> R.string.voice_shortcut_diaper_dirty_long
            "diaper_both" -> R.string.voice_shortcut_diaper_both_long
            "breastfeed" -> R.string.voice_shortcut_breastfeed_long
            "fell_asleep" -> R.string.voice_shortcut_fell_asleep_long
            "woke_up" -> R.string.voice_shortcut_woke_up_long
            "undo" -> R.string.voice_shortcut_undo_long
            else -> R.string.voice_shortcut_ask_last_feed_long
        },
    )

    private fun activityLabel(key: String): Int = when (key) {
        "bath" -> R.string.voice_activity_bath
        "tummy_time" -> R.string.voice_activity_tummy_time
        "belly_massage" -> R.string.voice_activity_belly_massage
        "nasal_suction" -> R.string.voice_activity_nasal_suction
        "nail_trim" -> R.string.voice_activity_nail_trim
        "skin_care" -> R.string.voice_activity_skin_care
        "outdoor" -> R.string.voice_activity_outdoor
        "fussy" -> R.string.voice_activity_fussy
        "spit_up" -> R.string.voice_activity_spit_up
        "teething" -> R.string.voice_activity_teething
        else -> R.string.voice_activity_breast_pump
    }

    private fun healthLabel(key: String): Int = when (key) {
        "temperature" -> R.string.voice_health_temperature
        "symptom" -> R.string.voice_health_symptom
        else -> R.string.voice_health_belly_pain
    }

    private fun topicLabel(key: String): Int = when (key) {
        "last_feed" -> R.string.voice_ask_last_feed
        "next_nap_window" -> R.string.voice_ask_next_nap_window
        "next_feed" -> R.string.voice_ask_next_feed
        "next_diaper" -> R.string.voice_ask_next_diaper
        "last_diaper" -> R.string.voice_ask_last_diaper
        "diapers_today" -> R.string.voice_ask_diapers_today
        "bottles_today" -> R.string.voice_ask_bottles_today
        "feeds_today" -> R.string.voice_ask_feeds_today
        "sleep_today" -> R.string.voice_ask_sleep_today
        "day_summary" -> R.string.voice_ask_day_summary
        "week_summary" -> R.string.voice_ask_week_summary
        "next_appointment" -> R.string.voice_ask_next_appointment
        else -> R.string.voice_ask_due_vaccines
    }
}
