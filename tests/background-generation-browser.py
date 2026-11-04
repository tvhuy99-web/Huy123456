#!/usr/bin/env python3
"""Verify SillyTavern generation lifecycle is bridged without stopping on Home."""
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'app/src/main/assets/st-background-generation.js').read_text(encoding='utf-8')
original="import(new URL('script.js',document.baseURI).href).then(api => {"
assert original in source
source=source.replace(original,"Promise.resolve(window.__generationFakeApi).then(api => {")

def main():
    chrome=next((shutil.which(n) for n in
        ('google-chrome','google-chrome-stable','chromium','chromium-browser')
        if shutil.which(n)),None)
    assert chrome,'Chrome/Chromium unavailable'
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
        page=browser.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.set_content('<!doctype html><title>SillyTavern generation</title>')
        page.evaluate("""() => {
          window.bridgeCalls=[];
          window.STAndroidGeneration={setActive(active){window.bridgeCalls.push(active)}};
          const listeners=new Map();
          const event_types={
            GENERATION_STARTED:'started',GENERATION_ENDED:'ended',
            GENERATION_STOPPED:'stopped',STREAM_TOKEN_RECEIVED:'stream'
          };
          window.__generationFakeApi={event_types,eventSource:{
            on(key,callback){
              if(!listeners.has(key)) listeners.set(key,[]);
              listeners.get(key).push(callback);
            }
          }};
          window.fireGenerationEvent=key=>{
            for(const callback of listeners.get(key)||[]) callback();
          };
          window.listenersCount=key=>(listeners.get(key)||[]).length;
        }""")
        page.evaluate(source)
        page.evaluate(source)
        page.wait_for_timeout(30)
        assert page.evaluate("listenersCount('started')")==1
        assert page.evaluate("listenersCount('ended')")==1
        page.evaluate("fireGenerationEvent('started')")
        assert page.evaluate('bridgeCalls')==[True]
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        assert page.evaluate('bridgeCalls')==[True], 'Home should not abort generation'
        page.evaluate("fireGenerationEvent('stream')")
        assert page.evaluate('bridgeCalls')==[True], 'No notification on every token'
        page.evaluate("fireGenerationEvent('ended')")
        assert page.evaluate('bridgeCalls')==[True,False]
        page.evaluate("fireGenerationEvent('started');fireGenerationEvent('stopped')")
        assert page.evaluate('bridgeCalls')==[True,False,True,False]
        page.evaluate("fireGenerationEvent('started');window.dispatchEvent(new Event('pagehide'))")
        assert page.evaluate('bridgeCalls')==[True,False,True,False,True,False]
        assert not errors,errors
        browser.close()
    print('Background generation event bridge and Home lifecycle: PASS')

if __name__=='__main__':
    main()
