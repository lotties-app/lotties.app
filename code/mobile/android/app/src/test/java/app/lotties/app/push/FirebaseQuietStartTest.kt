package app.lotties.app.push

import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * With google-services.json in the build Firebase starts with the app, so the manifest must keep it quiet until the API
 * says silent pushes are on (docs/design/37b-widget-silent-push.md section 5.4): no FCM token at start-up, no Analytics,
 * no advertising id, no automatic data collection, no delivery metrics. Reads the source manifest (plain JVM test; the
 * unit-test task runs in the module directory).
 */
class FirebaseQuietStartTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"

    private fun applicationMetaData(): Map<String, String> {
        val manifest = requireNotNull(
            listOf("src/main/AndroidManifest.xml", "app/src/main/AndroidManifest.xml").map(::File).firstOrNull(File::isFile),
        ) { "AndroidManifest.xml not found from ${File(".").absolutePath}" }
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        val document = factory.newDocumentBuilder().parse(manifest)
        val application = document.documentElement.getElementsByTagName("application").item(0) as Element
        val values = mutableMapOf<String, String>()
        val children = application.childNodes
        for (index in 0 until children.length) {
            val node = children.item(index)
            if (node is Element && node.tagName == "meta-data") {
                values[node.getAttributeNS(androidNs, "name")] = node.getAttributeNS(androidNs, "value")
            }
        }
        return values
    }

    @Test
    fun firebaseMakesNoCallAtStartUp() {
        val metaData = applicationMetaData()

        listOf(
            "firebase_messaging_auto_init_enabled",
            "firebase_data_collection_default_enabled",
            "firebase_analytics_collection_enabled",
            "google_analytics_adid_collection_enabled",
            "delivery_metrics_exported_to_big_query_enabled",
        ).forEach { key -> assertEquals(key, "false", metaData[key]) }
    }
}
