import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../app/src/main/assets/st-preset-studio.js',import.meta.url),'utf8');
const css = readFileSync(new URL('../app/src/main/assets/st-preset-studio.css',import.meta.url),'utf8');
const main = readFileSync(new URL('../app/src/main/kotlin/com/jiuguan/sillytavern/MainActivity.kt',import.meta.url),'utf8');
const required = ['settings_preset_openai','main_api','completion_prompt_manager',
  'range_block_openai','st-ps-select','st-ps-filter','st-ps-config-tab',
  'st-ps-prompts-tab','st-ps-preview','Thông số cơ bản','Độ dài phản hồi',
  'Sampling nâng cao','Điều khiển tạo văn bản','Reasoning',
  'Cấu hình nâng cao','Chọn để di chuyển','Đã bật','Đã tắt','Tất cả'];
for (const key of required) assert.ok(source.includes(key),'Missing '+key);
const nativeMethods = ['pm.getPromptById','pm.handleToggle','pm.handleEdit',
  'pm.saveServiceSettings','pm.tryGenerate','pm.getPromptOrderForCharacter'];
for (const key of nativeMethods) {
  assert.ok(source.includes(key) || (key==='pm.getPromptOrderForCharacter' &&
    source.includes('pm?.activeCharacter ? pm.getPromptOrderForCharacter')),
    'Must use native PromptManager: '+key);
}
assert.match(css,/white-space:\s*pre-wrap/);
assert.ok(source.includes("make('div',p.content || '','st-ps-content')"),
  'Prompt content cannot be truncated');
assert.doesNotMatch(source,/indexedDB|localStorage|\/api\/presets/,
  'Do not create a parallel preset database');
assert.ok(source.includes("on && tab === 'prompts'"),
  'Switching away from Chat Completion cannot hide other APIs');
assert.match(main,/injectPresetStudio\(view\)/);
assert.match(main,/assets\.open\("st-preset-studio\.js"\)/);
assert.match(main,/assets\.open\("st-preset-studio\.css"\)/);
console.log('Preset Studio static smoke test: OK');
