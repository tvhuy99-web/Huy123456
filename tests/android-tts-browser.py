#!/usr/bin/env python3
"""Real bundled ST 1.19.0 System TTS Android fallback regression."""
import json
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parent.parent
with ZipFile(ROOT/'app/src/main/assets/sillytavern.zip') as z:
    source=z.read('public/scripts/extensions/tts/system.js').decode('utf-8')
    script=z.read('public/script.js').decode('utf-8')
assert source.count('// ST_ANDROID_NATIVE_TTS_FALLBACK_V1') == 1
assert script.count('// ST_ANDROID_NATIVE_TTS_CANCEL_V1') == 1
assert 'window.STAndroidTTS.cancel()' in script
assert 'if (isMobile() && !__stAndroidTts' in source
for hook in ['__stAndroidTts.speak(', '__stAndroidTts.cancel();',
             '__stAndroidTtsComplete', 'await __stAndroidSpeak(text, voiceId']:
    assert hook in source,hook
source = re.sub(r'^(?:import|export) \{.*?;\s*$', '', source, flags=re.MULTILINE)
harness = r"""
const vm = require('node:vm');
const assert = require('node:assert/strict');
let spoken=[], cancelled=0, fail=false;
const bridge={
  getVoices:()=>JSON.stringify([{voiceURI:'native-vi',name:'Vietnamese native',lang:'vi-VN'}]),
  getStatus:()=>fail?'error':'ready',
  speak:(id,text,voice,lang,rate,pitch,volume)=>{
    spoken.push({text,voice,lang,rate,pitch,volume});
    setTimeout(()=>ctx.window.__stAndroidTtsComplete(id,true,''),0);
  },
  cancel:()=>{cancelled++}
};
const ctx={
 window:{STAndroidTTS:bridge},
 navigator:{language:'vi-VN'},
 isMobile:()=>true,
 document:{addEventListener:()=>{throw Error('Browser speech activation should be skipped')}},
 getPreviewString:()=>'Thử giọng nói',
 saveTtsProviderSettings:()=>{},
 fetch:async(url)=>({ok:true,url}),
 console,
 setTimeout,clearTimeout,JSON,Date,Math,Map,Promise,Error,
 t:(parts,...args)=>String.raw({raw:parts},...args),
 $:()=>({val(){return this},text(){return this},on(){return this}})
};
vm.createContext(ctx);
vm.runInContext(SOURCE,ctx);
(async()=>{
 const tts=vm.runInContext('new SystemTtsProvider()',ctx);
 await tts.loadSettings({});
 const voices=await tts.fetchTtsVoiceObjects();
 assert.equal(voices[0].voice_id,'native-vi');
 const voice=await tts.getVoice('Vietnamese native');
 assert.equal(voice.voice_id,'native-vi');
 const text='Xin chào '.repeat(340);
 const res=await tts.generateTts(text,voice.voice_id);
 assert.equal(res.url,'/sounds/silence.mp3');
 assert.ok(spoken.length>=2);
 assert.equal(spoken.map(x=>x.text).join(''),text);
 assert.ok(spoken.every(x=>x.text.length<=1500));
 tts.previewTtsVoice(voice.voice_id);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(spoken.some(x=>x.text==='Thử giọng nói'));
 assert.ok(cancelled>=1);
 fail=true;
 await assert.rejects(tts.generateTts('Another speech','native-vi'), /không/);
 console.log('Android native System TTS integration, voice selection, chunks, cancel: PASS');
})().catch(err=>{console.error(err);process.exitCode=1});
""".replace('SOURCE',json.dumps(source,ensure_ascii=False))
result=subprocess.run(['node','-e',harness],capture_output=True,text=True,timeout=35)
if result.returncode:
    raise RuntimeError(result.stdout+'\n'+result.stderr)
print(result.stdout.strip())
