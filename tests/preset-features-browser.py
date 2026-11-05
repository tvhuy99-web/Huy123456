#!/usr/bin/env python3
"""Regression for native preset Extensions JSON, Logit Bias and prompt preview."""
import re
import shutil
from pathlib import Path
from zipfile import ZipFile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
bundle = root / 'app/src/main/assets/sillytavern.zip'
source = (root / 'app/src/main/assets/st-preset-studio.js').read_text(encoding='utf-8')
features = (root / 'app/src/main/assets/st-preset-features.js').read_text(encoding='utf-8')
css = (root / 'app/src/main/assets/st-preset-studio.css').read_text(encoding='utf-8')
with ZipFile(bundle) as z:
    bridge = z.read('public/scripts/openai.js').decode('utf-8')
    assert bridge.count('// ST_ANDROID_PRESET_EXTENSIONS_BRIDGE_V1') == 1
    assert 'await saveOpenAIPreset(name, oai_settings, false)' in bridge
    html = z.read('public/index.html').decode('utf-8')
    html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.I | re.S)
    html = re.sub(r'<link\b[^>]*>', '', html, flags=re.I | re.S)
    original_css = [z.read(p).decode('utf-8', errors='replace') for p in (
        'public/css/bright.min.css', 'public/style.css',
        'public/css/st-tailwind.css', 'public/css/mobile-styles.css'
    )]
source = source.replace('import(moduleUrl).then(module => {',
                        'Promise.resolve(window.__nativeAPI).then(module => {')
features = features.replace('import(bridgeUrl)', 'Promise.resolve(window.__nativeAPI)')
both = [source, features]
both = [s.replace("new URL('scripts/openai.js', document.baseURI).href",
                  "'http://127.0.0.1:8001/scripts/openai.js'") for s in both]
chrome = next((shutil.which(name) for name in
               ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser')
               if shutil.which(name)), None)
assert chrome, 'Chromium not installed'
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.set_content(html)
    for stylesheet in original_css:
        page.add_style_tag(content=stylesheet)
    page.add_style_tag(content=css)
    page.add_style_tag(content='''#left-nav-panel{display:block!important;transform:none!important;position:relative!important;width:390px!important;height:auto!important} .scrollableInner{height:auto!important;max-height:none!important;overflow:visible!important}''')
    page.evaluate("""() => {
        document.getElementById('main_api').value='openai';
        const pm={
            activeCharacter:{id:100001},
            serviceSettings:{prompts:[{identifier:'main',name:'Main',content:'Xin chào {{char}}',system_prompt:true}],prompt_order:[{character_id:100001,order:[{identifier:'main',enabled:true}]}]},
            getPromptOrderForCharacter(){return this.serviceSettings.prompt_order[0].order},
            getPromptById(id){return this.serviceSettings.prompts.find(x=>x.identifier===id)},
            isPromptToggleAllowed(){return true},isPromptEditAllowed(){return true},isPromptDeletionAllowed(){return true},
            render(){document.getElementById('completion_prompt_manager').innerHTML='<div class="completion_prompt_manager_prompt" data-pm-identifier="main"></div>'},
            saveServiceSettings(){},
            async tryGenerate(){
                this.messages={getCollection(){return [
                    {getCollection(){return [{role:'system',content:'Bạn là Alice.'},{role:'user',content:'Chào Alice!'}]}},
                    {getCollection(){return [{role:'assistant',content:[{type:'text',text:'Chào bạn.'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,abc'}}]}]}},
                    {getCollection(){return []}}
                ]}};
            }
        };
        pm.render();
        window.__extensions={foo:{a:1}};
        window.__nativeAPI={promptManager:pm,
            async stAndroidGetPresetExtensions(){return structuredClone(window.__extensions)},
            async stAndroidSavePresetExtensions(value){window.__extensions=structuredClone(value)}};
    }""")
    page.evaluate(both[0])
    page.evaluate(both[1])
    page.wait_for_timeout(120)
    assert page.locator('#st-ps-logit-bias').count() == 1
    assert page.locator('#st-ps-extensions').count() == 1
    assert page.locator('#openai_logit_bias_new_preset').get_attribute('aria-label') == 'Tạo bộ Logit Bias'
    assert page.locator('#st-ps-config-panel details.st-ps-group').count() == 8
    page.locator('#st-ps-extensions').evaluate('x => {x.parentElement.open=true;x.open=true}')
    page.get_by_text('Chỉnh sửa JSON').click()
    field = page.get_by_role('dialog').locator('textarea')
    assert '"foo"' in field.input_value()
    field.fill('{bad')
    page.get_by_role('dialog').get_by_text('Lưu', exact=True).click()
    assert 'không hợp lệ' in page.get_by_role('dialog').get_by_role('alert').inner_text()
    assert page.evaluate('window.__extensions.foo.a') == 1
    field.fill('{"extra":7}')
    page.get_by_role('dialog').get_by_text('Lưu', exact=True).click()
    page.wait_for_timeout(80)
    assert page.evaluate('window.__extensions.extra') == 7
    assert page.get_by_role('dialog').count() == 0
    page.locator('#st-ps-prompts-tab').click()
    page.locator('#st-ps-preview').click()
    body = page.get_by_role('dialog').inner_text()
    assert all(s in body for s in ('Hệ thống', 'Bạn là Alice.', 'Người dùng', 'Chào Alice!', 'Trợ lý', '[Hình ảnh]'))
    assert '\nsystem\n\n' not in body
    assert page.locator('.st-ps-preview-message').count() == 3
    assert page.locator('.st-ps-preview-message h4').count() == 3
    page.get_by_role('dialog').get_by_text('Đóng').click()
    # Regression for a 38-prompt ruleset: 38 native messages must produce
    # exactly 38 sections/headings, NEVER one section per paragraph or group.
    page.evaluate("""() => {
        const pm=window.__nativeAPI.promptManager;
        pm.tryGenerate=async function() {
            const messages=Array.from({length:38},(_,i)=>({
                identifier:'rule-'+(i+1),role:'system',
                content:'Quy tắc '+(i+1)+': '+('Nội dung dài. '.repeat(90))
            }));
            this.messages={
                identifier:'root',
                getCollection(){return [
                    {identifier:'ruleset',getCollection(){return messages.slice(0,19)}},
                    {identifier:'ruleset-continued',getCollection(){return [
                        {identifier:'nested',getCollection(){return messages.slice(19)}}
                    ]}}
                ]};
            };
        };
    }""")
    page.locator('#st-ps-preview').click()
    assert page.locator('.st-ps-preview-message').count() == 38
    assert page.locator('.st-ps-preview-message h4').count() == 38
    assert page.locator('.st-ps-preview-group').count() == 0
    assert page.locator('.st-ps-preview-part').count() == 0
    assert page.locator('.st-ps-preview-message').first.locator('pre').count() == 1
    assert 'Quy tắc 38:' in page.locator('.st-ps-preview-message').last.inner_text()
    assert len(page.locator('.st-ps-preview-message').last.locator('pre').inner_text()) > 1000
    page.get_by_role('dialog').get_by_text('Đóng').click()
    assert 'Chỉ áp dụng cho những kiểu tạo phản hồi được chọn.' in page.locator('#completion_prompt_manager_popup').inner_text()
    assert 'Đặt tương đối so với các lời nhắc khác' in page.locator('#completion_prompt_manager_popup').inner_text()
    assert not errors, errors
    print('Native Preset extensions, Logit Bias, preview and Vietnamese notes: PASS')
    browser.close()
