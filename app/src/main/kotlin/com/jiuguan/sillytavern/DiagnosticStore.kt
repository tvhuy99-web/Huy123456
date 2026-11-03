package com.jiuguan.sillytavern

import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque

/**
 * Canonical diagnostic ring for the Android APK.
 *
 * Maximum rendered JSON is below 200,000 UTF-16 characters, including
 * metadata and serialisation. Normal messages cannot evict critical errors.
 * Only errors/warnings are persisted between app launches.
 * Prompts and raw AI responses are intentionally never stored here.
 */
object DiagnosticStore {
    private const val PREFS = "st_android_diagnostics_v1"
    private const val SAVED = "recent_errors"

    // Reserve headroom for JSON delimiters and keep the total below 200k.
    private const val NORMAL_BUDGET = 159_900
    private const val IMPORTANT_BUDGET = 39_900
    private const val MAX_SNAPSHOT = 200_000
    private const val MAX_ITEM_TEXT = 12_000
    private const val COALESCE_WINDOW_MS = 5 * 60 * 1000L

    private val normal = ArrayDeque<JSONObject>()
    private val important = ArrayDeque<JSONObject>()
    private var normalChars = 0
    private var importantChars = 0
    private var loaded = false

    private val redactions = listOf(
        Regex("(?i)(authorization\\s*[:=]\\s*bearer\\s+)[^\\s,\"'}]+"),
        Regex("(?i)([?&](?:api_key|apikey|token|key|secret|password)=)[^&#\\s]+"),
        Regex("(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\\s*[:=]\\s*['\\\"]?)[^\\s,\"'}]+"),
        Regex("(?i)\\b(?:sk|rk|sess)-[A-Za-z0-9_-]{12,}\\b")
    )
    private fun sanitized(raw: String, limit: Int = MAX_ITEM_TEXT): String {
        var safe = raw.take(limit).replace('\u0000', ' ')
        for (rule in redactions) {
            safe = if (rule.pattern.startsWith("(?i)\\b")) {
                rule.replace(safe, "[ĐÃ ẨN]")
            } else {
                rule.replace(safe, "$1[ĐÃ ẨN]")
            }
        }
        return safe
    }

    private fun cost(item: JSONObject): Int = item.toString().length + 1

    private fun trim(queue: ArrayDeque<JSONObject>, importantLane: Boolean) {
        val budget = if (importantLane) IMPORTANT_BUDGET else NORMAL_BUDGET
        var used = if (importantLane) importantChars else normalChars
        while (used > budget && queue.isNotEmpty()) {
            used -= cost(queue.removeFirst())
        }
        if (importantLane) importantChars = used else normalChars = used
    }

    private fun load(context: Context) {
        if (loaded) return
        loaded = true
        try {
            val previous = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(SAVED, "[]") ?: "[]"
            val list = JSONArray(previous)
            for (i in 0 until list.length()) {
                val item = list.optJSONObject(i) ?: continue
                if (item.optString("level") !in listOf("error", "warn")) continue
                important.addLast(item)
                importantChars += cost(item)
                trim(important, true)
            }
        } catch (_: Exception) {
            important.clear()
            importantChars = 0
        }
    }

    private fun saveImportant(context: Context) {
        try {
            val snapshot = JSONArray()
            important.forEach { snapshot.put(it) }
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(SAVED, snapshot.toString()).apply()
        } catch (_: Exception) {
            // Logging must never interrupt the application.
        }
    }

    @Synchronized
    fun record(
        context: Context,
        level: String,
        source: String,
        message: String,
        location: String = "",
        details: JSONObject? = null
    ) {
        try {
            load(context.applicationContext)
            val safeLevel = level.lowercase().takeIf {
                it in setOf("error", "warn", "info", "log", "debug")
            } ?: "info"
            val isImportant = safeLevel == "error" || safeLevel == "warn"
            val queue = if (isImportant) important else normal
            val now = System.currentTimeMillis()
            val item = JSONObject()
                .put("timestamp", now)
                .put("firstTimestamp", now)
                .put("lastTimestamp", now)
                .put("repeatCount", 1)
                .put("level", safeLevel)
                .put("source", sanitized(source, 45))
                .put("message", sanitized(message))
                .put("location", sanitized(location, 1200))

            // Whitelist diagnostic fields. No arbitrary JS-provided JSON is saved.
            val allowed = listOf("url", "originalUrl", "resourceType", "element",
                "method", "httpStatus", "errorCode", "mainFrame", "stack")
            details?.let { meta ->
                for (key in allowed) {
                    if (meta.has(key) && !meta.isNull(key)) {
                        val value = meta.opt(key)
                        when {
                            value is Number || value is Boolean -> item.put(key, value)
                            value is String -> item.put(key,
                                sanitized(value, if (key == "stack") 7000 else 1800))
                        }
                    }
                }
            }

            // Same root cause reported every few seconds becomes a single
            // record with a counter and first/last occurrence timestamps.
            val signature = listOf("level", "source", "message", "location",
                "url", "originalUrl", "resourceType", "element", "method",
                "httpStatus", "errorCode", "mainFrame").joinToString("\u001f") {
                item.optString(it)
            }
            val iterator = queue.descendingIterator()
            var repeated: JSONObject? = null
            while (iterator.hasNext()) {
                val previous = iterator.next()
                if (now - previous.optLong("lastTimestamp", previous.optLong("timestamp")) > COALESCE_WINDOW_MS) {
                    break
                }
                val prevSignature = listOf("level", "source", "message", "location",
                    "url", "originalUrl", "resourceType", "element", "method",
                    "httpStatus", "errorCode", "mainFrame").joinToString("\u001f") {
                    previous.optString(it)
                }
                if (signature == prevSignature) {
                    repeated = previous
                    break
                }
            }

            if (repeated != null) {
                val oldCost = cost(repeated)
                repeated.put("repeatCount", repeated.optInt("repeatCount", 1) + 1)
                repeated.put("timestamp", now)
                repeated.put("lastTimestamp", now)
                val difference = cost(repeated) - oldCost
                if (isImportant) importantChars += difference else normalChars += difference
            } else {
                queue.addLast(item)
                if (isImportant) importantChars += cost(item) else normalChars += cost(item)
            }
            trim(queue, isImportant)
            if (isImportant) saveImportant(context)
        } catch (_: Exception) {
            // Diagnostics must never break the WebView or Node process.
        }
    }

    @Synchronized
    fun snapshot(context: Context): String {
        load(context.applicationContext)
        val result = JSONArray()
        (normal.toList() + important.toList())
            .sortedBy { it.optLong("lastTimestamp", it.optLong("timestamp")) }
            .forEach { result.put(it) }
        val json = result.toString()
        // Defensive invariant, never silently expose an unbounded collection.
        return if (json.length <= MAX_SNAPSHOT) json else "[]"
    }

    @Synchronized
    fun clear(context: Context) {
        normal.clear()
        important.clear()
        normalChars = 0
        importantChars = 0
        loaded = true
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(SAVED).apply()
    }
}

/** Diagnostics bridge: bounded writer, read-only snapshot, explicit clear. */
class AndroidDiagnosticsBridge(context: Context) {
    private val app = context.applicationContext

    @JavascriptInterface
    fun getLogs(): String = DiagnosticStore.snapshot(app)

    @JavascriptInterface
    fun clearLogs() = DiagnosticStore.clear(app)

    @JavascriptInterface
    fun recordClientEvent(
        level: String, source: String, message: String, location: String, details: String
    ) {
        // JS cannot write files or request network access through this bridge.
        val parsed = try { JSONObject(details.take(12000)) } catch (_: Exception) { null }
        DiagnosticStore.record(app, level, source.take(50),
            message.take(12000), location.take(1200), parsed)
    }

    @JavascriptInterface
    fun getVersion(): String {
        return try {
            app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "unknown"
        } catch (_: Exception) {
            "unknown"
        }
    }
}
