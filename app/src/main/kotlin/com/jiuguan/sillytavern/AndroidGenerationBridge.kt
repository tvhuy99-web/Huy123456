package com.jiuguan.sillytavern

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

/**
 * Small, one-way bridge for the generation lifecycle.
 * Never exposes files, secrets, JavaScript evaluation, or server internals.
 */
class AndroidGenerationBridge(
    private val appContext: Context,
    private val onGeneratingChanged: (Boolean) -> Unit
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun setActive(active: Boolean) {
        // JavaScriptInterface callbacks run on a private WebView thread.
        // WebView and UI state can only be touched on Android's main thread.
        mainHandler.post {
            onGeneratingChanged(active)
            NodeService.setGenerationActive(appContext,active)
        }
    }
}
