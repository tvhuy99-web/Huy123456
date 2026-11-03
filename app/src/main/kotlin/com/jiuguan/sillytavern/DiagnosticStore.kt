package com.jiuguan.sillytavern

import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque

/**
 * Bounded, sanitized Android diagnostic recorder.
 * It starts before any SillyTavern JavaScript can run.
 * Prompt and AI response content is never stored here.
 */
object DiagnosticStore {
    private const val PREFS = "st_android_diagnostics_v1"
    private const val SAVED = "recent_errors"
    private const val MEMORY_LIMIT = 220
    private const val PERSISTED_LIMIT = 45
    private val entries = ArrayDeque<JSONObject>()
    private var loaded = false

    private val redactions = listOf(
        Regex("(?i)(authorization\\s*[:=]\\s*bearer\\s+)[^\\s,\"'}]+"),
        Regex("(?i)([?&](?:api_key|apikey|token|key|secret|password)=)[^&#\\s]+"),
        Regex("(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\\s*[:=]\\s*['\\\"]?)[^\\s,\"'}]+"),
        Regex("(?i)\\b(?:sk|rk|sess)-[A-Za-z0-9_-]{12,}\\b")
    )

    private fun sanitized(raw: String): String {
        var safe = raw.take(2400).replace('\u0000', ' ')
        for (rule in redactions) {
            safe = if (rule.pattern.startsWith("(?i)\\b")) {
                rule.replace(safe, "[ĐÃ ẨN]")
            } else {
                rule.replace(safe, "$1[ĐÃ ẨN]")
            }
        }
        return safe
    }

    private fun load(context: Context) {
        if (loaded) return
        loaded = true
        try {
            val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(SAVED, "[]") ?: "[]"
            val arr = JSONArray(saved)
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                entries.addLast(item)
            }
        } catch (_: Exception) {
            entries.clear()
        }
    }

    @Synchronized
    fun record(context: Context, level: String, source: String, message: String, location: String = "") {
        load(context.applicationContext)
        val safeLevel = when (level.lowercase()) {
            "error", "warn", "info", "log", "debug" -> level.lowercase()
            else -> "info"
        }
        val item = JSONObject()
            .put("timestamp", System.currentTimeMillis())
            .put("level", safeLevel)
            .put("source", sanitized(source).take(45))
            .put("message", sanitized(message))
            .put("location", sanitized(location).take(240))
        entries.addLast(item)
        while (entries.size > MEMORY_LIMIT) entries.removeFirst()
        if (safeLevel == "error" || safeLevel == "warn") {
            try {
                val persistent = JSONArray()
                entries.filter { it.optString("level") in listOf("error", "warn") }
                    .takeLast(PERSISTED_LIMIT)
                    .forEach(persistent::put)
                context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(SAVED, persistent.toString()).apply()
            } catch (_: Exception) {
                // Logging must never interrupt SillyTavern.
            }
        }
    }

    @Synchronized
    fun snapshot(context: Context): String {
        load(context.applicationContext)
        val arr = JSONArray()
        entries.forEach(arr::put)
        return arr.toString()
    }

    @Synchronized
    fun clear(context: Context) {
        entries.clear()
        loaded = true
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(SAVED).apply()
    }
}

/** Read-only diagnostics + explicit "clear" operation. No file/network access. */
class AndroidDiagnosticsBridge(context: Context) {
    private val app = context.applicationContext

    @JavascriptInterface
    fun getLogs(): String = DiagnosticStore.snapshot(app)

    @JavascriptInterface
    fun clearLogs() = DiagnosticStore.clear(app)

    @JavascriptInterface
    fun getVersion(): String {
        return try {
            app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "unknown"
        } catch (_: Exception) {
            "unknown"
        }
    }
}
