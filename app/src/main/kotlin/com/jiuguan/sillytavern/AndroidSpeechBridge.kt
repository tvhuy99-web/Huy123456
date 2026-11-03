package com.jiuguan.sillytavern

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Native Android speech fallback for SillyTavern System TTS.
 *
 * Pattern adapted from the user's NgheTruyen-Kotlin project:
 * asynchronously initialise Android TextToSpeech, list actual Android voices,
 * choose an installed voice/default fallback, observe utterance completion,
 * stop and shutdown the engine cleanly.
 *
 * JS interface calls arrive on a WebView background thread. All TTS engine
 * calls and lifecycle state are confined to the Android main looper.
 */
class AndroidSpeechBridge(
    context: Context,
    private val notifyJavascript: (id: String, success: Boolean, error: String) -> Unit
) {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    private var ready = false
    private var failed = false
    private var destroyed = false
    private val pending = mutableListOf<SpeechTask>()
    private val active = mutableSetOf<String>()
    @Volatile private var voiceSnapshot = "[]"
    @Volatile private var state = "initializing"

    private data class SpeechTask(
        val id: String,
        val text: String,
        val voice: String,
        val language: String,
        val rate: Float,
        val pitch: Float,
        val volume: Float
    )

    init {
        main.post {
            try {
                engine = TextToSpeech(app) { status ->
                    main.post {
                        if (destroyed) return@post
                        val service = engine
                        if (status != TextToSpeech.SUCCESS || service == null) {
                            failed = true
                            state = "error"
                            DiagnosticStore.record(app, "warn", "tts",
                                "Bộ máy TextToSpeech Android không khởi tạo được (mã $status)")
                            flushPendingWithError("Android TTS chưa sẵn sàng")
                            return@post
                        }
                        ready = true
                        state = "ready"
                        service.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String?) = Unit
                            override fun onDone(utteranceId: String?) {
                                main.post { finish(utteranceId, true, "") }
                            }
                            override fun onError(utteranceId: String?) {
                                main.post { finish(utteranceId, false, "TTS Android báo lỗi đọc") }
                            }
                            override fun onError(utteranceId: String?, errorCode: Int) {
                                main.post { finish(utteranceId, false, "TTS Android lỗi $errorCode") }
                            }
                        })
                        val voices = JSONArray()
                        service.voices.orEmpty()
                            .sortedWith(compareBy<android.speech.tts.Voice> {
                                it.isNetworkConnectionRequired
                            }.thenBy { it.locale.language }.thenBy { it.name })
                            .forEach { voice ->
                                voices.put(JSONObject()
                                    .put("voiceURI", voice.name)
                                    .put("name", voice.name)
                                    .put("lang", voice.locale.toLanguageTag()))
                            }
                        voiceSnapshot = voices.toString()
                        val queued = pending.toList()
                        pending.clear()
                        queued.forEach(::submit)
                    }
                }
            } catch (error: Exception) {
                failed = true
                state = "error"
                DiagnosticStore.record(app, "error", "tts",
                    "Không tạo được Android TTS: " + (error.message ?: error.javaClass.simpleName))
                flushPendingWithError("Không tạo được bộ máy TTS")
            }
        }
    }

    @JavascriptInterface
    fun getStatus(): String = state

    @JavascriptInterface
    fun getVoices(): String = voiceSnapshot

    @JavascriptInterface
    fun speak(
        id: String, text: String, voice: String, language: String,
        rate: Float, pitch: Float, volume: Float
    ) {
        val token = id.take(100)
        if (token.isBlank()) return
        val task = SpeechTask(
            token, text.take(3900), voice.take(200), language.take(40),
            rate.coerceIn(0.1f, 3.0f), pitch.coerceIn(0.1f, 2.0f),
            volume.coerceIn(0f, 1f)
        )
        main.post {
            if (destroyed || failed) {
                notifyJavascript(token, false, "Bộ máy Android TTS không khả dụng")
            } else if (!ready) {
                if (pending.size >= 8) {
                    notifyJavascript(token, false, "Hàng đợi TTS đã đầy")
                    return@post
                }
                pending.add(task)
                main.postDelayed({
                    if (pending.remove(task)) {
                        notifyJavascript(token, false, "Android TTS khởi tạo quá lâu")
                    }
                }, 15000)
            } else {
                submit(task)
            }
        }
    }

    private fun submit(task: SpeechTask) {
        val service = engine
        if (!ready || service == null || destroyed) {
            notifyJavascript(task.id, false, "Android TTS chưa sẵn sàng")
            return
        }
        try {
            // The compatibility path uses a silent wake-up utterance on
            // Android. Skip audio but still signal success asynchronously.
            if (task.volume == 0f || task.text.isBlank()) {
                notifyJavascript(task.id, true, "")
                return
            }
            if (task.voice.isNotBlank() && task.voice != "__browser_default__") {
                val requested = service.voices.orEmpty()
                    .firstOrNull { it.name == task.voice }
                if (requested != null) {
                    service.voice = requested
                } else {
                    applyLanguage(service, task.language)
                }
            } else {
                applyLanguage(service, task.language)
            }
            service.setSpeechRate(task.rate)
            service.setPitch(task.pitch)
            val parameters = Bundle().apply {
                putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, task.volume)
            }
            active.add(task.id)
            // ST speaks one chunk at a time, waiting on onDone before the next.
            val result = service.speak(task.text, TextToSpeech.QUEUE_FLUSH, parameters, task.id)
            if (result == TextToSpeech.ERROR) {
                finish(task.id, false, "Android TTS từ chối phát âm thanh")
            }
        } catch (error: Exception) {
            finish(task.id, false, error.message ?: error.javaClass.simpleName)
        }
    }

    private fun applyLanguage(service: TextToSpeech, language: String) {
        val locale = if (language.isBlank()) Locale.getDefault()
            else Locale.forLanguageTag(language)
        val result = service.setLanguage(locale)
        if (result == TextToSpeech.LANG_NOT_SUPPORTED ||
            result == TextToSpeech.LANG_MISSING_DATA) {
            service.setLanguage(Locale.getDefault())
        }
    }

    private fun finish(id: String?, success: Boolean, reason: String) {
        if (id == null || !active.remove(id)) return
        if (!success) DiagnosticStore.record(app, "warn", "tts",
            "Không đọc được đoạn TTS: $reason")
        notifyJavascript(id, success, reason)
    }

    private fun flushPendingWithError(reason: String) {
        val tasks = pending.toList()
        pending.clear()
        tasks.forEach { notifyJavascript(it.id, false, reason) }
    }

    @JavascriptInterface
    fun cancel() {
        main.post {
            engine?.stop()
            flushPendingWithError("Đã hủy TTS")
            for (id in active.toList()) finish(id, false, "Đã hủy TTS")
        }
    }

    fun shutdown() {
        main.post {
            if (destroyed) return@post
            destroyed = true
            flushPendingWithError("Ứng dụng đã đóng")
            active.clear()
            engine?.stop()
            engine?.shutdown()
            engine = null
            voiceSnapshot = "[]"
            state = "closed"
        }
    }
}
