import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../app/src/main/assets/st-accessibility.js', import.meta.url), 'utf8');

class FakeElement {
  constructor(tag, {id = '', classes = [], title = '', text = '', alt} = {}) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.attrs = new Map();
    this.classList = classes;
    this.textContent = text;
    this.childNodes = [{nodeType: 3, textContent: text}];
    this.children = [];
    this.parentElement = null;
    if (title) this.attrs.set('title', title);
    if (alt !== undefined) this.attrs.set('alt', alt);
  }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  hasAttribute(k) { return this.attrs.has(k); }
  setAttribute(k,v) { this.attrs.set(k, String(v)); }
  matches(s) {
    return s.split(',').some(q => {
      q=q.trim();
      if (q === 'button') return this.tagName === 'BUTTON';
      if (q === 'input') return this.tagName === 'INPUT';
      if (q === 'textarea') return this.tagName === 'TEXTAREA';
      if (q === 'select') return this.tagName === 'SELECT';
      if (q === 'input:not([type="hidden"])') return this.tagName === 'INPUT';
      if (q === 'a') return this.tagName === 'A';
      if (q === 'img') return this.tagName === 'IMG';
      if (q.startsWith('img[')) return this.tagName === 'IMG' && !!this.getAttribute('alt');
      if (q === '[contenteditable="true"]') return false;
      if (q.startsWith('i.')) return this.tagName === 'I' && this.classList.includes(q.slice(2));
      if (q.startsWith('.')) return this.classList.includes(q.slice(1));
      return false;
    });
  }
  closest(query) {
    let cursor=this.parentElement;
    while(cursor){if(cursor.matches(query))return cursor; cursor=cursor.parentElement;}
    return null;
  }
  querySelectorAll(query) {
    return this.children.flatMap(ch => [
      ...(ch.matches(query) ? [ch] : []),
      ...ch.querySelectorAll(query)
    ]);
  }
  querySelector(query) { return this.querySelectorAll(query)[0] || null; }
  append(ch) { this.children.push(ch);ch.parentElement=this;return this;}
  click() {this.clicked=true;}
}

const send = new FakeElement('div',{id:'send_but',classes:['interactable','fa-solid','fa-paper-plane']});
const options = new FakeElement('div',{id:'options_button',classes:['interactable','fa-solid','fa-bars']});
const composer = new FakeElement('textarea',{id:'send_textarea'});
const filter = new FakeElement('input',{id:'unlabeled_filter'});
filter.setAttribute('placeholder','Tìm kiếm');
const native = new FakeElement('button',{text:'Lưu cài đặt'});
const icon = new FakeElement('i',{classes:['fa-solid','fa-save']});
native.append(icon);
const copyMessage = new FakeElement('div',{classes:['mes_button','mes_copy','fa-solid','fa-copy'],title:'Copy'});
const previousSwipe = new FakeElement('div',{classes:['swipe_left','fa-solid','fa-chevron-left']});
const chatEntry = new FakeElement('div',{classes:['select_chat_block']});
chatEntry.append(new FakeElement('span',{classes:['select_chat_block_filename'],text:'Cuộc trò chuyện A'}));
const groupEntry = new FakeElement('div',{classes:['group_select']});
groupEntry.append(new FakeElement('span',{classes:['ch_name'],text:'Nhóm A'}));
const decorative = new FakeElement('img',{alt:''});
const meaningful = new FakeElement('img',{alt:'Hình nhân vật'});
const imageControl = new FakeElement('div',{id:'customImageButton',classes:['menu_button']});
imageControl.append(new FakeElement('img',{alt:'Mở bộ sưu tập'}));
const elements=[send,options,composer,filter,native,copyMessage,previousSwipe,chatEntry,groupEntry,decorative,meaningful,imageControl];
const listeners={};
const document = {
  body:{},
  documentElement:{},
  getElementById: id => elements.find(el=>el.id===id) || null,
  querySelectorAll: selector => {
    if(selector.startsWith('button,')) return [send,options,composer,filter,native,copyMessage,previousSwipe,chatEntry,groupEntry,imageControl];
    if(selector.startsWith('img,i.fa')) return [decorative,meaningful,icon,...imageControl.children];
    return [];
  },
  addEventListener: (event,handler) => listeners[event]=handler,
};
let observer;
class FakeObserver {
  constructor(cb){this.cb=cb;}
  observe(){observer=this;}
}
const window={};
const context={window,document,Element:FakeElement,MutationObserver:FakeObserver,
  setTimeout:callback=>callback(), console:{info:()=>{}}};
runInNewContext(source,context);

assert.equal(send.getAttribute('aria-label'),'Gửi tin nhắn');
assert.equal(send.getAttribute('role'),'button');
assert.equal(send.getAttribute('tabindex'),'0');
assert.equal(options.getAttribute('aria-label'),'Mở tùy chọn trò chuyện');
assert.equal(composer.getAttribute('aria-label'),'Nhập tin nhắn');
assert.equal(composer.getAttribute('role'),null,'textarea must retain native semantics');
assert.equal(composer.getAttribute('tabindex'),null,'textarea must not get artificial tab ordering');
assert.equal(filter.getAttribute('role'),null,'text input must not become a button');
assert.equal(filter.getAttribute('aria-label'),null,
  'placeholder already names search; do not duplicate it as aria-label');
assert.equal(copyMessage.getAttribute('aria-label'),'Sao chép tin nhắn');
assert.equal(copyMessage.getAttribute('role'),'button');
assert.equal(previousSwipe.getAttribute('aria-label'),'Xem phản hồi trước');
assert.equal(chatEntry.getAttribute('aria-label'),'Mở cuộc trò chuyện: Cuộc trò chuyện A');
assert.equal(chatEntry.children[0].getAttribute('aria-hidden'),'true',
  'history filename must not repeat the row action');
assert.equal(groupEntry.getAttribute('aria-label'),'Mở nhóm chat Nhóm A');
groupEntry.dataset={stCsReady:'1'};
assert.equal(native.getAttribute('aria-label'),null,
  'visible text on a native button supplies its name without a duplicate aria-label');
assert.equal(native.getAttribute('role'),null,'native semantic role must be preserved');
assert.equal(icon.getAttribute('aria-hidden'),'true','nested visual icon must be hidden');
assert.equal(decorative.getAttribute('aria-hidden'),'true','decorative image not read aloud');
assert.equal(decorative.getAttribute('alt'),'');
assert.equal(meaningful.getAttribute('aria-hidden'),null,'meaningful image retained');
assert.equal(imageControl.getAttribute('aria-label'),'Mở bộ sưu tập');
assert.equal(imageControl.children[0].getAttribute('alt'),'','duplicate image label removed');
assert.equal(imageControl.children[0].getAttribute('aria-hidden'),'true');
assert.ok(observer,'dynamic dialogs and buttons must be watched');
chatEntry.children[0].textContent = 'Cuộc trò chuyện B';
observer.cb();
assert.equal(chatEntry.getAttribute('aria-label'),'Mở cuộc trò chuyện: Cuộc trò chuyện B',
  'dynamic chat labels must refresh');
chatEntry.setAttribute('aria-label','Tên tùy chỉnh từ extension');
observer.cb();
assert.equal(chatEntry.getAttribute('aria-label'),'Tên tùy chỉnh từ extension',
  'later explicit labels must not be overridden');
assert.ok(typeof listeners.keydown==='function','keyboard activation should work');

const evt={key:'Enter',target:send,preventDefault(){this.prevented=true;}};
listeners.keydown(evt);
assert.equal(send.clicked,true);
assert.equal(evt.prevented,true);
const groupEvent={key:'Enter',target:groupEntry,preventDefault(){this.prevented=true;}};
listeners.keydown(groupEvent);
assert.equal(groupEntry.clicked,undefined,
  'Character Studio owns group keyboard activation when installed');

runInNewContext(source,context);
assert.equal(window.__stAndroidAccessibilityInstalled,true,'must remain installed once');

const main = readFileSync(new URL('../app/src/main/kotlin/com/jiuguan/sillytavern/MainActivity.kt',import.meta.url),'utf8');
assert.match(main,/injectAndroidAccessibility\(view\)/);
assert.match(main,/assets\.open\("st-accessibility\.js"\)/);
const launcherSource = readFileSync(new URL('../app/src/main/kotlin/com/jiuguan/sillytavern/LauncherActivity.kt',import.meta.url),'utf8');
const nodeSource = readFileSync(new URL('../app/src/main/kotlin/com/jiuguan/sillytavern/NodeManager.kt',import.meta.url),'utf8');
const nodeServiceSource = readFileSync(new URL('../app/src/main/kotlin/com/jiuguan/sillytavern/NodeService.kt',import.meta.url),'utf8');
assert.match(launcherSource,/NodeService\.start\(this@LauncherActivity\)/,'launcher must use foreground service');
assert.doesNotMatch(launcherSource,/nodeManager\.startServer\(\)/,'launcher must not spawn unmanaged Node processes');
assert.match(nodeSource,/nodeProcess\?\.isAlive == true/,'dead child must be cleared before restart');
assert.match(nodeServiceSource,/var lastStartError/,'startup errors must be visible');
const launcher=readFileSync(new URL('../app/src/main/res/layout/activity_launcher.xml',import.meta.url),'utf8');
const settings=readFileSync(new URL('../app/src/main/res/layout/activity_settings.xml',import.meta.url),'utf8');
assert.match(launcher,/android:importantForAccessibility="no"/);
for(const id of ['btn_start','btn_export','btn_import','btn_retry','btn_settings','btn_open_termux']) {
  assert.match(launcher,new RegExp('android:id="@\\+id/'+id+'"\\s+android:contentDescription="[^"]+"'));
}
for(const id of ['btn_test','btn_save','btn_back']) {
  assert.match(settings,new RegExp('android:id="@\\+id/'+id+'"\\s+android:contentDescription="[^"]+"'));
}
console.log('Android SillyTavern TalkBack labels/decorations smoke test: OK');
