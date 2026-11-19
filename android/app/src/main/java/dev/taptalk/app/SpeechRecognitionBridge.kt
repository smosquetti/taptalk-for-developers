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
        Log.d(TAG, "startListening() called from JS")
        main.post {
            Log.d(TAG, "on main thread: active=$active")
            if (active) {
                Log.w(TAG, "ignored — already active")
                return@post
            }
            if (!hasMicPermission()) {
                // The system dialog is about to appear; tell the web side
                // now so the UI lifts the listening state instead of
                // waiting for a result that will never come.
                Log.w(TAG, "RECORD_AUDIO not granted — launching permission dialog")
                micPermissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
                emitError(CODE_NO_PERMISSION)
                return@post
            }
            errorEmitted = false
            session += 1
            active = true
            Log.d(TAG, "starting session $session")
            val rec =
                ensureRecognizer()
                    ?: run {
                        active = false
                        Log.e(TAG, "no recognizer — createSpeechRecognizer returned null")
                        emitError(CODE_UNAVAILABLE)
                        return@post
                    }
            try {
                Log.d(TAG, "calling SpeechRecognizer.startListening(de-DE, FREE_FORM, maxResults=3)")
                rec.startListening(recognitionIntent())
            } catch (e: Exception) {
                active = false
                Log.e(TAG, "startListening threw", e)
                emitError(
                    if (e is IllegalArgumentException) CODE_UNAVAILABLE else CODE_ENGINE_ERROR,
                )
            }
        }
    }

    @JavascriptInterface
    fun stopListening() {
        Log.d(TAG, "stopListening() called")
        main.post {
            if (!active) {
                Log.d(TAG, "not active — nothing to stop")
                return@post
            }
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
        recognizer?.let {
            Log.d(TAG, "reusing existing recognizer")
            return it
        }
        Log.d(TAG, "creating SpeechRecognizer")
        val created =
            SpeechRecognizer.createSpeechRecognizer(activity)
                ?: run {
                    Log.e(TAG, "createSpeechRecognizer returned null")
                    null
                }
            ?: return null
        created.setRecognitionListener(listener)
        recognizer = created
        Log.d(TAG, "SpeechRecognizer created")
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

    /**
     * Reads the recognized-match list from a recognition bundle. The AOSP
     * key is "matches" (RecognizerResult.ALTERNATIVE_MATCHES), but some
     * recognition services return the text under a different key — this
     * device uses "results_recognition" (confirmed via logcat). Tries each
     * known key, type-tolerantly (value may be a StringArrayList, a plain
     * ArrayList<String>, or a single String).
     */
    private fun readMatches(bundle: Bundle?): List<String> {
        if (bundle == null) return emptyList()
        for (key in listOf("matches", "results_recognition")) {
            val raw = bundle.get(key) ?: continue
            when (raw) {
                is List<*> -> {
                    val strings = raw.filterIsInstance<String>()
                    if (strings.isNotEmpty()) return strings
                }
                is Array<*> -> {
                    val strings = raw.filterIsInstance<String>()
                    if (strings.isNotEmpty()) return strings
                }
                is String -> return listOf(raw)
            }
        }
        return emptyList()
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            Log.d(TAG, "onReadyForSpeech — mic armed, waiting for audio")
        }

        override fun onBeginningOfSpeech() {
            Log.d(TAG, "onBeginningOfSpeech — audio level detected, recognizing…")
        }

        override fun onRmsChanged(rms: Float) {}

        override fun onBufferReceived(buffer: ByteArray) {}

        override fun onEndOfSpeech() {
            Log.d(TAG, "onEndOfSpeech — engine done capturing, awaiting result…")
        }

        // New in API 35+: segmentation/session events — no-op for us.
        override fun onEvent(eventType: Int, eventArgs: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            Log.d(TAG, "onPartialResults (raw engine output): ${readMatches(partialResults)}")
        }

        override fun onResults(results: Bundle?) {
            if (!active || errorEmitted) {
                Log.w(TAG, "onResults dropped (active=$active errorEmitted=$errorEmitted)")
                return
            }
            active = false
            // Recognized text: standard AOSP key "matches", or the OEM key
            // "results_recognition" on this device — readMatches handles both.
            val matches = readMatches(results)
            Log.d(
                TAG,
                "onResults recognized: $matches (count=${matches.size}) " +
                    "keys=${results?.keySet()}",
            )
            emitResults(matches)
        }

        override fun onError(errorType: Int) {
            Log.e(
                TAG,
                "onError raw=$errorType (AUDIO=1 CLIENT=3 INSUFFICIENT_PERMISSIONS=4 " +
                    "NETWORK=5 NO_MATCH=6 RECOGNIZER_BUSY=7 SERVER=8 NETWORK_TIMEOUT=9) " +
                    "-> mapped=${mapErrorCode(errorType)}",
            )
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
        Log.d(TAG, "emit payload: $payload")
        val wv = webView
        if (wv == null) {
            Log.e(TAG, "emit dropped — webView not attached")
            return
        }
        // If the JS sink is missing, the delivery below is a no-op and the
        // web side falls back to its 15 s timeout (code 9) — make that
        // visible instead of silent.
        wv.evaluateJavascript("typeof window.taptalkOnRecognitionResult") { result ->
            if (result == "\"function\"") {
                Log.d(TAG, "JS sink present — delivering payload")
            } else {
                Log.e(TAG, "JS sink MISSING ($result) — payload dropped, web side will time out")
            }
        }
        // Pass the payload as a *quoted* JSON string literal — the JS
        // handler JSON.parses it, so it must receive a string. Embedding
        // payload.toString() bare would make JS see an object literal
        // (JSONObject.wrap() re-parses the JSON and returns it, still
        // unquoted).
        val literal = jsonStringLiteral(payload.toString())
        wv.evaluateJavascript(
            "window.taptalkOnRecognitionResult && " +
                "window.taptalkOnRecognitionResult($literal)",
            null,
        )
    }

    /**
     * Quotes + escapes a string as a JSON/JS string literal so it can be
     * embedded safely in an evaluateJavascript() expression.
     */
    private fun jsonStringLiteral(text: String): String {
        val sb = StringBuilder("\"")
        for (c in text) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\u0008' -> sb.append("\\b")
                '\u000c' -> sb.append("\\f")
                else -> {
                    if (c < ' ') {
                        // C0 control characters: \u00XX
                        sb.append(String.format("\\u%04x", c.code))
                    } else {
                        sb.append(c)
                    }
                }
            }
        }
        return sb.append("\"").toString()
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
