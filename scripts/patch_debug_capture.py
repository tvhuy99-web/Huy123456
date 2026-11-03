#!/usr/bin/env python3
"""Instrument official SillyTavern 1.19.0 Chat Completion without changing its data.

After extension settings hooks, record the final fetch request; raw streaming
chunks and non-streaming responses are captured for a private in-memory
diagnostic panel, not sent to Android persistence.
"""
from pathlib import Path
import sys

MARKER = "// ST_ANDROID_DEBUG_SEND_HOOK_V1"

def replace_once(source: str, before: str, after: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Unexpected SillyTavern source: found {count} anchors: {before[:100]}")
    return source.replace(before, after, 1)

def apply(root: Path) -> None:
    file = root / "public" / "scripts" / "openai.js"
    text = file.read_text(encoding="utf-8")
    if MARKER in text:
        return
    text = replace_once(text,
        """    await eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, generate_data);

    const generate_url = '/api/backends/chat-completions/generate';
    const response = await fetch(generate_url, {""",
        """    await eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, generate_data);

    // ST_ANDROID_DEBUG_SEND_HOOK_V1
    // Failure in diagnostics must never change the native generation.
    const __stDebugId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    const __stDebug = (kind, detail = {}) => {
        try { window.__stDebugCapture?.(kind, { id: __stDebugId, ...detail }); } catch (_) {}
    };
    __stDebug('request', {
        messages: generate_data.messages, stop: generate_data.stop, model: generate_data.model,
        source: generate_data.chat_completion_source, type, stream
    });

    const generate_url = '/api/backends/chat-completions/generate';
    let response;
    try {
        response = await fetch(generate_url, {""")
    text = replace_once(text,
        """        headers: getRequestHeaders(),
        signal: signal,
    });

    if (!response.ok) {""",
        """        headers: getRequestHeaders(),
        signal: signal,
        });
    } catch (error) {
        __stDebug('failure', { message: String(error?.message || error), status: 0 });
        throw error;
    }

    if (!response.ok) {
        // Inspect a clone; native error handling still consumes its own body.
        if (typeof window.__stDebugCapture === 'function') {
            try {
                __stDebug('failure', { status: response.status, raw: await response.clone().text() });
            } catch (_) {}
        }""")
    text = replace_once(text,
        """                const { done, value } = await reader.read();
                if (done) return;
                const rawData = value.data;
                if (rawData === '[DONE]') return;
                tryParseStreamingError(response, rawData);""",
        """                let chunkResult;
                try {
                    chunkResult = await reader.read();
                } catch (error) {
                    __stDebug('failure', { message: String(error?.message || error), status: response.status });
                    throw error;
                }
                const { done, value } = chunkResult;
                if (done) {
                    __stDebug('complete', { status: response.status });
                    return;
                }
                const rawData = value.data;
                if (rawData === '[DONE]') {
                    __stDebug('complete', { status: response.status });
                    return;
                }
                __stDebug('chunk', { raw: rawData, status: response.status });
                tryParseStreamingError(response, rawData);""")
    text = replace_once(text,
        """    } else {
        const data = await response.json();

        checkQuotaError(data);""",
        """    } else {
        // Clone only for diagnostics. Native response.json remains unchanged.
        const __stResponseCopy = typeof window.__stDebugCapture === 'function'
            ? response.clone() : null;
        const data = await response.json();
        if (__stResponseCopy) {
            try {
                __stDebug('response', { raw: await __stResponseCopy.text(), status: response.status });
            } catch (_) {}
        }

        checkQuotaError(data);""")
    file.write_text(text, encoding="utf-8")
    print("Official SillyTavern 1.19.0 Chat Completion debug hooks applied")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: patch_debug_capture.py <SillyTavern-root>")
    apply(Path(sys.argv[1]).resolve())
