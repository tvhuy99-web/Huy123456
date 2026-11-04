#!/usr/bin/env python3
"""Real SillyTavern DOM regression: closed drawer, context labels, tag removals."""
from pathlib import Path
from zipfile import ZipFile
import re
import shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
with ZipFile(ROOT/'app/src/main/assets/sillytavern.zip') as archive:
    html=archive.read('public/index.html').decode('utf-8')
    html=re.sub(r'<script\\b[^>]*>.*?</script>','',html,flags=re.I|re.S)
    html=re.sub(r'<link\\b[^>]*>','',html,flags=re.I|re.S)
    styles=[archive.read(p).decode('utf-8',errors='replace')
        for p in ('public/css/bright.min.css','public/style.css',
                  'public/css/st-tailwind.css','public/css/mobile-styles.css')]
source=(ROOT/'app/src/main/assets/st-accessibility.js').read_text(encoding='utf-8')

def main():
    chrome=next((shutil.which(x) for x in
        ('google-chrome','google-chrome-stable','chromium','chromium-browser')
        if shutil.which(x)),None)
    assert chrome,'Chrome/Chromium unavailable'
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':390,'height':844})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.set_content(html)
        for sheet in styles: page.add_style_tag(content=sheet)
        page.add_style_tag(content="""
          #right-nav-panel {display:block!important;position:relative!important;
              transform:none!important;width:390px!important;height:auto!important}
          #rm_characters_block {display:block!important;}
          .test-tag {display:inline-block;padding:10px;}
          .test-tag .tag_remove {display:inline-block!important;width:30px;height:30px;}
        """)
        page.evaluate("""() => {
          const active=document.getElementById('right-nav-panel');
          active.classList.remove('closedDrawer');
          active.classList.add('openDrawer');
          const tags=document.querySelector('#rm_characters_block .rm_tag_filter');
          const tag=document.createElement('span');
          tag.className='tag test-tag';
          tag.innerHTML='<span class="tag_name">Phiêu lưu</span>' +
             '<i class="fa-solid fa-circle-xmark tag_remove"></i>';
          tags.append(tag);
        }""")
        page.evaluate(source)
        page.wait_for_timeout(220)
        assert not errors,errors
        assert page.locator('#WorldInfo').get_attribute('inert') is not None
        assert page.locator('#rm_extensions_block').get_attribute('inert') is not None
        assert page.locator('#right-nav-panel').get_attribute('inert') is None
        tag=page.locator('.test-tag .tag_remove')
        assert tag.get_attribute('role')=='button'
        assert tag.get_attribute('aria-label')=='Bỏ lọc Phiêu lưu'
        page.evaluate("""() => {
          const closed=document.getElementById('right-nav-panel');
          closed.classList.remove('openDrawer');
          closed.classList.add('closedDrawer');
          const opened=document.getElementById('WorldInfo');
          opened.classList.remove('closedDrawer');
          opened.classList.add('openDrawer');
        }""")
        page.wait_for_timeout(250)
        assert page.locator('#right-nav-panel').get_attribute('inert') is not None
        assert page.locator('#WorldInfo').get_attribute('inert') is None
        browser.close()
    print('TalkBack closed drawer focus and tag removal labels: PASS')

if __name__=='__main__':
    main()
