package dev.taptalk.app

import android.annotation.SuppressLint
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import android.view.KeyEvent
import android.widget.FrameLayout
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.util.Locale
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewClientCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat


private const val TAG = "TapTalk"
private const val BRIDGE_NAME = "taptalkNative"

// The statically exported web app is bundled into the APK under
// assets/webapp and served over a private https:// origin with
// WebViewAssetLoader: the web app (including its fetch() calls) behaves
// like a normal same-origin web page, while every request to this host
// is answered locally from the APK — no network, no permissions.
private const val ASSET_HOST = "appassets.taptalk.local"
private const val HOME_URL = "https://$ASSET_HOST/webapp/index.html"

/**
 * Minimal Web Speech API shim. The app only uses SpeechSynthesisUtterance,
 * speechSynthesis.speak(), .cancel() and .getVoices().
 */
private const val SPEECH_SHIM = """
(function () {
  if (window.__taptalkShim) return;
  window.__taptalkShim = true;

  function Utterance(text) {
    this.text = text;
    this.lang = "de-DE";
    this.rate = 1;
    this.pitch = 1;
  }
  window.SpeechSynthesisUtterance = Utterance;

  var synth = {
    speaking: false,
    pending: false,
    paused: false,
    speak: function (u) {
      if (!u) return;
      if (window.taptalkNative) {
        window.taptalkNative.speak(u.text || "", u.rate || 1);
      }
      this.speaking = true;
    },
    cancel: function () {
      if (window.taptalkNative) window.taptalkNative.stop();
      this.speaking = false;
    },
    pause: function () {},
    resume: function () {},
    getVoices: function () { return []; },
    onvoiceschanged: null
  };
  window.speechSynthesis = synth;
})();
"""

/**
 * Single-activity WebView shell.
 *
 * - Serves the app from assets/webapp over https://appassets.taptalk.local
 *   via WebViewAssetLoader, so the page — including fetch() — runs like a
 *   normal web page while every request is answered locally from the APK:
 *   100% offline, zero permissions.
 * - Bridges window.speechSynthesis to the device's native TextToSpeech
 *   so the German audio feature works inside the APK.
 * - Blocks any navigation off the private asset host as a hard guarantee
 *   that nothing ever touches the network.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var container: FrameLayout
    private lateinit var webView: WebView
    private lateinit var tts: TextToSpeech
    private lateinit var bridge: TtsBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bridge = TtsBridge()
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.GERMAN)
                bridge.markReady()
                bridge.flushPending()
            } else {
                Log.w(TAG, "TextToSpeech failed to initialize (status=$status)")
            }
        }
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) = syncSpeakingState()
            override fun onError(utteranceId: String?) = syncSpeakingState()
        })
        bridge.attach(tts)

        webView = WebView(this)
        // Chromium's fetch() refuses file:// URLs even with
        // allowUniversalAccessFromFileURLs set, so the bundled app is
        // served over a private https origin instead; the loader answers
        // every request from the APK's assets before any network I/O.
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // remember the sound toggle (best effort)
            allowContentAccess = true // required for WebViewAssetLoader
        }

        webView.webViewClient = object : WebViewClient() {
            // Inject the Web Speech API shim before the app's scripts run.
            // API 37 only has the String/Bitmap overload here.
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                view.evaluateJavascript(SPEECH_SHIM, null)
            }

            // Re-inject after load too (idempotent — the shim guards
            // against double installation).
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                view.evaluateJavascript(SPEECH_SHIM, null)
            }

            // The app navigates with plain <a> links between the bundled
            // pages; anything that is not on the private asset host is
            // dropped, so nothing ever touches the network.
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val uri = request.url
                return if (uri.host == ASSET_HOST) {
                    false
                } else {
                    Log.w(TAG, "blocking navigation outside the asset host: $uri")
                    true
                }
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                Log.e(
                    TAG,
                    "Network Error | URL: ${request.url} | Method: ${request.method} | " +
                    "Code: ${error.errorCode} | Desc: ${error.description}"
                )
            }

            // 2. Catches HTTP error status codes (404, 500, 403, etc.)
            // Note: Only triggered for status codes >= 400 on API 23+
            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                errorResponse: WebResourceResponse
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                Log.e(
                    TAG,
                    "HTTP Error ${errorResponse.statusCode} (${errorResponse.reasonPhrase}) | " +
                    "URL: ${request.url}"
                )
            }

        }

        // 3. Catches CORS errors and unhandled fetch() promise rejections
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                if (consoleMessage.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.e(
                        TAG,
                        "JS Console Error: ${consoleMessage.message()} " +
                        "(${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})"
                    )
                }
                return super.onConsoleMessage(consoleMessage)
            }
        }


        webView.addJavascriptInterface(bridge, BRIDGE_NAME)

        // The padding must live on a container, NOT on the WebView:
        // Chromium renders the web content across the WebView's full
        // bounds and ignores the WebView's own padding — verified on
        // device (setPadding on the WebView had no visual effect).
        // The background matches the web app's page color (#05070d) so
        // the padded strips blend into the page.
        container = FrameLayout(this)
        container.setBackgroundColor(0xFF05070D.toInt())
        container.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(container)

        // Targeting API 35+ enforces edge-to-edge: the page is drawn
        // behind the status bar (including the camera cutout), so the
        // container is padded below them.
        applySystemBarInsets()

        webView.loadUrl(HOME_URL)
    }

    /** Keep the app's `speechSynthesis.speaking` flag in sync. */
    private fun syncSpeakingState() {
        webView.evaluateJavascript(
            "if (window.speechSynthesis) window.speechSynthesis.speaking = false;",
            null,
        )
    }

    /** The web app navigates with real page loads, so the WebView history works. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applySystemBarInsets()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applySystemBarInsets()
    }

    /**
     * Targeting API 35+ enforces edge-to-edge: the page is drawn behind
     * the status bar (and the camera cutout), so the container around
     * the WebView is padded below them. Below API 35 the system already
     * lays the content out under the bars, so no padding is needed.
     * Values are logged under tag "TapTalk".
     */
    private fun applySystemBarInsets() {
        if (Build.VERSION.SDK_INT < 35) return

        ViewCompat.setOnApplyWindowInsetsListener(container) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout()
            )
            Log.d(
                TAG,
                "windowInsets.getInsets(systemBars|displayCutout): " +
                    "top=${bars.top} left=${bars.left} " +
                    "right=${bars.right} bottom=${bars.bottom}"
            )

            container.setPadding(0, bars.top, 0, bars.bottom)
            Log.d(
                TAG,
                "container padding set to live insets: " +
                    "top=${bars.top} bottom=${bars.bottom}"
            )

            // Return CONSUMED so child views don't double-apply the padding
            WindowInsetsCompat.CONSUMED
        }
    }

    override fun onPause() {
        super.onPause()
        tts.stop()
    }

    override fun onDestroy() {
        super.onDestroy()
        tts.stop()
        tts.shutdown()
    }
}
