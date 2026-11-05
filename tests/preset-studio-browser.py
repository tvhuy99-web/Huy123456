#!/usr/bin/env python3
"""Browser regression using the actual bundled SillyTavern 1.19.0 HTML/CSS."""
import re
import shutil
from pathlib import Path
from zipfile import ZipFile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
bundle = root / 'app/src/main/assets/sillytavern.zip'
source = (root / 'app/src/main/assets/st-preset-studio.js').read_text(encoding='utf-8')
style = (root / 'app/src/main/assets/st-preset-studio.css').read_text(encoding='utf-8')
assert source.index('area.prepend(ui)') < source.index('import(moduleUrl)'), 'Studio must mount before module import'
assert 'st-ps-config-panel' in source and '#st-preset-studio' in style
with ZipFile(bundle) as archive:
    html = archive.read('public/index.html').decode('utf-8')
    html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.I | re.S)
    html = re.sub(r'<link\b[^>]*>', '', html, flags=re.I | re.S)
    original_css = [archive.read(p).decode('utf-8', errors='replace') for p in (
        'public/css/bright.min.css', 'public/style.css',
        'public/css/st-tailwind.css', 'public/css/mobile-styles.css'
    )]
# Replacing only the module loader lets us exercise the original DOM, CSS,
# and unmodified UI behavior without starting the full Node.js server.
source = source.replace('import(moduleUrl).then(module => {',
                        'Promise.resolve({promptManager: window.__nativePM}).then(module => {')
source = source.replace("new URL('scripts/openai.js', document.baseURI).href",
                        "'http://127.0.0.1:8001/scripts/openai.js'")
chrome = next((name for name in ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser')
               if shutil.which(name)), None)
if not chrome:
    raise RuntimeError('Google Chrome/Chromium is required for the Preset Studio browser regression')

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which(chrome),
                                         headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(html)
    for item in original_css:
        page.add_style_tag(content=item)
    page.add_style_tag(content=style)
    page.evaluate("""() => {
        document.getElementById('left-nav-panel').style.display='block';
        document.getElementById('main_api').value='textgenerationwebui';
        document.getElementById('settings_preset_openai')
            .insertAdjacentHTML('beforeend','<option value="extra">Preset thử</option>');
        window.__nativePM = {
          activeCharacter:{id:100001},
          serviceSettings:{prompts:[
            {identifier:'main', name:'Main Prompt', content:'Dòng đầu\\n\\nDòng cuối',system_prompt:true},
            {identifier:'custom', name:'Lời nhắc thứ hai',content:'Nội dung không cắt',system_prompt:false}
          ],prompt_order:[{character_id:100001,order:[
            {identifier:'main',enabled:true},{identifier:'custom',enabled:false}
          ]}]},
          getPromptOrderForCharacter(){return this.serviceSettings.prompt_order[0].order},
          getPromptById(id){return this.serviceSettings.prompts.find(p=>p.identifier===id)},
          isPromptEditAllowed(){return true},isPromptToggleAllowed(){return true},
          isPromptDeletionAllowed(p){return !p.system_prompt},
          handleEdit(ev){window.__edited=ev.target.dataset.pmIdentifier},
          handleToggle(ev){const id=ev.target.dataset.pmIdentifier;
            const row=this.getPromptOrderForCharacter().find(p=>p.identifier===id);
            row.enabled=!row.enabled; this.render()},
          render(){document.getElementById('completion_prompt_manager').innerHTML=
            this.getPromptOrderForCharacter().map(x=>
              '<div class="completion_prompt_manager_prompt" data-pm-identifier="'+x.identifier+'"></div>').join('')},
          saveServiceSettings(){return Promise.resolve()},
          tryGenerate(){this.messages={getCollection:()=>[
            {role:'system',content:'Bản xem trước từ SillyTavern'}]};return Promise.resolve()}
        };
        window.__nativePM.render();
    }""")
    page.evaluate(source)
    # Regression for the reported Android issue: the API is restored after
    # onPageFinished by assigning .value without dispatching a DOM event.
    assert not page.locator('#st-preset-studio').is_visible()
    page.locator('#main_api').evaluate("node => node.value = 'openai'")
    page.wait_for_timeout(850)
    assert page.locator('#st-preset-studio').is_visible(), 'Preset UI is not visible'
    assert page.locator('#st-ps-config-panel details.st-ps-group').count() == 6, 'Six configuration sections, no duplicate advanced'
    assert not page.locator('#openai_api-presets').is_visible(), 'Legacy preset heading must be hidden'
    assert page.locator('#st-ps-config-panel #range_block_openai').count() == 1
    assert page.locator('#st-ps-config-panel #openai_settings').count() == 1
    assert page.eval_on_selector_all(
        '#ai_response_configuration > :not(#st-preset-studio)',
        "xs=>xs.every(x=>getComputedStyle(x).display==='none')"), 'Legacy UI still visible'
    assert page.get_by_role('tab').all_inner_texts() == ['Cấu hình','Lời nhắc']
    page.locator('#st-ps-prompts-tab').click()
    assert page.locator('.st-ps-prompt').count() == 2
    assert page.get_by_role('heading', name='Main Prompt').count() == 1
    assert page.get_by_role('heading', name='Lời nhắc thứ hai').count() == 1
    assert page.locator('.st-ps-heading h3[role="presentation"]').count() == 0
    assert page.locator('.st-ps-switch[role="checkbox"]').count() == 2
    assert page.locator('.st-ps-switch').first.get_attribute('aria-label') is None
    assert page.locator('.st-ps-switch').nth(0).get_attribute('aria-checked') == 'true'
    assert page.locator('.st-ps-switch').nth(1).get_attribute('aria-checked') == 'false'
    assert page.locator('.st-ps-content').first.inner_text() == 'Dòng đầu\n\nDòng cuối'
    page.locator('.st-ps-title').first.click()
    assert page.evaluate('window.__edited') == 'main'
    page.locator('.st-ps-title').first.dispatch_event('contextmenu')
    assert 'Chọn để di chuyển' in page.get_by_role('dialog').inner_text()
    page.get_by_role('dialog').get_by_text('Đóng').click()
    page.locator('#st-ps-preview').click()
    assert 'Bản xem trước từ SillyTavern' in page.get_by_role('dialog').inner_text()
    page.get_by_role('dialog').get_by_text('Đóng').click()
    page.locator('#main_api').evaluate(
        """x=>{x.value='novel';x.dispatchEvent(new Event('change',{bubbles:true}))}""")
    page.wait_for_timeout(40)
    assert not page.locator('#st-preset-studio').is_visible(), 'Studio must hide for other APIs'
    assert page.locator('#range_block_openai').evaluate(
        'x=>!x.closest("#st-ps-config-panel")'), 'Original form not restored'
    page.locator('#main_api').evaluate(
        """x=>{x.value='openai';x.dispatchEvent(new Event('change',{bubbles:true}))}""")
    page.wait_for_timeout(40)
    assert page.locator('#st-preset-studio').is_visible(), 'Cannot reopen the Studio UI'
    assert not errors, errors
    print('Preset Studio actual SillyTavern DOM/CSS browser integration: PASS')
    browser.close()
