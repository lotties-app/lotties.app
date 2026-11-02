package app.lotties.app.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class VoiceCatalogTest {

    @Test
    fun everyFeatureIdIsKnown() {
        for (id in VoiceCatalog.FEATURE_IDS) assertNotNull(id, VoiceCatalog.feature(id))
        assertNull(VoiceCatalog.feature("give_medicine"))
        assertNull(VoiceCatalog.feature(null))
    }

    @Test
    fun directFeaturesUseTheSiriTools() {
        assertEquals(ToolCall("log_diaper", mapOf("kind" to "wet"), true), direct("diaper_wet"))
        assertEquals(ToolCall("log_diaper", mapOf("kind" to "dirty"), true), direct("diaper_dirty"))
        assertEquals(ToolCall("log_diaper", mapOf("kind" to "both"), true), direct("diaper_both"))
        assertEquals(ToolCall("log_nursing", write = true), direct("breastfeed"))
        assertEquals(ToolCall("log_sleep_start", write = true), direct("fell_asleep"))
        assertEquals(ToolCall("log_sleep_end", write = true), direct("woke_up"))
        assertEquals(ToolCall("get_last_feed"), direct("ask_last_feed"))
        assertEquals(ToolCall("request_delete_last_entry", write = true), direct("undo"))
        assertEquals(VoiceFeature.Bottle, VoiceCatalog.feature("bottle"))
        assertEquals(VoiceFeature.Activity, VoiceCatalog.feature("activity"))
        assertEquals(VoiceFeature.Health, VoiceCatalog.feature("health"))
        assertEquals(VoiceFeature.Ask, VoiceCatalog.feature("ask"))
    }

    @Test
    fun minutesOnlyForTheFiveDurationActivities() {
        val takes = VoiceCatalog.ACTIVITIES.filter { it.takesMinutes }.map { it.tool }.toSet()
        assertEquals(setOf("log_tummy_time", "log_breast_pump", "log_belly_massage", "log_fussy", "log_outdoor"), takes)

        val tummy = VoiceCatalog.ACTIVITIES.first { it.key == "tummy_time" }
        val bath = VoiceCatalog.ACTIVITIES.first { it.key == "bath" }
        assertEquals(mapOf<String, Any>("minutes" to 15), VoiceCatalog.activity(tummy, 15).arguments)
        assertEquals(emptyMap<String, Any>(), VoiceCatalog.activity(tummy, 0).arguments) // 0 = start a timer
        assertEquals(emptyMap<String, Any>(), VoiceCatalog.activity(tummy, 721).arguments)
        assertEquals(emptyMap<String, Any>(), VoiceCatalog.activity(bath, 15).arguments)
        assertTrue(VoiceCatalog.activity(bath, null).write)
        assertTrue(VoiceCatalog.MINUTES.all { it == 0 || it in VoiceCatalog.MIN_MINUTES..VoiceCatalog.MAX_MINUTES })
    }

    @Test
    fun healthAndBottleValuesComeFromFixedLists() {
        assertEquals(ToolCall("log_bottle", mapOf("amountMl" to 120), true), VoiceCatalog.bottle(120))
        assertNull(VoiceCatalog.bottle(0))
        assertEquals(ToolCall("log_temperature", mapOf("temperatureC" to 38.4), true), VoiceCatalog.temperature(38.4))
        assertEquals(ToolCall("log_belly_pain", mapOf("level" to 3), true), VoiceCatalog.bellyPain(3))
        assertNull(VoiceCatalog.bellyPain(6))
        assertEquals(ToolCall("log_symptom", write = true), VoiceCatalog.symptom())
        assertEquals(36.0, VoiceCatalog.TEMPERATURES_C.first(), 0.0)
        assertEquals(40.0, VoiceCatalog.TEMPERATURES_C.last(), 0.0)
    }

    @Test
    fun askTopicsAreTheSiriTopics() {
        assertEquals(13, VoiceCatalog.TOPICS.size)
        assertEquals(ToolCall("get_bottle_today"), VoiceCatalog.topic("bottles_today"))
        assertNull(VoiceCatalog.topic("medicines"))
        assertTrue(VoiceCatalog.TOPICS.all { it.tool.startsWith("get_") })
    }

    @Test
    fun noMedicationAnywhere() {
        val tools = VoiceCatalog.ACTIVITIES.map { it.tool } + VoiceCatalog.TOPICS.map { it.tool } +
            VoiceCatalog.FEATURE_IDS.mapNotNull { (VoiceCatalog.feature(it) as? VoiceFeature.Direct)?.call?.tool }
        assertTrue(tools.none { it.contains("medic") || it.contains("dose") })
    }

    /** The shortcut ids in res/xml/shortcuts.xml are the catalog's, in the same order. */
    @Test
    fun shortcutsXmlMatchesTheCatalog() {
        val xml = listOf(File("src/main/res/xml/shortcuts.xml"), File("app/src/main/res/xml/shortcuts.xml")).first { it.isFile }.readText()
        val ids = Regex("android:shortcutId=\"([a-z_]+)\"").findAll(xml).map { it.groupValues[1] }.toList()
        assertEquals(VoiceCatalog.FEATURE_IDS, ids)
        for (id in ids) assertTrue(id, xml.contains("android:value=\"$id\""))
    }

    private fun direct(id: String) = (VoiceCatalog.feature(id) as VoiceFeature.Direct).call
}
