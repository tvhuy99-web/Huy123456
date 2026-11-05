#!/usr/bin/env python3
"""Browser checks for the compact native-backed Lorebook presentation.

Prepared for the final regression stage. Not run during UI development.
"""
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
JS = (ROOT / 'app/src/main/assets/st-lorebook-studio.js').read_text(encoding='utf-8')
CSS = (ROOT / 'app/src/main/assets/st-lorebook-studio.css').read_text(encoding='utf-8')
original_bridge = """const worldApi = () => worldApiPromise ||= import(
        new URL('scripts/world-info.js', document.baseURI).href
    );"""
assert original_bridge in JS, 'Native world-info bridge changed'
source = JS.replace(original_bridge, "const worldApi = () => Promise.resolve(window.__worldApiTest);")


def main():
    with sync_playwright() as p:
        chrome = next((shutil.which(name) for name in (
            'google-chrome','google-chrome-stable','chromium','chromium-browser')
            if shutil.which(name)), None)
        assert chrome, 'No browser available'
        browser = p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content("""
          <div id="WorldInfo">
            <h3><span data-i18n="Worlds/Lorebooks">Worlds/Lorebooks</span></h3>
            <div id="wi-holder">
              <div id="wiTopBlock"><select id="world_info" multiple></select></div>
              <div id="world_popup">
                <hr>
                <div class="flex-container alignitemscenter">
                  <button id="world_create_button">Create</button>
                  <select id="world_editor_select">
                    <option value="">Pick</option>
                    <option value="0" selected>Quyển A</option>
                  </select>
                  <button id="world_import_button">Import</button>
                  <button id="world_popup_export">Export</button>
                  <button id="world_popup_name_button">Rename</button>
                  <button id="world_duplicate">Duplicate</button>
                  <button id="world_popup_delete">Delete</button>
                </div>
                <div class="flex-container alignitemscenter">
                  <button id="world_popup_new">New Entry</button>
                  <button id="OpenAllWIEntries">Open all</button>
                  <button id="CloseAllWIEntries">Close all</button>
                  <button id="world_backfill_memos">Backfill</button>
                  <button id="world_apply_current_sorting">Apply sort</button>
                  <button id="world_refresh">Refresh</button>
                  <input id="world_info_search" placeholder="Search...">
                  <select id="world_info_sort_order"><option>Order</option></select>
                  <div id="world_info_pagination">
                    <div class="paginationjs">
                      <select class="J-paginationjs-size-select">
                        <option value="25" selected>25/page</option>
                        <option value="100">100/page</option>
                      </select>
                      <ul class="paginationjs-pages">
                        <li class="paginationjs-prev disabled"><a href="#">‹</a></li>
                        <li class="paginationjs-next disabled"><a href="#">›</a></li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div id="world_popup_entries_list">
                  <div class="world_entry" uid="11">
                    <form class="world_entry_form">
                      <div class="inline-drawer">
                        <div class="inline-drawer-header">
                          <div class="inline-drawer-toggle"></div>
                          <div name="entryKillSwitch"></div>
                          <textarea name="comment">Tiêu đề A</textarea>
                          <button class="duplicate_entry_button" type="button">Copy</button>
                          <button class="move_entry_button" type="button">Move</button>
                          <button class="delete_entry_button" type="button">Delete</button>
                        </div>
                        <div class="inline-drawer-content" style="display:none">
                          <textarea name="content">Đầy đủ nội dung mục A.</textarea>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>
        """)
        page.evaluate("""() => {
            window.__nativeActions={};
            window.__worldApiTest={
              async loadWorldInfo() {
                return {entries:{'11':{
                  comment:'Tiêu đề A',content:'Đầy đủ nội dung mục A.',
                  disable:false,key:['từ khóa']
                }}};
              }
            };
            for (const id of ['world_create_button','world_import_button','world_popup_new',
                               'world_popup_delete','world_popup_export']) {
              document.getElementById(id).addEventListener('click', () =>
                window.__nativeActions[id]=(window.__nativeActions[id]||0)+1);
            }
            const entry=document.querySelector('.world_entry');
            entry.querySelector('[name="entryKillSwitch"]').addEventListener('click',
              () => entry.classList.toggle('disabledWIEntry'));
            entry.querySelector('.inline-drawer-toggle').addEventListener('click', () => {
              const body=entry.querySelector('.inline-drawer-content');
              body.style.display=body.style.display==='none'?'block':'none';
            });
            for(const cls of ['duplicate_entry_button','move_entry_button','delete_entry_button']){
              entry.querySelector('.'+cls).addEventListener('click',() =>
                 window.__nativeActions[cls]=(window.__nativeActions[cls]||0)+1);
            }
        }""")
        page.add_style_tag(content=CSS)
        page.evaluate(source)
        page.wait_for_timeout(300)
        assert not errors, errors
        assert page.locator('#st-lorebook-toolbar').count() == 1
        assert page.locator('#wiTopBlock').count() == 1
        assert page.locator('#st-wi-settings #wiTopBlock').count() == 1
        assert page.locator('#world_info_search').count() == 1
        assert page.locator('#world_editor_select').count() == 1
        assert page.locator('#world_info_sort_order').is_hidden()
        assert page.get_by_role('button',name='Sắp xếp: Order').count() == 1
        page.get_by_role('button',name='Sắp xếp: Order').click()
        page.get_by_role('dialog').get_by_role('button',name='Order').click()
        assert page.locator('#world_info_sort_order').input_value() != ''
        assert page.locator('#world_popup_entries_list .world_entry').count() == 1
        assert page.get_by_role('heading', name='Tiêu đề A').count() == 1
        assert page.get_by_role('button',name='Tiêu đề A').count() == 1
        assert page.locator('.st-wi-preview').inner_text() == 'Đầy đủ nội dung mục A.'
        switch=page.get_by_role('checkbox')
        assert switch.count() == 1
        assert switch.get_attribute('aria-label') is None
        assert switch.get_attribute('aria-checked') == 'true'
        switch.click()
        assert switch.get_attribute('aria-checked') == 'false'
        page.get_by_role('button',name='Tiêu đề A').click()
        assert page.locator('.st-wi-entry.st-wi-editing').count() == 1
        assert page.locator('.st-wi-entry textarea[name="content"]').count() == 1
        assert page.locator('.st-wi-preview').is_hidden()
        page.locator('.st-wi-entry textarea[name="comment"]').fill('Tiêu đề mới')
        assert page.get_by_role('heading',name='Tiêu đề mới').count() == 1
        title=page.get_by_role('button',name='Tiêu đề mới')
        title.dispatch_event('contextmenu')
        dialog=page.get_by_role('dialog')
        assert dialog.get_by_role('button',name='Nhân bản mục').count() == 1
        dialog.get_by_role('button',name='Nhân bản mục').click()
        assert page.evaluate('window.__nativeActions.duplicate_entry_button') == 1
        page.get_by_role('button',name='Tùy chọn khác').click()
        dialog=page.get_by_role('dialog')
        assert dialog.get_by_role('button',name='Thêm mục').count() == 1
        dialog.get_by_role('button',name='Thêm mục').click()
        assert page.evaluate('window.__nativeActions.world_popup_new') == 1
        assert page.locator('#world_info_pagination .paginationjs').is_hidden()
        assert not errors,errors
        browser.close()
    print('Lorebook Studio native entries, headings, switch and shared menus: PASS')


if __name__ == '__main__':
    main()
