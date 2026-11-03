#!/usr/bin/env python3
"""Browser integration of the three-section bottom debug panel.

Loads actual SillyTavern 1.19.0 HTML/CSS from the packaged APK asset zip.
Checks prompt sections, native console errors, raw streaming, redaction, and
unchanged chat/composer nodes. Also tests the upstream patched fetch function.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path
from zipfile import ZipFile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'app/src/main/assets'
CSS = (APP / 'st-debug-panel.css').read_text(encoding='utf-8')
JS = (APP / 'st-debug-panel.js').read_text(encoding='utf-8')

with ZipFile(APP / 'sillytavern.zip') as st:
    openai = st.read('public/scripts/openai.js').decode('utf-8')
    assert openai.count('// ST_ANDROID_DEBUG_SEND_HOOK_V1') == 1
    for hook in ["__stDebug('request'", "__stDebug('chunk'", "__stDebug('response'",
                 "__stDebug('complete'", "__stDebug('failure'"]:
        assert hook in openai, hook
    html = st.read('public/index.html').decode('utf-8')
    html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.I | re.S)
    html = re.sub(r'<link\b[^>]*>', '', html, flags=re.I | re.S)
    styles = [st.read(path).decode('utf-8',errors='replace') for path in (
        'public/css/bright.min.css','public/style.css',
        'public/css/st-tailwind.css','public/css/mobile-styles.css')]

def test_fetch_boundary():
    start = openai.index('async function sendOpenAIRequest(')
    end = openai.index('\n}\n\n/**\n * Extracts the reply',start) + 2
    source = openai[start:end]
    harness = r"""
const vm = require('node:vm');
const assert = require('node:assert/strict');
const events=[];
let streaming=false;
let chunks=0;
const ctx={
    window:{__stDebugCapture:(kind,data)=>events.push({kind,data})},
    oai_settings:{},getChatCompletionModel:()=> 'native-model',
    createGenerationParameters: async (settings, model,type,messages)=>({
        generate_data:{model:'native-model',messages:[{role:'system',content:'FINAL PROMPT'}],
            stop:['END'],chat_completion_source:'custom',stream:streaming},
        stream:streaming,canMultiSwipe:false
    }),
    event_types:{CHAT_COMPLETION_SETTINGS_READY:'ready'},
    eventSource:{emit:async(type,options)=>{
        options.messages[0].content='AFTER NATIVE SETTINGS HOOK';
    }},
    getRequestHeaders:()=>({'Content-Type':'application/json'}),
    fetch:async(url,options)=>{
        const body=JSON.parse(options.body);
        assert.equal(body.messages[0].content,'AFTER NATIVE SETTINGS HOOK');
        if (streaming) {
            chunks=0;
            return new Response(new ReadableStream({start(controller){
                controller.enqueue(new Uint8Array([1]));
                controller.enqueue(new Uint8Array([2]));
                controller.close();
            }}));
        }
        return new Response(JSON.stringify({choices:[{message:{content:'SUCCESS'}}]}),
            {status:200,headers:{'Content-Type':'application/json'}});
    },
    getEventSourceStream:()=>new TransformStream({transform(chunk,controller){
        chunks++;
        controller.enqueue({data: chunks===1 ?
            JSON.stringify({choices:[{delta:{content:'hello'}}]}) : '[DONE]'});
    }}),
    checkQuotaError:()=>{},checkModerationError:()=>{},
    parseChatCompletionLogprobs:()=>[],
    tryParseStreamingError:()=>{},
    getStreamingReply:()=> 'hello',
    ToolManager:{parseToolCalls:()=>{}},
    Response,ReadableStream,TransformStream,Uint8Array,JSON,Date,Math,
    AbortController,console
};
vm.runInNewContext(SOURCE,ctx);
(async()=>{
    const normal=await ctx.sendOpenAIRequest('quiet',[],null);
    assert.equal(normal.choices[0].message.content,'SUCCESS');
    assert.equal(events[0].kind,'request');
    assert.equal(events[0].data.messages[0].content,'AFTER NATIVE SETTINGS HOOK');
    assert.equal(events[1].kind,'response');
    assert.match(events[1].data.raw,/SUCCESS/);
    streaming=true;
    const streamFactory=await ctx.sendOpenAIRequest('quiet',[],null);
    assert.equal(typeof streamFactory,'function');
    const items=[];
    for await(const part of streamFactory()) items.push(part);
    assert.equal(items.length,1);
    assert.equal(events.filter(e=>e.kind==='chunk').length,1);
    assert.equal(events.filter(e=>e.kind==='complete').length,1);
    console.log('Live native sendOpenAIRequest hooks: PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
""".replace('SOURCE',json.dumps(source,ensure_ascii=False))
    result=subprocess.run(['node','-e',harness],capture_output=True,text=True,timeout=30)
    assert result.returncode==0, result.stdout+'\n'+result.stderr
    print(result.stdout.strip())

test_fetch_boundary()
chrome = next((shutil.which(name) for name in
    ('google-chrome','google-chrome-stable','chromium','chromium-browser')
    if shutil.which(name)),None)
assert chrome, 'Chromium missing'
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844})
    runtime_errors=[]
    page.on('pageerror',lambda error: runtime_errors.append(str(error)))
    page.set_content(html)
    for style in styles:
        page.add_style_tag(content=style)
    page.add_style_tag(content=CSS)
    page.add_style_tag(content="""#sheld{position:relative!important;left:0!important;right:auto!important;top:0!important;
        width:390px!important;height:844px!important;max-height:844px!important}
        #chat{min-height:10px!important;overflow:auto!important}
        #top-settings-holder{pointer-events:none!important}""")
    page.evaluate("""() => {
        window.__nativeLogs=[
            {timestamp:Date.now()-3000,source:'webview',level:'error',
                message:'Lỗi khi khởi động giao diện',location:'/script.js:22'},
            {timestamp:Date.now()-2000,source:'node',level:'warn',
                message:'Server restarted',location:''}
        ];
        window.__clipboardText='';
        const clipboard={writeText:async text=>{window.__clipboardText=text}};
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:clipboard});
        window.STAndroidDiagnostics={
            getLogs(){return JSON.stringify(window.__nativeLogs)},
            clearLogs(){window.__nativeLogs=[]},
            getVersion(){return '1.19.0-preview.9-debug'}
        };
    }""")
    page.evaluate(JS)
    assert not runtime_errors, runtime_errors
    assert page.locator('#sheld > #st-debug-panel:last-child').count()==1
    assert page.locator('#chat').count()==1
    assert page.locator('#send_form').count()==1
    assert page.locator('#send_textarea').count()==1
    assert page.locator('#st-debug-panel').is_visible()
    assert not page.locator('#st-debug-panel').evaluate('x=>x.open')
    page.locator('#st-debug-panel > summary').click()
    page.wait_for_timeout(100)
    assert page.locator('#st-debug-panel').evaluate('x=>x.open')
    assert page.locator('#st-db-tab-console').count()==1
    assert page.locator('#st-db-tab-prompts').count()==1
    assert page.locator('#st-db-tab-raw').count()==1
    assert page.get_by_text('Lỗi khi khởi động giao diện').is_visible()
    page.screenshot(path=str(ROOT/'debug-console-preview.png'))
    page.get_by_role('button',name='Cảnh báo').click()
    assert page.get_by_text('Server restarted').is_visible()
    assert not page.get_by_text('Lỗi khi khởi động giao diện').count()
    page.get_by_role('button',name='Tất cả').click()
    page.locator('#st-db-view input[type=search]').fill('khởi động')
    assert page.get_by_text('Lỗi khi khởi động giao diện').count()==1
    page.locator('#st-db-view input[type=search]').fill('')
    page.evaluate("""() => {
        window.__stDebugCapture('request',{
            id:'one',messages:[
                {role:'system',content:'Bạn là Alice.'},
                {role:'user',name:'Lời nhắn của người dùng',content:[
                    {type:'text',text:'Xin chào Alice!'},
                    {type:'image_url',image_url:{url:'data:image/png;base64,AAA'}}]}
            ],stop:['END','STOP'],model:'custom-model',
            source:'custom',stream:true
        });
        window.__stDebugCapture('chunk',{id:'one',raw:'{"delta":"A"}',status:200});
        window.__stDebugCapture('chunk',{id:'one',raw:'{"delta":"B"}',status:200});
        window.__stDebugCapture('complete',{id:'one',status:200});
    }""")
    page.locator('#st-db-tab-prompts').click()
    assert 'Lượt #1' in page.locator('#st-db-view').inner_text()
    assert page.locator('.st-db-section').count()==3
    assert page.locator('.st-db-section').nth(0).locator('h4').inner_text()=='Hệ thống #1'
    assert page.locator('.st-db-section').nth(1).locator('h4').inner_text()=='Lời nhắn của người dùng'
    assert 'Bạn là Alice.' in page.locator('.st-db-section').nth(0).inner_text()
    assert 'Xin chào Alice!' in page.locator('.st-db-section').nth(1).inner_text()
    assert '[Hình ảnh]' in page.locator('.st-db-section').nth(1).inner_text()
    assert 'data:image/png;base64' not in page.locator('#st-db-view').inner_text()
    assert 'END' in page.locator('.st-db-section').nth(2).inner_text()
    page.screenshot(path=str(ROOT/'debug-prompts-preview.png'))
    page.get_by_text('Đếm độ dài').click()
    assert 'ký tự' in page.locator('#st-db-view').inner_text()
    page.get_by_role('button',name='Sao chép tất cả').click()
    page.wait_for_timeout(80)
    assert 'Bạn là Alice.' in page.evaluate('window.__clipboardText')
    page.locator('#st-db-tab-raw').click()
    assert '{"delta":"A"}' in page.locator('#st-db-view').inner_text()
    assert '{"delta":"B"}' in page.locator('#st-db-view').inner_text()
    assert 'Hoàn tất' in page.locator('#st-db-view').inner_text()
    page.screenshot(path=str(ROOT/'debug-raw-preview.png'))
    page.evaluate("""() => {
        window.__stDebugCapture('request',{id:'two',messages:[{role:'user',
            content:'Private sample prompt'}],model:'my-model'});
        window.__stDebugCapture('failure',{id:'two',status:503,
            raw:'{"error":"Service unavailable"}',message:'Service unavailable'});
    }""")
    page.locator('#st-db-tab-console').click()
    assert 'Service unavailable' in page.locator('#st-db-view').inner_text()
    page.evaluate("console.error('Authorization: Bearer supersecret_api_token')")
    page.wait_for_timeout(260)
    page.get_by_role('button',name='Xuất báo cáo lỗi').click()
    page.wait_for_timeout(80)
    report=page.evaluate('window.__clipboardText')
    assert '1.19.0-preview.9-debug' in report
    assert 'Private sample prompt' not in report
    assert 'Bạn là Alice.' not in report
    assert 'supersecret_api_token' not in report
    assert '[ĐÃ ẨN]' in report
    page.get_by_role('button',name='Xóa log').click()
    assert page.evaluate('window.__nativeLogs.length')==0
    assert page.locator('#st-db-tab-console').is_visible()
    assert not runtime_errors,runtime_errors
    print('Three debug sections on actual SillyTavern 1.19.0 DOM/CSS: PASS')
    browser.close()
