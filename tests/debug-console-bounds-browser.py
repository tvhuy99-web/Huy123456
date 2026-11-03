#!/usr/bin/env python3
"""Verify Console ring limits, diagnostic specificity and native bridge behaviour."""
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / 'app/src/main/assets/st-debug-panel.js').read_text(encoding='utf-8')
NATIVE = (ROOT / 'app/src/main/kotlin/com/jiuguan/sillytavern/DiagnosticStore.kt').read_text(encoding='utf-8')
assert 'NORMAL_BUDGET = 159_900' in NATIVE
assert 'IMPORTANT_BUDGET = 39_900' in NATIVE
assert 'MAX_SNAPSHOT = 200_000' in NATIVE
assert 'repeatCount' in NATIVE and 'lastTimestamp' in NATIVE
assert 'important.forEach { snapshot.put(it) }' in NATIVE
assert 'fun recordClientEvent(' in NATIVE
chrome = next((shutil.which(name) for name in (
    'google-chrome','google-chrome-stable','chromium','chromium-browser') if shutil.which(name)),None)
assert chrome, 'Chromium not available'
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':390,'height':844})
    errors = []
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('<!doctype html><html><head></head><body><div id="sheld"><div id="form_sheld"></div></div></body></html>')
    page.evaluate(SOURCE)
    checks = page.evaluate("""() => {
        const record=window.__stDebugLog;
        const state=window.__stDebugPanelState;
        for(let i=0;i<800;i++){
            record('info','bulk','normal #'+i+':'+('x'.repeat(650)));
        }
        for(let i=0;i<140;i++){
            record('error','native','error #'+i+':'+('y'.repeat(850)),
                '/scripts/test.js:'+(i+1),{stack:'stack #'+i});
        }
        for(let i=0;i<1000;i++){
            record('error','tài nguyên','Không tải được img: http://localhost/missing.png',
                'http://localhost/missing.png',{url:'http://localhost/missing.png',
                originalUrl:'missing.png',resourceType:'img',element:'img#broken'});
        }
        const size = critical=>state.logs.filter(item=>
            ['error','warn'].includes(item.level)===critical)
            .reduce((sum,item)=>sum+JSON.stringify(item).length+1,0);
        const duplicate=state.logs.find(item=>item.message.includes('missing.png'));
        return {
            normal:size(false),important:size(true),
            length:JSON.stringify(state.logs).length,
            duplicate:duplicate?.repeatCount,
            first:duplicate?.firstTimestamp,last:duplicate?.lastTimestamp,
            recent:state.logs.some(x=>x.message.startsWith('normal #799')),
            oldest:state.logs.some(x=>x.message.startsWith('normal #0:')),
            importantRecord:state.logs.some(x=>x.message.startsWith('error #139:'))
        };
    }""")
    assert checks['normal'] <= 159900, checks
    assert checks['important'] <= 39900, checks
    assert checks['length'] <= 200000, checks
    assert checks['duplicate'] == 1000, checks
    assert checks['first'] <= checks['last'], checks
    assert checks['recent'] and not checks['oldest'], checks
    assert checks['importantRecord'], checks

    resource = page.evaluate("""() => {
        const img=document.createElement('img');
        img.id='asset-with-empty-src';
        img.setAttribute('src','');
        document.body.append(img);
        img.dispatchEvent(new Event('error'));
        const entry=window.__stDebugPanelState.logs
            .find(x=>x.resourceType==='img'&&x.element==='img#asset-with-empty-src');
        return entry?{element:entry.element,originalUrl:entry.originalUrl,url:entry.url,
            text:entry.message}:null;
    }""")
    assert resource is not None, 'Resource error was not recorded'
    assert resource['originalUrl'] == '', resource
    assert resource['element'] == 'img#asset-with-empty-src', resource
    assert 'Không tải được img:' in resource['text'], resource

    native = page.evaluate("""() => {
        const before=window.__stDebugPanelState.logs.length;
        window.STAndroidDiagnostics={
            received:[],
            recordClientEvent(level,source,message,location,metadata){
                this.received.push({level,source,message,location,metadata:JSON.parse(metadata)});
            },
            getLogs(){return '[]'},
            clearLogs(){},
            getVersion(){return '1.19.0-preview.10-debug'}
        };
        window.__stDebugLog('error','javascript','ReferenceError: unavailable',
            'system.js:131',{url:'http://localhost/system.js',resourceType:'javascript',
            stack:'at system.js:131'});
        return {
            before,after:window.__stDebugPanelState.logs.length,
            received:window.STAndroidDiagnostics.received
        };
    }""")
    assert native['after']==native['before'], native
    assert len(native['received'])==1, native
    entry=native['received'][0]
    assert entry['metadata']['stack']=='at system.js:131',entry
    assert entry['metadata']['url']=='http://localhost/system.js',entry
    assert not errors, errors
    print('200k Console limits, 1000x dedupe, source details, native bridge: PASS')
    browser.close()
