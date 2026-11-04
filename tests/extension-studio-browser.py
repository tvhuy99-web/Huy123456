#!/usr/bin/env python3
"""Deferred browser coverage for the native-backed Extension Studio.

Do not run during feature development; execute at the agreed final QA stage.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'app/src/main/assets/st-extension-studio.js').read_text(encoding='utf-8')
css=(ROOT/'app/src/main/assets/st-extension-studio.css').read_text(encoding='utf-8')

bridge="""const api = () => apiPromise ||= import(
        new URL('scripts/extensions.js', document.baseURI).href
    );"""
assert bridge in source, 'Native extension module bridge changed'
source=source.replace(bridge, "const api = () => Promise.resolve(window.__extensionStudioFakeApi);")


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page()
        errors=[]
        page.on('pageerror',lambda err: errors.append(str(err)))
        page.set_content("""
          <div id="rm_extensions_block">
            <div class="extensions_block flex-container">
              <div class="alignitemscenter flex-container wide100p">
                <h3>Extensions</h3>
                <label for="extensions_notify_updates"><input type="checkbox"
                  id="extensions_notify_updates">Update notifications</label>
                <div id="extensions_details" role="button">Manage</div>
                <div id="third_party_extension_button" role="button">Install</div>
              </div>
              <div id="extensions_settings">
                <div id="tts_container" class="extension_container">
                  <h3>Text to Speech</h3>
                  <button id="native-tts-setting">Cài đặt TTS gốc</button>
                </div>
                <div id="other_container" class="extension_container">
                  <h3>Other configuration</h3>
                </div>
              </div>
              <div id="extensions_settings2">
                <div id="demo_container" class="extension_container"></div>
              </div>
              <hr>
              <div class="alignitemscenter flex-container justifyCenter wide100p">
                <span id="extensions_status">Offline</span>
              </div>
              <div class="alignitemsflexstart flex-container wide100p">
                <input id="extensions_url">
                <input id="extensions_api_key">
                <button id="extensions_connect">Kết nối</button>
              </div>
            </div>
          </div>
        """)
        page.evaluate("""() => {
            window.__actions={};
            const names=['tts','third-party/demo'];
            const disabled=['third-party/demo'];
            window.__extensionStudioFakeApi={
                extensionNames:names,
                extensionTypes:{tts:'system','third-party/demo':'local'},
                extension_settings:{disabledExtensions:disabled},
                getExtensionManifest(name) {
                    if (name==='tts')return {display_name:'Text to Speech',version:'1.0'};
                    return {display_name:'Demo',version:'2.0',
                        hooks:{clean:'cleanup'}};
                },
                async enableExtension(name) {window.__actions.enable=name;},
                async disableExtension(name) {window.__actions.disable=name;}
            };
            document.getElementById('third_party_extension_button')
                .addEventListener('click',() => {window.__actions.install=1;});
            document.getElementById('extensions_details')
                .addEventListener('click',() => {
                    window.__actions.manage=(window.__actions.manage||0)+1;
                    const old=document.querySelector('.extensions_info');
                    if(old)old.remove();
                    const info=document.createElement('div');
                    info.className='extensions_info';
                    info.innerHTML=
                      '<div class="extensions_toolbar">' +
                      '<button class="update-all">All</button>' +
                      '<button class="update-enabled">Enabled</button></div>' +
                      '<div class="extension_block" data-name="/demo">' +
                      '<button class="btn_update">Update</button>' +
                      '<button class="btn_clean">Clean</button>' +
                      '<button class="btn_branch">Branch</button>' +
                      '<button class="btn_move">Move</button>' +
                      '<button class="btn_delete">Delete</button></div>';
                    document.body.append(info);
                    for(const cls of ['btn_update','btn_clean','btn_branch',
                        'btn_move','btn_delete','update-all','update-enabled']) {
                        info.querySelector('.'+cls).addEventListener('click',() =>
                            window.__actions[cls]=(window.__actions[cls]||0)+1);
                    }
                });
        }""")
        page.add_style_tag(content=css)
        page.evaluate(source)
        page.wait_for_timeout(120)
        assert not errors,errors
        assert page.locator('#st-extension-studio').count()==1
        assert page.locator('#native-tts-setting').count()==1
        assert page.get_by_role('heading',name='Text to Speech').count()>=1
        assert page.get_by_role('button',name='Text to Speech',exact=True).count()==1
        assert page.get_by_role('button',name='Demo, đã tắt').count()==1
        assert page.locator('#extensions_settings').is_hidden()
        page.get_by_role('button',name='Text to Speech',exact=True).click()
        assert page.locator('#rm_extensions_block.st-ex-detail').count()==1
        assert page.locator('#tts_container').is_visible()
        assert page.locator('#other_container').is_hidden()
        assert page.locator('#native-tts-setting').count()==1
        page.get_by_role('button',name='Quay lại').click()
        assert page.locator('#extensions_settings').is_hidden()
        demo=page.get_by_role('button',name='Demo, đã tắt')
        demo.dispatch_event('contextmenu')
        popup=page.get_by_role('dialog')
        assert popup.get_by_role('button',name='Xóa tiện ích').count()==1
        assert popup.get_by_role('button',name='Bật tiện ích').count()==1
        popup.get_by_role('button',name='Bật tiện ích').click()
        page.wait_for_timeout(70)
        assert page.evaluate('window.__actions.enable')=='third-party/demo'
        demo.dispatch_event('contextmenu')
        page.get_by_role('dialog').get_by_role('button',name='Xóa tiện ích').click()
        page.wait_for_timeout(150)
        assert page.evaluate('window.__actions.btn_delete')==1
        page.get_by_role('button',name='Tùy chọn khác').click()
        page.get_by_role('dialog').get_by_role('button',name='Cài tiện ích từ Git').click()
        assert page.evaluate('window.__actions.install')==1
        page.get_by_role('button',name='Tùy chọn khác').click()
        page.get_by_role('dialog').get_by_role('button',name='Hiển thị mọi cấu hình gốc').click()
        assert page.locator('#other_container').is_visible()
        assert page.locator('#native-tts-setting').count()==1
        page.get_by_role('button',name='Quay lại').click()
        assert page.locator('#extensions_settings').is_hidden()
        assert not errors,errors
        browser.close()
    print('Extension Studio navigation, native actions and TalkBack headings: PASS')


if __name__=='__main__':
    main()
