package dev.taptalk.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Exposed to the web app as `window.taptalkRecognizer`
 * (startListening / stopListening). The Speak quiz triggers the device's
 * SpeechRecognizer (de-DE) and receives results through
 * `window.taptalkOnRecognitionResult(json)` — same pattern as TtsBridge.
 *
 * SpeechRecognizer methods must run on the main thread, but
 * @JavascriptInterface calls arrive on a WebView bridge thread, so
 * everything is posted to the main looper.
 *
 * The code sent to JS is a stable app-defined value, NOT the raw
 * SpeechRecognizer.ERROR_* constants — their numeric values differ between
 * SDK versions, so the web side must never depend on them:
 *   -1  RECORD_AUDIO not granted (JS prompts the user to grant and retry)
 *    1  no speech recognition service on the device
 *    2  recognizer busy
 *    3  no usable match
 *    4  audio capture failure
 *    5  network / server / other engine error
 */
class SpeechRecognitionBridge(
    private val activity: MainActivity,
    // registerForActivityResult is a ComponentActivity extension, so the
    // launcher is created on MainActivity and injected here.
    private val micPermissionLauncher: ActivityResultLauncher<Array<String>>,
) {

    private var webView: WebView? = null

    @Volatile private var recognizer: SpeechRecognizer? = null
    @Volatile private var active = false
    // Guard: emit at most one error payload per session (onError can fire
    // more than once for a single failure).
    @Volatile private var errorEmitted = false
    // Monotonic per start; echoed in every payload so the web side can
    // drop results that belong to an already-superseded session.
    @Volatile private var session = 0

    private val main = Handler(Looper.getMainLooper())

    fun attach(webView: WebView) {
        this.webView = webView
    }

    @JavascriptInterface
    fun startListening() {
        main.post {
            if (active) return@post
            if (!hasMicPermission()) {
                // The system dialog is about to appear; tell the web side
                // now so the UI lifts the listening state instead of
                // waiting for a result that will never come.
                micPermissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
                emitError(CODE_NO_PERMISSION)
                return@post
            }
            errorEmitted = false
            session += 1
            active = true
            val rec =
                ensureRecognizer()
                    ?: run {
                        active = false
                        emitError(CODE_UNAVAILABLE)
                        return@post
                    }
            try {
                rec.startListening(recognitionIntent())
            } catch (e: Exception) {
                active = false
                Log.w(TAG, "startListening failed", e)
                emitError(
                    if (e is IllegalArgumentException) CODE_UNAVAILABLE else CODE_ENGINE_ERROR,
                )
            }
        }
    }

    @JavascriptInterface
    fun stopListening() {
        main.post {
            if (!active) return@post
            active = false
            stopRecognizer()
        }
    }

    /** Called from MainActivity.onDestroy — stops and releases the recognizer. */
    fun release() {
        main.post {
            active = false
            recognizer?.let {
                try {
                    it.stopListening()
                } catch (e: Exception) {
                    Log.w(TAG, "stopListening in release failed", e)
                }
                try {
                    it.destroy()
                } catch (e: Exception) {
                    Log.w(TAG, "destroy failed", e)
                }
            }
            recognizer = null
        }
    }

    private fun hasMicPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED

    private fun recognitionIntent(): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE")
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        }

    /** Lazily created once; must be called on the main thread. */
    private fun ensureRecognizer(): SpeechRecognizer? {
        recognizer?.let { return it }
        val created =
            SpeechRecognizer.createSpeechRecognizer(activity)
                ?: run {
                    Log.w(TAG, "createSpeechRecognizer returned null")
                    null
                }
            ?: return null
        created.setRecognitionListener(listener)
        recognizer = created
        return created
    }

    private fun stopRecognizer() {
        recognizer?.let {
            try {
                it.stopListening()
            } catch (e: Exception) {
                Log.w(TAG, "stopListening failed", e)
            }
        }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}

        override fun onBeginningOfSpeech() {}

        override fun onRmsChanged(rms: Float) {}

        override fun onBufferReceived(buffer: ByteArray) {}

        override fun onEndOfSpeech() {}

        // New in API 35+: segmentation/session events — no-op for us.
        override fun onEvent(eventType: Int, eventArgs: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {}

        override fun onResults(results: Bundle?) {
            if (!active || errorEmitted) return
            active = false
            // "matches" is the RecognizerResult.ALTERNATIVE_MATCHES bundle key
            // — the class itself is a hidden API, absent from the compile stub.
            val matches = results?.getStringArrayList("matches") ?: emptyList()
            emitResults(matches)
        }

        override fun onError(errorType: Int) {
            Log.w(TAG, "recognition error: $errorType")
            emitError(mapErrorCode(errorType))
        }
    }

    private fun mapErrorCode(errorType: Int): Int =
        when (errorType) {
            SpeechRecognizer.ERROR_NO_MATCH -> CODE_NO_MATCH
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> CODE_BUSY
            SpeechRecognizer.ERROR_AUDIO -> CODE_AUDIO
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> CODE_NO_PERMISSION
            SpeechRecognizer.ERROR_CLIENT -> CODE_ENGINE_ERROR
            SpeechRecognizer.ERROR_SERVER -> CODE_ENGINE_ERROR
            SpeechRecognizer.ERROR_NETWORK -> CODE_ENGINE_ERROR
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> CODE_ENGINE_ERROR
            else -> CODE_ENGINE_ERROR
        }

    private fun emitError(code: Int) {
        if (errorEmitted) return
        errorEmitted = true
        active = false
        emit("error", null, code)
    }

    private fun emitResults(results: List<String>) {
        emit("result", results, null)
    }

    private fun emit(status: String, results: List<String>?, code: Int?) {
        val payload =
            JSONObject().apply {
                put("status", status)
                put("session", session)
                if (results != null) put("results", JSONArray(results))
                if (code != null) put("code", code)
            }
        val wv = webView ?: return
        wv.evaluateJavascript(
            "window.taptalkOnRecognitionResult && " +
                "window.taptalkOnRecognitionResult(${JSONObject.wrap(payload.toString())})",
            null,
        )
    }

    companion object {
        private const val TAG = "SpeechRecognitionBridge"

        const val CODE_NO_PERMISSION = -1
        const val CODE_UNAVAILABLE = 1
        const val CODE_BUSY = 2
        const val CODE_NO_MATCH = 3
        const val CODE_AUDIO = 4
        const val CODE_ENGINE_ERROR = 5
    }
}
