#!/usr/bin/env python3
"""Idempotent APK-only adapter to original SillyTavern 1.19.0 preset code.

The adapter exposes the original saveOpenAIPreset function without changing
the native preset schema. It also fills missing Vietnamese translation keys.
"""
import json
import sys
from pathlib import Path

MARKER = '// ST_ANDROID_PRESET_EXTENSIONS_BRIDGE_V1'
BRIDGE = r'''

// ST_ANDROID_PRESET_EXTENSIONS_BRIDGE_V1
// Expose extensions on the active native Preset, using the native save path.
export async function stAndroidGetPresetExtensions() {
    await getPresetApplicationPromise();
    return structuredClone(oai_settings.extensions || {});
}

export async function stAndroidSavePresetExtensions(extensions) {
    await getPresetApplicationPromise();
    if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) {
        throw new TypeError('Extensions JSON must be an object');
    }
    const name = oai_settings.preset_settings_openai;
    if (!name) throw new Error('No Chat Completion preset selected');
    const previous = structuredClone(oai_settings.extensions || {});
    oai_settings.extensions = structuredClone(extensions);
    try {
        await saveOpenAIPreset(name, oai_settings, false);
        saveSettingsDebounced();
    } catch (error) {
        oai_settings.extensions = previous;
        throw error;
    }
}
'''
VIETNAMESE = {
    'Filter to specific generation types.': 'Chỉ áp dụng cho những kiểu tạo phản hồi được chọn.',
    'Relative (to other prompts in prompt manager) or In-chat @ Depth.':
        'Đặt tương đối so với các lời nhắc khác hoặc chèn vào cuộc trò chuyện tại độ sâu đã chọn.',
    '0 = after the last message, 1 = before the last message, etc.':
        '0 = sau tin nhắn cuối, 1 = trước tin nhắn cuối, v.v.',
    'A name for this prompt.': 'Tên của lời nhắc.',
    'To whom this message will be attributed.': 'Vai trò của thông điệp này.',
    'The list of prompts associated with this marker.': 'Các lời nhắc thuộc mục đánh dấu này.',
    'Ordered from low/top to high/bottom, and at same order: Assistant, User, System.':
        'Sắp xếp theo thứ tự tăng dần; nếu bằng nhau: Trợ lý, Người dùng, Hệ thống.',
    "Prompt injections from other sources (World Info, Author's Note, etc.) always have a default order of 100.":
        'Lời nhắc từ nguồn khác (World Info, Ghi chú tác giả, v.v.) mặc định có thứ tự 100.',
    'Generation Type': 'Kiểu tạo phản hồi',
    'Triggers': 'Điều kiện kích hoạt',
    'In-chat': 'Trong cuộc trò chuyện',
    'Relative': 'Tương đối',
    'Position': 'Vị trí',
    'Order': 'Thứ tự',
}

def apply(root: Path) -> None:
    module_path = root / 'public' / 'scripts' / 'openai.js'
    if not module_path.is_file():
        raise RuntimeError(f'Missing SillyTavern module: {module_path}')
    original = module_path.read_text(encoding='utf-8')
    if MARKER not in original:
        required = (
            'export function getChatCompletionPreset(settings = oai_settings)',
            'async function saveOpenAIPreset(name, settings, triggerUi = true)',
            'export function getPresetApplicationPromise()',
            'extensions: {}',
        )
        for anchor in required:
            if anchor not in original:
                raise RuntimeError(f'Unsupported SillyTavern source: missing {anchor}')
        module_path.write_text(original + BRIDGE, encoding='utf-8')
    locale = root / 'public' / 'locales' / 'vi-vn.json'
    if locale.is_file():
        data = json.loads(locale.read_text(encoding='utf-8'))
        for key, value in VIETNAMESE.items():
            data.setdefault(key, value)
        locale.write_text(json.dumps(data, ensure_ascii=False, indent=4) + '\n', encoding='utf-8')
    print('Native extensions JSON adapter and Vietnamese translations prepared')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: patch_preset_bridge.py <SillyTavern-root>')
    apply(Path(sys.argv[1]).resolve())
