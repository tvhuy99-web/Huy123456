#!/usr/bin/env python3
"""Character Studio integration against the real SillyTavern 1.19.0 DOM/CSS.

This preserves native card nodes, the chat/composer, native editor form and
third-party extension insertion areas. Upstream JS methods are stubbed only
where they would require a running authenticated SillyTavern server.
"""
import re
import shutil
from pathlib import Path
from zipfile import ZipFile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
with ZipFile(root / 'app/src/main/assets/sillytavern.zip') as st:
    html = st.read('public/index.html').decode('utf-8')
    html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.I | re.S)
    html = re.sub(r'<link\b[^>]*>', '', html, flags=re.I | re.S)
    css = [st.read(path).decode('utf-8', errors='replace') for path in (
        'public/css/bright.min.css','public/style.css',
        'public/css/st-tailwind.css','public/css/mobile-styles.css')]
source = (root / 'app/src/main/assets/st-character-studio.js').read_text(encoding='utf-8')
theme = (root / 'app/src/main/assets/st-character-studio.css').read_text(encoding='utf-8')
assert '#rm_print_characters_block' in theme
assert 'new URL(' in source
assert 'nativeClick(target)' in source
assert 'getElementById' in source
assert 'characters?.[id]' in source
source = source.replace('import(moduleUrl).then(api => {',
                        'Promise.resolve(window.__nativeAPI).then(api => {')
source = source.replace(
    "import(new URL('scripts/group-chats.js',document.baseURI).href)",
    'Promise.resolve(window.__groupsAPI)')
source = source.replace("new URL('script.js',document.baseURI).href",
                        "'http://127.0.0.1:8001/script.js'")
chrome = next((shutil.which(name) for name in (
    'google-chrome','google-chrome-stable','chromium','chromium-browser') if shutil.which(name)), None)
assert chrome, 'No browser available'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':390,'height':844})
    errors = []
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.set_content(html)
    for sheet in css:
        page.add_style_tag(content=sheet)
    page.add_style_tag(content=theme)
    page.add_style_tag(content='''#right-nav-panel {display:block!important;position:relative!important;transform:none!important;width:390px!important;height:auto!important;overflow:visible!important}
      #rm_characters_block {display:block!important}
      #rm_print_characters_block {display:block!important}
      #sheld {display:block!important;position:relative!important}
      .scrollableInner {height:auto!important;max-height:none!important;overflow:visible!important}''')
    page.evaluate("""() => {
        const originalList = document.getElementById('rm_print_characters_block');
        const template = document.querySelector('#character_template .character_select');
        const card = template.cloneNode(true);
        card.id = 'CharID0'; card.dataset.chid = '0';
        card.querySelector('.ch_name').textContent = 'Alice';
        originalList.append(card);
        const group = document.createElement('div');
        group.className='group_select';group.innerHTML='<span class="ch_name">Nhóm A</span>';
        originalList.append(group);
        const ext = document.createElement('button');
        ext.id='extension-owned-button';ext.textContent='Tiện ích';
        document.getElementById('rm_buttons_container').append(ext);
        window.__nativeActions = {};
        const names=['rm_button_create','character_import_button','external_import_button',
            'rm_button_group_chats','bulkEditButton','charListGridToggle',
            'export_button','dupe_button','delete_button'];
        for (const name of names) {
            document.getElementById(name).addEventListener('click',()=>
                window.__nativeActions[name] = (window.__nativeActions[name]||0)+1);
        }
        const panel = document.getElementById('right-nav-panel');
        document.getElementById('rightNavDrawerIcon').addEventListener('click',()=>{
            panel.classList.toggle('closedDrawer');
            panel.classList.toggle('openDrawer');
        });
        panel.classList.add('closedDrawer');
        document.getElementById('rm_button_selected_ch').addEventListener('click',()=>{
            document.getElementById('rm_ch_create_block').style.display='block';
        });
        const handlers={};
        window.__nativeAPI={
            this_chid:undefined,
            characters:[{name:'Alice'}],
            event_types:{CHAT_CHANGED:'chat',CHARACTER_DELETED:'delete',APP_READY:'ready'},
            eventSource:{
                on(kind,fn){(handlers[kind]??=[]).push(fn)},
                emit(kind){for(const fn of handlers[kind]||[]) fn()}
            },
            async selectCharacterById(id){
                this.this_chid=id;
                this.eventSource.emit(this.event_types.CHAT_CHANGED);
            }
        };
        window.__groupsAPI={selected_group:undefined,groups:[{id:1,name:'Nhóm A'}]};
        originalList.addEventListener('click',e=>{
            const card=e.target.closest('.character_select[data-chid]');
            if (card) window.__nativeAPI.selectCharacterById(Number(card.dataset.chid));
            const groupCard=e.target.closest('.group_select');
            if (groupCard) {
                window.__nativeAPI.this_chid=undefined;
                window.__groupsAPI.selected_group=1;
                window.__nativeAPI.eventSource.emit('chat');
            }
        });
    }""")
    original_select = page.eval_on_selector('#character_sort_order','x=>x')
    page.evaluate(source)
    page.wait_for_timeout(100)
    assert not errors, errors
    assert page.locator('#st-character-toolbar').count() == 1
    assert page.locator('#rm_print_characters_block .character_select').count() == 1
    assert page.locator('#rm_buttons_container #extension-owned-button').count() == 1
    assert page.locator('#chat').count() == 1
    assert page.locator('#send_form').count() == 1
    assert page.locator('#send_textarea').count() == 1
    assert page.locator('#form_create').count() == 1
    assert page.locator('#st-character-toolbar #character_sort_order').count() == 1
    assert page.locator('#st-character-toolbar #character_search_bar').count() == 1
    sort_labels=page.locator('#character_sort_order option:not([hidden])').all_inner_texts()
    assert sort_labels == ['A-Z','Z-A','Mới nhất','Cũ nhất','Yêu thích','Gần đây',
        'Nhiều cuộc trò chuyện nhất','Ít cuộc trò chuyện nhất',
        'Nhiều token nhất','Ít token nhất','Ngẫu nhiên'], sort_labels
    page.locator('#character_sort_order').select_option(index=1)
    page.locator('#character_search_bar').fill('Alice')
    assert page.locator('#character_search_bar').input_value()=='Alice'
    page.locator('#st-cs-more').click()
    menu=page.get_by_role('dialog')
    actions=menu.locator('button').all_inner_texts()
    assert actions[:4]==['Tạo nhân vật mới','Nhập thẻ nhân vật',
        'Nhập nhân vật từ URL','Tạo nhóm chat mới'],actions
    menu.get_by_text('Nhập thẻ nhân vật').click()
    assert page.evaluate('window.__nativeActions.character_import_button')==1
    card=page.locator('#rm_print_characters_block .character_select').first
    assert card.get_attribute('role')=='button'
    assert card.locator('.ch_name').get_attribute('role')=='heading'
    card.click()
    page.wait_for_timeout(290)
    assert page.locator('#st-character-tabs').is_visible()
    assert page.locator('#st-cs-active-name').inner_text()=='Alice'
    assert page.locator('#st-cs-tab-chat').get_attribute('aria-selected')=='true'
    # Native mobile drawer overlays the central bar; closed drawers do not
    # intercept taps, while open drawers expose their own tab controls.
    page.add_style_tag(content='#right-nav-panel.closedDrawer {pointer-events:none!important}')
    page.locator('#st-cs-tab-edit').click()
    assert page.locator('#st-cs-tab-edit').get_attribute('aria-selected')=='true'
    assert page.locator('#st-cs-drawer-tabs').count()==1
    page.locator('#st-cs-drawer-tab-chat').click()
    assert page.locator('#st-cs-tab-chat').get_attribute('aria-selected')=='true'
    card.dispatch_event('contextmenu')
    menu=page.get_by_role('dialog')
    assert menu.locator('button').all_inner_texts()[:4]==[
        'Xuất thẻ nhân vật','Nhân bản nhân vật','Xóa nhân vật','Đổi tên']
    menu.get_by_text('Xuất thẻ nhân vật').click()
    page.wait_for_timeout(100)
    assert page.evaluate('window.__nativeActions.export_button')==1
    # The native group card still has its own click path.
    page.locator('#rm_print_characters_block .group_select').first.evaluate('node => node.click()')
    page.wait_for_timeout(80)
    assert page.locator('#st-cs-active-name').inner_text()=='Nhóm A'
    assert page.locator('#rm_buttons_container #extension-owned-button').count()==1
    assert not errors,errors
    print('Character Studio native DOM, menu, sort, chat/edit, group, extension slots: PASS')
    browser.close()
