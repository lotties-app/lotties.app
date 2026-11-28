package app.lotties.app.speech

import java.util.Locale

/** Whether this phone can recognise one language on the device (Android 13+ `RecognitionSupport`). */
data class LanguageSupport(val installed: Boolean, val pending: Boolean, val downloadable: Boolean)

/**
 * Pure helpers of `LottiesSpeechPlugin` (plain JVM, unit-tested): language tags and the error codes the
 * web app reads (code/web/src/platform/speechTypes.ts `SpeechErrorCode`). The SpeechRecognizer error
 * values are written out (API 31+ ones included) so this file needs no android.jar at test time; they are
 * the documented constant values of android.speech.SpeechRecognizer.
 */
object SpeechCodes {
    private const val ERROR_NETWORK_TIMEOUT = 1
    private const val ERROR_NETWORK = 2
    private const val ERROR_AUDIO = 3
    private const val ERROR_SERVER = 4
    private const val ERROR_CLIENT = 5
    private const val ERROR_SPEECH_TIMEOUT = 6
    private const val ERROR_NO_MATCH = 7
    private const val ERROR_RECOGNIZER_BUSY = 8
    private const val ERROR_INSUFFICIENT_PERMISSIONS = 9
    private const val ERROR_TOO_MANY_REQUESTS = 10
    private const val ERROR_SERVER_DISCONNECTED = 11
    private const val ERROR_LANGUAGE_NOT_SUPPORTED = 12
    private const val ERROR_LANGUAGE_UNAVAILABLE = 13

    /** `pt-BR`, `pt_BR`, `PT-br` are the same language tag. */
    fun sameLanguage(a: String, b: String): Boolean = normalize(a) == normalize(b)

    private fun normalize(tag: String) = tag.trim().replace('_', '-').lowercase(Locale.ROOT)

    private fun List<String>.has(locale: String) = any { sameLanguage(it, locale) }

    /** What `RecognitionSupport` says about `locale`: installed, scheduled for download, or downloadable. */
    fun languageSupport(
        locale: String,
        installed: List<String>,
        pending: List<String>,
        supported: List<String>,
    ): LanguageSupport =
        LanguageSupport(installed = installed.has(locale), pending = pending.has(locale), downloadable = supported.has(locale))

    /** A SpeechRecognizer error as the web app's code. */
    fun errorCode(error: Int): String =
        when (error) {
            ERROR_NETWORK_TIMEOUT, ERROR_NETWORK -> "network"
            ERROR_AUDIO -> "audio"
            ERROR_SPEECH_TIMEOUT -> "speech_timeout"
            ERROR_NO_MATCH -> "no_match"
            ERROR_RECOGNIZER_BUSY, ERROR_TOO_MANY_REQUESTS -> "busy"
            ERROR_INSUFFICIENT_PERMISSIONS -> "denied"
            ERROR_LANGUAGE_NOT_SUPPORTED, ERROR_LANGUAGE_UNAVAILABLE -> "language_unavailable"
            ERROR_SERVER, ERROR_CLIENT, ERROR_SERVER_DISCONNECTED -> "recognizer_error"
            else -> "recognizer_error"
        }

    /** The listen limits the plugin accepts (the web app asks for 5 results and 15 s). */
    fun maxResults(requested: Int?): Int = (requested ?: 5).coerceIn(1, 10)

    fun timeoutMs(requested: Int?): Long = (requested ?: 15_000).coerceIn(3_000, 60_000).toLong()
}
