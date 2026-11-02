package app.lotties.app.voice

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.widget.Toast
import app.lotties.app.MainActivity
import app.lotties.app.R
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Runs one voice tool call after [VoiceActivity] finished (so no invisible window stays over the home screen while the
 * network answers), then shows the answer in a Toast and speaks it with TextToSpeech in the speech locale. The sentence is
 * the server's (the Alexa wording, docs/design/32-assistants.md); the local texts only cover failures, like iOS `SiriSay`.
 */
object VoiceRunner {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    /** Strings in the language the server speaks, so the Toast and the fallback texts match the answer. */
    fun localized(context: Context): Context {
        val locale = Locale.forLanguageTag(VoiceMcpClient.speechLocale(context))
        val configuration = Configuration(context.resources.configuration)
        configuration.setLocale(locale)
        return context.createConfigurationContext(configuration)
    }

    fun run(context: Context, call: ToolCall) {
        val app = context.applicationContext
        worker.execute {
            val text = localized(app)
            val message = try {
                val answer = VoiceMcpClient.call(app, call)
                answer.speech?.takeIf { it.isNotBlank() }
                    ?: text.getString(if (answer.isError) R.string.voice_could_not else R.string.voice_done)
            } catch (failure: VoiceFailure) {
                if (failure.reason == VoiceFailure.Reason.NOT_CONNECTED) main.post { openSettings(app) }
                text.getString(messageFor(failure.reason))
            }
            main.post { say(app, message) }
        }
    }

    fun messageFor(reason: VoiceFailure.Reason): Int = when (reason) {
        VoiceFailure.Reason.NOT_CONNECTED -> R.string.voice_not_connected
        VoiceFailure.Reason.OFFLINE -> R.string.voice_offline
        VoiceFailure.Reason.FORBIDDEN -> R.string.voice_forbidden
        VoiceFailure.Reason.UNAUTHORIZED, VoiceFailure.Reason.SERVER -> R.string.voice_no_answer
    }

    /** The app on Settings > Voice assistants (the web app follows the link, platform/voiceSettingsLink.ts). */
    fun openSettings(context: Context) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(McpWire.SETTINGS_URL), context, MainActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    /** Toast now, and the same text spoken; the engine is released when it is done (or after 30 s). */
    fun say(context: Context, message: String) {
        Toast.makeText(context, message, Toast.LENGTH_LONG).show()
        val locale = Locale.forLanguageTag(VoiceMcpClient.speechLocale(context))
        var engine: TextToSpeech? = null
        val release = Runnable {
            engine?.shutdown()
            engine = null
        }
        engine = TextToSpeech(context) { status ->
            val tts = engine ?: return@TextToSpeech
            if (status != TextToSpeech.SUCCESS) {
                main.post(release)
                return@TextToSpeech
            }
            if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) tts.language = locale
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit
                override fun onDone(utteranceId: String?) {
                    main.post(release)
                }

                @Deprecated("Deprecated in Java")
                @Suppress("OVERRIDE_DEPRECATION")
                override fun onError(utteranceId: String?) {
                    main.post(release)
                }
            })
            tts.speak(message, TextToSpeech.QUEUE_FLUSH, null, "lotties-voice")
        }
        main.postDelayed(release, 30_000)
    }
}
