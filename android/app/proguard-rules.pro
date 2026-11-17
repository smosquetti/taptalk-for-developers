# The WebView calls TtsBridge methods reflectively from JavaScript.
# R8 would otherwise treat them as unreachable.
-keepclassmembers class dev.taptalk.app.TtsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
