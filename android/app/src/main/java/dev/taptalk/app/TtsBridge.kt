package dev.taptalk.app

import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.util.Log
import android.webkit.JavascriptInterface

/**
 * Exposed to the web app as `window.taptalkNative`. The injected
 * speechSynthesis shim routes every speak()/cancel() call here,
 * which forwards them to the device's TextToSpeech engine (de-DE).
 *
 * TTS calls must happen on the main thread, but @JavascriptInterface
 * methods arrive on a WebView bridge thread, so everything is posted.
 */
class TtsBridge {
    @Volatile private var tts: TextToSpeech? = null
    @Volatile private var ready = false
    @Volatile private var pendingText: String? = null
    @Volatile private var pendingRate = 1f

    private val main = Handler(Looper.getMainLooper())

    fun attach(tts: TextToSpeech) {
        this.tts = tts
    }

    fun markReady() {
        ready = true
    }

    /** Speaks anything queued while TTS was still initializing. */
    fun flushPending() {
        val text = pendingText ?: return
        pendingText = null
        speak(text, pendingRate)
    }

    @JavascriptInterface
    fun speak(text: String, rate: Float) {
        if (text.isBlank()) return
        if (!ready) {
            // TTS is not up yet — remember the last utterance.
            pendingText = text
            pendingRate = rate
            return
        }
        main.post {
            val t = tts ?: return@post
            if (!ready) return@post
            t.setSpeechRate(rate.coerceIn(0.5f, 2f))
            t.speak(text, TextToSpeech.QUEUE_FLUSH, null)
        }
    }

    @JavascriptInterface
    fun stop() {
        main.post {
            if (ready) tts?.stop()
        }
    }

    companion object {
        private const val TAG = "TtsBridge"
    }
}
