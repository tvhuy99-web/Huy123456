#!/usr/bin/env python3
"""Android native fallback for the built-in SillyTavern 1.19.0 System TTS.

Leave Web Speech behaviour unchanged on browsers that support it.
Native engine and voice selection are owned by the Android app.
"""
from pathlib import Path
import sys

MARKER = "// ST_ANDROID_NATIVE_TTS_FALLBACK_V1"

def replace_once(source: str, before: str, after: str) -> str:
    n = source.count(before)
    if n != 1:
        raise RuntimeError(f"Unexpected official ST 1.19.0 TTS source ({n} anchors): {before[:95]}")
    return source.replace(before, after, 1)

def apply(root: Path) -> None:
    provider = root / "public/scripts/extensions/tts/system.js"
    source = provider.read_text(encoding="utf-8")
    if MARKER not in source:
        helper = r"""
// ST_ANDROID_NATIVE_TTS_FALLBACK_V1
// Android TextToSpeech fallback based on the NgheTruyen-Kotlin native engine.
const __stAndroidTts = typeof window.STAndroidTTS !== 'undefined'
    && (typeof window.SpeechSynthesisUtterance !== 'function'
        || !('speechSynthesis' in window))
    ? window.STAndroidTTS : null;
const __stAndroidTtsPending = new Map();
if (__stAndroidTts) {
    window.__stAndroidTtsComplete = function(id, success, reason) {
        const pending = __stAndroidTtsPending.get(id);
        if (!pending) return;
        __stAndroidTtsPending.delete(id);
        clearTimeout(pending.timer);
        if (success) pending.resolve();
        else pending.reject(new Error(String(reason || 'Android TTS không đọc được')));
    };
}
function __stAndroidVoices() {
    try {
        const voices = JSON.parse(__stAndroidTts?.getVoices?.() || '[]');
        return Array.isArray(voices) ? voices : [];
    } catch (_) {
        return [];
    }
}
async function __stAndroidSpeak(text, voice, rate = 1, pitch = 1) {
    if (!__stAndroidTts) throw new Error('Không có bộ máy TTS Android');
    if (__stAndroidTts.getStatus() === 'error') {
        throw new Error('Bộ máy TTS của Android chưa được cài đặt hoặc không hoạt động');
    }
    const content = String(text || '');
    let remaining = content;
    let count = 0;
    while (remaining.length) {
        if (++count > 300) throw new Error('Văn bản TTS quá dài');
        let length = Math.min(1500, remaining.length);
        if (length < remaining.length) {
            const space = remaining.lastIndexOf(' ', length);
            if (space >= 400) length = space + 1;
        }
        const part = remaining.slice(0, length);
        remaining = remaining.slice(length);
        if (!part.trim()) continue;
        await new Promise((resolve, reject) => {
            const id = 'st-native-tts-' + Date.now().toString(36) +
                '-' + Math.random().toString(36).slice(2, 10);
            const timer = setTimeout(() => {
                __stAndroidTtsPending.delete(id);
                try { __stAndroidTts.cancel(); } catch (_) {}
                reject(new Error('Android TTS không phản hồi trong thời gian cho phép'));
            }, 180000);
            __stAndroidTtsPending.set(id, { resolve, reject, timer });
            try {
                __stAndroidTts.speak(
                    id, part, String(voice || '__browser_default__'),
                    navigator.language || 'vi-VN',
                    Number(rate) || 1, Number(pitch) || 1, 1.0
                );
            } catch (error) {
                clearTimeout(timer);
                __stAndroidTtsPending.delete(id);
                reject(error);
            }
        });
    }
}
"""
        source = replace_once(source,
            "import { t } from '../../i18n.js';\n",
            "import { t } from '../../i18n.js';\n" + helper)
        source = replace_once(source,
            """    get settingsHtml() {
        if (!('speechSynthesis' in window)) {""",
            """    get settingsHtml() {
        if (!__stAndroidTts && !('speechSynthesis' in window)) {""")
        source = replace_once(source,
            "        if (isMobile()) {\n            let hasEnabledVoice = false;",
            "        if (isMobile() && !__stAndroidTts && typeof SpeechSynthesisUtterance === 'function') {\n            let hasEnabledVoice = false;")
        source = replace_once(source,
            """    fetchTtsVoiceObjects() {
        if (!('speechSynthesis' in window)) {""",
            """    fetchTtsVoiceObjects() {
        if (__stAndroidTts) {
            const voices = __stAndroidVoices();
            if (!voices.length) {
                return Promise.resolve([{
                    name: SystemTtsProvider.BROWSER_DEFAULT_VOICE_NAME,
                    voice_id: SystemTtsProvider.BROWSER_DEFAULT_VOICE_ID,
                    preview_url: false, lang: navigator.language || 'vi-VN',
                }]);
            }
            return Promise.resolve(voices.map(voice => ({
                name: voice.name, voice_id: voice.voiceURI,
                preview_url: false, lang: voice.lang,
            })));
        }
        if (!('speechSynthesis' in window)) {""")
        source = replace_once(source,
            """    previewTtsVoice(voiceId) {
        if (!('speechSynthesis' in window)) {""",
            """    previewTtsVoice(voiceId) {
        if (__stAndroidTts) {
            const voice = __stAndroidVoices().find(x => x.voiceURI === voiceId);
            const preview = getPreviewString(voice?.lang || navigator.language || 'vi-VN');
            __stAndroidTts.cancel();
            __stAndroidSpeak(preview, voiceId, this.settings.rate || 1,
                this.settings.pitch || 1)
                .catch(error => console.error('Android SystemTTS Preview:', error));
            return;
        }
        if (!('speechSynthesis' in window)) {""")
        source = replace_once(source,
            """    async getVoice(voiceName) {
        if (!('speechSynthesis' in window)) {""",
            """    async getVoice(voiceName) {
        if (__stAndroidTts) {
            if (voiceName === SystemTtsProvider.BROWSER_DEFAULT_VOICE_NAME) {
                return { voice_id: SystemTtsProvider.BROWSER_DEFAULT_VOICE_ID, name: voiceName };
            }
            const voice = __stAndroidVoices().find(x => x.name === voiceName);
            if (voice) return { voice_id: voice.voiceURI, name: voice.name };
            console.warn('Android SystemTTS: giọng đã chọn không còn khả dụng, dùng giọng mặc định');
            return {
                voice_id: SystemTtsProvider.BROWSER_DEFAULT_VOICE_ID,
                name: SystemTtsProvider.BROWSER_DEFAULT_VOICE_NAME,
            };
        }
        if (!('speechSynthesis' in window)) {""")
        source = replace_once(source,
            """    async generateTts(text, voiceId) {
        if (!('speechSynthesis' in window)) {""",
            """    async generateTts(text, voiceId) {
        if (__stAndroidTts) {
            await __stAndroidSpeak(text, voiceId, this.settings.rate || 1,
                this.settings.pitch || 1);
            return fetch('/sounds/silence.mp3');
        }
        if (!('speechSynthesis' in window)) {""")
        provider.write_text(source, encoding="utf-8")
        print("Patched Android System TTS fallback")

    script = root / "public/script.js"
    text = script.read_text(encoding="utf-8")
    marker = "// ST_ANDROID_NATIVE_TTS_CANCEL_V1"
    if marker not in text:
        text = replace_once(text,
            """export function cancelTtsPlay() {
    if ('speechSynthesis' in window) {""",
            """export function cancelTtsPlay() {
    // ST_ANDROID_NATIVE_TTS_CANCEL_V1
    if (window.STAndroidTTS &&
        (typeof window.SpeechSynthesisUtterance !== 'function' ||
         !('speechSynthesis' in window))) {
        try { window.STAndroidTTS.cancel(); } catch (_) {}
    }
    if ('speechSynthesis' in window) {""")
        script.write_text(text, encoding="utf-8")
        print("Patched Android System TTS cancel")
if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: patch_android_tts.py <SillyTavern-root>")
    apply(Path(sys.argv[1]).resolve())
