#!/usr/bin/env python3
"""Five-row Console display and full retained log copy, including while filtered."""
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
source=(ROOT/'app/src/main/assets/st-debug-panel.js').read_text(encoding='utf-8')
chrome=next((shutil.which(name) for name in
    ('google-chrome','google-chrome-stable','chromium','chromium-browser')
    if shutil.which(name)),None)
assert chrome
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844})
    errors=[]
    page.on('pageerror',lambda x:errors.append(str(x)))
    page.set_content('<html><body><div id="sheld"><div id="form_sheld"></div></div></body></html>')
    page.evaluate("""() => {
        window.__data=Array.from({length:82},(_,i)=>({
            timestamp:Date.now()+i*1000,
            lastTimestamp:Date.now()+i*1000,
            level:i%13===0?'error':'info',
            source:'test',
            message:'entry-'+i+' '+(i===81?'z'.repeat(3500):'example')
        }));
        window.__clipboard='';
        Object.defineProperty(navigator,'clipboard',{configurable:true,
            value:{writeText:async text=>{window.__clipboard=text}}});
        window.STAndroidDiagnostics={
            recordClientEvent(){},
            getLogs(){return JSON.stringify(window.__data)},
            clearLogs(){window.__data=[]},
            getVersion(){return '1.19.0-preview.11'}
        };
    }""")
    page.evaluate(source)
    page.locator('#st-debug-panel > summary').click()
    page.wait_for_timeout(140)
    assert page.locator('#st-db-log-list .st-db-log-row').count()==5
    assert page.locator('#st-db-log-list').inner_text().count('entry-') == 5
    assert 'z'*1000 not in page.locator('#st-db-log-list').inner_text()
    assert not page.get_by_text('Xem thêm nhật ký').count()
    page.get_by_role('button',name='Lỗi',exact=True).click()
    assert page.locator('#st-db-log-list .st-db-log-row').count()<=5
    page.get_by_role('button',name='Sao chép log').click()
    page.wait_for_timeout(60)
    full=page.evaluate('window.__clipboard')
    assert 'entry-0' in full and 'entry-81' in full and 'z'*3000 in full
    page.get_by_role('button',name='Xuất báo cáo lỗi').click()
    page.wait_for_timeout(60)
    report=page.evaluate('window.__clipboard')
    assert 'entry-0' in report and 'entry-81' in report
    assert not errors,errors
    print('Console shows five short rows but copies every retained entry: PASS')
    browser.close()
