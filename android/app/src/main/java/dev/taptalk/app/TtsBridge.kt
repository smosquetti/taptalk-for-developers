package dev.taptalk.app

import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.util.Log
import android.webkit.JavascriptInterface
import java.util.UUID

/**
 * Exposed to the web app as `window.taptalkNative`. The injected
 * speechSynthesis shim routes every speak()/cancel() call here,
 * which forwards them to the device's TextToSpeech engine (de-DE).
 *
 * TTS calls must happen on the main thread, but @JavascriptInterface
 * methods arrive on a WebView bridge thread, so everything is posted.
 *
 * End-of-utterance detection deliberately does NOT rely on
 * UtteranceProgressListener.onDone: on this device's OEM TTS engine
 * onDone is never delivered for utterances started with a null id, which
 * left the web `speaking` flag stuck true (the play-button outline never
 * cleared). Instead a watchdog polls isSpeaking() after every utterance
 * and reports the end through [onUtteranceEnd] exactly once, so the flag
 * is always cleared when the audio actually finishes.
 */
class TtsBridge {
    @Volatile private var tts: TextToSpeech? = null
    @Volatile private var ready = false
    @Volatile private var pendingText: String? = null
    @Volatile private var pendingRate = 1f

    /** Invoked on the main thread exactly once when the current utterance ends. */
    @Volatile var onUtteranceEnd: (() -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private var currentUtteranceId: String? = null
    private var endReportedForCurrent = false

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
            // A fresh token per utterance lets the watchdog tell a superseded
            // utterance apart from the one that is actually playing. (Not passed
            // to the engine: end-of-speech is detected via isSpeaking(), so a
            // TTS utterance id — and the onDone callback that depends on it — is
            // unnecessary here.)
            val id = UUID.randomUUID().toString()
            currentUtteranceId = id
            endReportedForCurrent = false
            t.speak(text, TextToSpeech.QUEUE_FLUSH, null)
            startWatchdog(id)
        }
    }

    @JavascriptInterface
    fun stop() {
        // We intentionally do NOT clear the end flag here: a stop is usually
        // immediately followed by a new speak (the web speak() cancels before
        // speaking). Clearing here would lift the outline of the utterance
        // that is about to play. The watchdog for the current utterance
        // clears the flag once isSpeaking() actually goes false, and its token
        // guard keeps a superseded watchdog from clearing a newer utterance.
        main.post {
            if (ready) tts?.stop()
        }
    }

    /**
     * Polls isSpeaking() until the utterance identified by [id] is no longer
     * being spoken, then reports the end exactly once. A newer speak
     * supersedes this watchdog (id != currentUtteranceId), so switching
     * buttons never clears the flag of the utterance that is now playing.
     */
    private fun startWatchdog(id: String) {
        var consecutiveNotSpeaking = 0
        val check = object : Runnable {
            override fun run() {
                if (id != currentUtteranceId) return // superseded by a newer speak
                if (endReportedForCurrent) return
                val t = tts ?: return
                if (t.isSpeaking()) {
                    consecutiveNotSpeaking = 0
                    main.postDelayed(this, 150)
                } else {
                    // Require two consecutive "not speaking" readings so a slow
                    // engine start (isSpeaking() briefly false right after
                    // speak) doesn't lift the outline before audio begins.
                    consecutiveNotSpeaking++
                    if (consecutiveNotSpeaking >= 2) {
                        endReportedForCurrent = true
                        Log.d(TAG, "utterance ended -> clearing web speaking flag")
                        onUtteranceEnd?.invoke()
                    } else {
                        main.postDelayed(this, 150)
                    }
                }
            }
        }
        main.postDelayed(check, 150)
    }

    companion object {
        private const val TAG = "TtsBridge"
    }
}
