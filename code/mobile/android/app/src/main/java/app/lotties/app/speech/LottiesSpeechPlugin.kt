package app.lotties.app.speech

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.ModelDownloadListener
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.annotation.RequiresApi
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject

/**
 * Capacitor plugin `LottiesSpeech` v0 (code/web/src/platform/speech.ts; docs/design/49a-voice-lab.md, the experimental
 * voice test, opt-in in Settings). One recognition at a time, on the device only: the recogniser is always
 * `createOnDeviceSpeechRecognizer` (Android 12+) with `EXTRA_PREFER_OFFLINE`; on Android 13+ the language must first be
 * reported installed on the phone. When it is not available the call is rejected (`on_device_unavailable`,
 * `language_unavailable`). The default recogniser ("likely to stream audio to remote servers", Android docs) is never
 * created, and `onDevice: false` is refused (`not_supported`). Hints go in `EXTRA_BIASING_STRINGS` (Android 13+). The
 * recogniser is destroyed (the microphone released) on every way out: result, error, Cancel, timeout, the app leaving
 * the screen. Nothing heard is logged or kept here; this plugin sends no audio or text anywhere. `downloadModel` only
 * asks the system speech service to fetch its own language model (no audio, no text).
 * UNVERIFIED: written without Android Studio, compiled by CI only, never run on a phone.
 */
@CapacitorPlugin(
    name = "LottiesSpeech",
    permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")],
)
class LottiesSpeechPlugin : Plugin() {

    private class Session(
        val call: PluginCall,
        val recognizer: SpeechRecognizer,
        val startedAt: Long,
    ) {
        var endOfSpeechAt: Long? = null
        var watchdog: Runnable? = null
    }

    private class Request(
        val locale: String,
        val maxResults: Int,
        val timeoutMs: Long,
        val hints: List<String>,
    )

    private val main = Handler(Looper.getMainLooper())

    // Main thread only (SpeechRecognizer's rule): the running recognition, or a start still checking the language.
    private var session: Session? = null
    private var starting: PluginCall? = null

    // Bumped by every cancel: a language check that answers after a cancel starts nothing.
    private var generation = 0

    @PluginMethod
    fun capabilities(call: PluginCall) {
        val locale = call.getString("locale")
        if (locale.isNullOrBlank()) {
            call.reject("locale is required", "not_supported")
            return
        }
        main.post {
            val answer = baseCapabilities()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && onDeviceAvailable()) {
                checkLanguage(locale) { support ->
                    if (support != null) {
                        answer.put("languageInstalled", support.installed)
                        answer.put("languagePending", support.pending)
                        answer.put("languageDownloadable", support.downloadable)
                    }
                    call.resolve(answer)
                }
            } else {
                call.resolve(answer)
            }
        }
    }

    @PluginMethod
    fun listenOnce(call: PluginCall) {
        if (call.getString("locale").isNullOrBlank()) {
            call.reject("locale is required", "not_supported")
            return
        }
        if (call.getBoolean("onDevice", true) == false) {
            // Server recognition does not exist in this plugin (docs/design/49a-voice-lab.md).
            call.reject("Only on-device recognition is available", "not_supported")
            return
        }
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            requestPermissionForAlias(MICROPHONE, call, "onMicrophonePermission")
            return
        }
        main.post { start(call) }
    }

    @PermissionCallback
    private fun onMicrophonePermission(call: PluginCall) {
        if (getPermissionState(MICROPHONE) == PermissionState.GRANTED) {
            main.post { start(call) }
        } else {
            call.reject("Microphone permission refused", "denied")
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        main.post {
            stopAll("cancelled", "Cancelled")
            call.resolve()
        }
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        val locale = call.getString("locale")
        if (locale.isNullOrBlank()) {
            call.reject("locale is required", "not_supported")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(status("unsupported"))
            return
        }
        main.post {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) download(call, locale)
        }
    }

    /** The app left the screen (or a call came in): stop listening, release the microphone. */
    override fun handleOnPause() {
        super.handleOnPause()
        main.post { stopAll("interrupted", "The app left the screen") }
    }

    override fun handleOnDestroy() {
        main.post { stopAll("interrupted", "The app closed") }
        super.handleOnDestroy()
    }

    private fun onDeviceAvailable(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && onDeviceServiceAvailable()

    @RequiresApi(Build.VERSION_CODES.S)
    private fun onDeviceServiceAvailable(): Boolean = SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    private fun baseCapabilities(): JSObject {
        val onDevice = onDeviceAvailable()
        return JSObject().apply {
            put("platform", "android")
            put("osVersion", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            put("recognitionAvailable", SpeechRecognizer.isRecognitionAvailable(context))
            put("onDeviceAvailable", onDevice)
            put(
                "onDeviceReason",
                when {
                    Build.VERSION.SDK_INT < Build.VERSION_CODES.S -> "api_below_31"
                    !onDevice -> "no_on_device_service"
                    else -> JSONObject.NULL
                },
            )
            put("languageInstalled", JSONObject.NULL)
            put("languagePending", JSONObject.NULL)
            put("languageDownloadable", JSONObject.NULL)
            put("canDownload", onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            put("biasing", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            put("microphonePermission", permissionName(getPermissionState(MICROPHONE)))
            put("speechPermission", "not_needed")
        }
    }

    private fun permissionName(state: PermissionState?): String =
        when (state) {
            PermissionState.GRANTED -> "granted"
            PermissionState.DENIED -> "denied"
            else -> "prompt"
        }

    private fun start(call: PluginCall) {
        if (session != null || starting != null) {
            call.reject("Already listening", "busy")
            return
        }
        val request = Request(
            locale = call.getString("locale") ?: "",
            maxResults = SpeechCodes.maxResults(call.getInt("maxResults")),
            timeoutMs = SpeechCodes.timeoutMs(call.getInt("timeoutMs")),
            hints = strings(call.getArray("hints")),
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            startOnDevice(call, request)
        } else {
            call.reject("On-device recognition needs Android 12", "on_device_unavailable")
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun startOnDevice(call: PluginCall, request: Request) {
        if (!onDeviceServiceAvailable()) {
            call.reject("No on-device recognizer on this phone", "on_device_unavailable")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            beginAfterLanguageCheck(call, request)
        } else {
            // Android 12: the language cannot be checked first; the recogniser reports ERROR_LANGUAGE_*.
            begin(call, request)
        }
    }

    /** Android 13+: the language must be installed on the phone, else nothing starts (no server fallback). */
    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun beginAfterLanguageCheck(call: PluginCall, request: Request) {
        starting = call
        val ticket = generation
        checkLanguage(request.locale) { support ->
            if (ticket != generation || starting !== call) return@checkLanguage
            starting = null
            if (support != null && !support.installed) {
                val data = JSObject().put("downloadable", support.downloadable).put("pending", support.pending)
                call.reject("The language is not installed on the device", "language_unavailable", data)
            } else {
                begin(call, request)
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun begin(call: PluginCall, request: Request) {
        val recognizer =
            try {
                SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            } catch (error: Exception) {
                call.reject("The on-device recognizer could not start", "on_device_unavailable")
                return
            }
        val current = Session(call, recognizer, System.currentTimeMillis())
        session = current
        recognizer.setRecognitionListener(listenerFor(current))
        val watchdog = Runnable { finish(current) { it.call.reject("No answer in time", "timeout") } }
        current.watchdog = watchdog
        main.postDelayed(watchdog, request.timeoutMs)
        try {
            recognizer.startListening(intentFor(request.locale, request.maxResults, request.hints))
        } catch (error: Exception) {
            finish(current) { it.call.reject("The recognizer could not start", "recognizer_error") }
        }
    }

    private fun intentFor(locale: String, maxResults: Int, hints: List<String>): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, maxResults)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            if (hints.isNotEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(hints))
            }
        }

    private fun listenerFor(current: Session) =
        object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = state(current, "ready")

            override fun onBeginningOfSpeech() = state(current, "speech")

            override fun onRmsChanged(rmsdB: Float) = Unit

            override fun onBufferReceived(buffer: ByteArray?) = Unit

            override fun onEndOfSpeech() {
                if (session !== current) return
                current.endOfSpeechAt = System.currentTimeMillis()
                state(current, "processing")
            }

            override fun onError(error: Int) {
                finish(current) { it.call.reject("Speech recognizer error $error", SpeechCodes.errorCode(error)) }
            }

            override fun onResults(results: Bundle?) {
                val resultAt = System.currentTimeMillis()
                val texts = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: arrayListOf()
                val scores = results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
                finish(current) { it.call.resolve(answer(it, texts, scores, resultAt)) }
            }

            override fun onPartialResults(partialResults: Bundle?) = Unit

            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        }

    private fun answer(current: Session, texts: List<String>, scores: FloatArray?, resultAt: Long): JSObject {
        val confidences = JSArray()
        texts.indices.forEach { index ->
            val score = scores?.getOrNull(index)
            if (score != null && score >= 0f) confidences.put(score.toDouble()) else confidences.put(JSONObject.NULL)
        }
        return JSObject().apply {
            put("alternatives", JSArray(texts))
            put("confidences", confidences)
            put("startedAt", current.startedAt)
            put("endOfSpeechAt", current.endOfSpeechAt ?: JSONObject.NULL)
            put("resultAt", resultAt)
            put("onDevice", true)
        }
    }

    private fun state(current: Session, value: String) {
        if (session === current) notifyListeners("speechState", JSObject().put("state", value))
    }

    /** Ends `current` once: no further callbacks count, the watchdog stops, the recogniser is destroyed. */
    private fun finish(current: Session, settle: (Session) -> Unit) {
        if (session !== current) return
        session = null
        current.watchdog?.let { main.removeCallbacks(it) }
        // Destroyed after the callback returns: never from inside the recogniser's own callback.
        main.post { release(current.recognizer) }
        settle(current)
    }

    private fun stopAll(code: String, message: String) {
        generation += 1
        starting?.let {
            starting = null
            it.reject(message, code)
        }
        session?.let { current -> finish(current) { it.call.reject(message, code) } }
    }

    private fun release(recognizer: SpeechRecognizer) {
        try {
            recognizer.cancel()
        } catch (_: Exception) {
            // already stopped
        }
        try {
            recognizer.destroy()
        } catch (_: Exception) {
            // already destroyed
        }
    }

    /** Asks the on-device recogniser whether `locale` is installed; null when it cannot tell (4 s at most). */
    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun checkLanguage(locale: String, done: (LanguageSupport?) -> Unit) {
        val recognizer =
            try {
                SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            } catch (error: Exception) {
                done(null)
                return
            }
        var answered = false
        lateinit var timeout: Runnable
        fun answer(value: LanguageSupport?) {
            if (answered) return
            answered = true
            main.removeCallbacks(timeout)
            main.post { release(recognizer) }
            done(value)
        }
        timeout = Runnable { answer(null) }
        main.postDelayed(timeout, LANGUAGE_CHECK_MS)
        try {
            recognizer.checkRecognitionSupport(
                intentFor(locale, 1, emptyList()),
                context.mainExecutor,
                object : RecognitionSupportCallback {
                    override fun onSupportResult(recognitionSupport: RecognitionSupport) {
                        answer(
                            SpeechCodes.languageSupport(
                                locale,
                                recognitionSupport.installedOnDeviceLanguages,
                                recognitionSupport.pendingOnDeviceLanguages,
                                recognitionSupport.supportedOnDeviceLanguages,
                            ),
                        )
                    }

                    override fun onError(error: Int) = answer(null)
                },
            )
        } catch (error: Exception) {
            answer(null)
        }
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun download(call: PluginCall, locale: String) {
        if (!onDeviceServiceAvailable()) {
            call.resolve(status("unsupported"))
            return
        }
        val recognizer =
            try {
                SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            } catch (error: Exception) {
                call.resolve(status("error"))
                return
            }
        val intent = intentFor(locale, 1, emptyList())
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                downloadWithUpdates(call, recognizer, intent)
            } else {
                // Android 13: no progress callback; the service may ask the person to approve the download.
                recognizer.triggerModelDownload(intent)
                call.resolve(status("started"))
                main.postDelayed({ release(recognizer) }, DOWNLOAD_HOLD_MS)
            }
        } catch (error: Exception) {
            release(recognizer)
            call.resolve(status("error"))
        }
    }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun downloadWithUpdates(call: PluginCall, recognizer: SpeechRecognizer, intent: Intent) {
        var answered = false
        var released = false
        fun answer(value: String) {
            if (answered) return
            answered = true
            call.resolve(status(value))
        }
        fun done(value: String) {
            answer(value)
            if (released) return
            released = true
            release(recognizer)
        }
        recognizer.triggerModelDownload(
            intent,
            context.mainExecutor,
            object : ModelDownloadListener {
                override fun onProgress(completedPercent: Int) = answer("started")

                override fun onSuccess() = done("success")

                override fun onScheduled() = done("scheduled")

                override fun onError(error: Int) = done("error")
            },
        )
        main.postDelayed({ answer("started") }, DOWNLOAD_ANSWER_MS)
        main.postDelayed({ done("started") }, DOWNLOAD_HOLD_MS)
    }

    private fun status(value: String) = JSObject().put("status", value)

    private fun strings(array: JSArray?): List<String> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { index -> array.optString(index, null)?.takeIf { it.isNotBlank() } }
    }

    private companion object {
        const val MICROPHONE = "microphone"
        const val LANGUAGE_CHECK_MS = 4_000L
        const val DOWNLOAD_ANSWER_MS = 5_000L
        const val DOWNLOAD_HOLD_MS = 120_000L
    }
}
