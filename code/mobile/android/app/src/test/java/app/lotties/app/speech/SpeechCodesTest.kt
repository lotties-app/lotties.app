package app.lotties.app.speech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechCodesTest {

    @Test
    fun languageTagsMatchWhateverTheSeparatorAndCase() {
        assertTrue(SpeechCodes.sameLanguage("pt-BR", "pt_BR"))
        assertTrue(SpeechCodes.sameLanguage(" PT-br ", "pt-BR"))
        assertFalse(SpeechCodes.sameLanguage("pt-PT", "pt-BR"))
        assertFalse(SpeechCodes.sameLanguage("pt", "pt-BR"))
    }

    @Test
    fun languageSupportReadsTheThreeLists() {
        assertEquals(
            LanguageSupport(installed = true, pending = false, downloadable = false),
            SpeechCodes.languageSupport("pt-BR", listOf("en-US", "pt_BR"), emptyList(), emptyList()),
        )
        assertEquals(
            LanguageSupport(installed = false, pending = true, downloadable = true),
            SpeechCodes.languageSupport("pt-BR", listOf("en-US"), listOf("pt-BR"), listOf("pt-BR", "es-ES")),
        )
        assertEquals(
            LanguageSupport(installed = false, pending = false, downloadable = false),
            SpeechCodes.languageSupport("pt-BR", emptyList(), emptyList(), emptyList()),
        )
    }

    @Test
    fun recognizerErrorsBecomeTheWebAppCodes() {
        // The documented values of android.speech.SpeechRecognizer.ERROR_*.
        assertEquals("network", SpeechCodes.errorCode(1))
        assertEquals("network", SpeechCodes.errorCode(2))
        assertEquals("audio", SpeechCodes.errorCode(3))
        assertEquals("recognizer_error", SpeechCodes.errorCode(4))
        assertEquals("recognizer_error", SpeechCodes.errorCode(5))
        assertEquals("speech_timeout", SpeechCodes.errorCode(6))
        assertEquals("no_match", SpeechCodes.errorCode(7))
        assertEquals("busy", SpeechCodes.errorCode(8))
        assertEquals("denied", SpeechCodes.errorCode(9))
        assertEquals("busy", SpeechCodes.errorCode(10))
        assertEquals("recognizer_error", SpeechCodes.errorCode(11))
        assertEquals("language_unavailable", SpeechCodes.errorCode(12))
        assertEquals("language_unavailable", SpeechCodes.errorCode(13))
        assertEquals("recognizer_error", SpeechCodes.errorCode(99))
    }

    @Test
    fun listenLimitsAreClamped() {
        assertEquals(5, SpeechCodes.maxResults(null))
        assertEquals(1, SpeechCodes.maxResults(0))
        assertEquals(10, SpeechCodes.maxResults(50))
        assertEquals(15_000L, SpeechCodes.timeoutMs(null))
        assertEquals(3_000L, SpeechCodes.timeoutMs(10))
        assertEquals(60_000L, SpeechCodes.timeoutMs(600_000))
    }
}
