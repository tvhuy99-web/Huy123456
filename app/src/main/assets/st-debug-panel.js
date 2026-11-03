/*
 * SillyTavern Android Debug Panel: Console, outgoing Prompts and Raw Response.
 * Inspired by the reference Card Studio disclosure/section layout, but uses
 * the actual SillyTavern 1.19.0 Chat Completion fetch boundary.
 * Private, bounded in-memory prompt/response capture. No network telemetry.
 */
(() => {
    'use strict';
    if (window.__stDebugPanelReady) return;
    window.__stDebugPanelReady = true;

    const MAX_TURNS = 18;
    const MAX_PROMPT = 480000;
    const MAX_RAW = 400000;
    const MAX_CONSOLE = 200000;
    const NORMAL_BUDGET = 159900;
    const IMPORTANT_BUDGET = 39900;
    const COALESCE_WINDOW_MS = 300000;
    const hasNativeStore = () => typeof window.STAndroidDiagnostics?.recordClientEvent === 'function';
    const state = {
        logs: [], turns: [], counter: 0,
        tab: 'console', filter: 'all', search: '', logLimit: 5,
        turnLimit: 3, rawLimit: 3, errors: 0
    };
    let root = null, content = null, statusEl = null, liveNotice = null;
    let repaintTimer = null;

    const node = (tag, title, className) => {
        const item = document.createElement(tag);
        if (title !== undefined) item.textContent = title;
        if (className) item.className = className;
        return item;
    };
    const button = (title, fn, className) => {
        const item = node('button', title, className);
        item.type = 'button';
        item.addEventListener('click', fn);
        return item;
    };
    const cut = (value, length = 2000) => String(value ?? '').slice(0, length);
    const safeLog = value => cut(value, 12000)
        .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,"'}]+/gi, '$1[ĐÃ ẨN]')
        .replace(/([?&](?:api_key|apikey|token|key|secret|password)=)[^&#\s]+/gi, '$1[ĐÃ ẨN]')
        .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*['"]?)[^\s,"'}]+/gi, '$1[ĐÃ ẨN]')
        .replace(/\b(?:sk|rk|sess)-[A-Za-z0-9_-]{12,}\b/gi, '[ĐÃ ẨN]');
    const stamp = time => new Date(time).toLocaleTimeString('vi-VN');
    const simplifySource = url => {
        try {
            const parsed = new URL(url, location.href);
            return parsed.pathname;
        } catch (_) {
            return cut(url, 160);
        }
    };
    const limitText = (text, limit) => {
        const value = String(text || '');
        return value.length > limit ? value.slice(0, limit) + '\n[Đã giới hạn nội dung để tránh đầy bộ nhớ]' : value;
    };
    const roleName = {
        system: 'Hệ thống', developer: 'Nhà phát triển',
        user: 'Người dùng', assistant: 'Trợ lý', tool: 'Công cụ'
    };

    // In the Android APK, there is one canonical native store. The JS ring
    // is only a fallback for browsers without the native bridge.
    const entrySize = item => JSON.stringify(item).length + 1;
    function trimBrowserLogs() {
        for (const [critical,budget] of [[false,NORMAL_BUDGET],[true,IMPORTANT_BUDGET]]) {
            const selected=state.logs.filter(e=>(e.level==='warn'||e.level==='error')===critical);
            let size=selected.reduce((sum,e)=>sum+entrySize(e),0);
            const removed=new Set();
            for(const item of selected) {
                if(size<=budget) break;
                removed.add(item);size-=entrySize(item);
            }
            if(removed.size) state.logs=state.logs.filter(e=>!removed.has(e));
        }
    }
    function log(level,source,message,locationInfo='',details={}) {
        const now=Date.now();
        const item={
            timestamp:now,firstTimestamp:now,lastTimestamp:now,
            repeatCount:1,level,source,message:safeLog(message),
            location:locationInfo?safeLog(locationInfo):''
        };
        for(const key of ['url','originalUrl','resourceType','element','method',
            'httpStatus','errorCode','mainFrame','stack']) {
            if(details[key]!=null) item[key] = typeof details[key]==='string' ?
                safeLog(details[key]) : details[key];
        }
        if(hasNativeStore()){
            try {
                window.STAndroidDiagnostics.recordClientEvent(level,source,item.message,
                    item.location,JSON.stringify(details));
            }catch(_){}
            if(root?.open && state.tab==='console') scheduleRender();
            updateStatus();
            return;
        }
        const sig=x=>[x.level,x.source,x.message,x.location,x.url,x.originalUrl,
            x.resourceType,x.element,x.method,x.httpStatus,x.errorCode,x.mainFrame].join('\u001f');
        const repeated=state.logs.slice().reverse().find(x=>sig(x)===sig(item) &&
            now-(x.lastTimestamp||x.timestamp)<=COALESCE_WINDOW_MS);
        if(repeated){
            repeated.repeatCount=(repeated.repeatCount||1)+1;
            repeated.timestamp=now;repeated.lastTimestamp=now;
        }else state.logs.push(item);
        trimBrowserLogs();
        if(root?.open&&state.tab==='console') scheduleRender();
        updateStatus();
    }

    window.addEventListener('error',event=>{
        const element=event.target;
        if(element && element!==window && (element.hasAttribute?.('src') ||
            element.hasAttribute?.('href') || element.currentSrc || element.src || element.href)) {
            const attr=element.hasAttribute?.('src')?'src':'href';
            const originalUrl=element.getAttribute?.(attr)??'';
            const url=element.currentSrc||element.src||element.href||originalUrl||'(không có URL)';
            const type=element.tagName?.toLowerCase()||'tài nguyên';
            const identifier=type+(element.id?'#'+element.id:'')+
                (typeof element.className==='string'&&element.className.trim()?
                    '.'+element.className.trim().split(/\s+/).slice(0,2).join('.'):'');
            log('error','tài nguyên','Không tải được '+type+': '+url+
                (originalUrl!==url?' (thuộc tính '+attr+'='+JSON.stringify(originalUrl)+')':''),
                url,{url,originalUrl,resourceType:type,element:identifier});
            return;
        }
        const url=event.filename||'';
        log('error','javascript',event.message||event.error?.message||'Lỗi JavaScript',
            url?simplifySource(url)+':'+(event.lineno||'?')+':'+(event.colno||'?'):'',
            {url,resourceType:'javascript',stack:event.error?.stack||''});
    },true);
    window.addEventListener('unhandledrejection',event=>{
        const reason=event.reason;
        log('error','promise',reason?.message||String(reason||'Lỗi bất đồng bộ'),
            '',{resourceType:'promise',stack:reason?.stack||''});
    });
    for(const method of ['error','warn']){
        const original=console[method];
        if(typeof original!=='function')continue;
        console[method]=function(...args){
            // WebChromeClient captures these itself, avoid duplicate entries.
            if(!hasNativeStore()){
                try {
                    const message=args.map(arg=>{
                        if(arg instanceof Error)return arg.message+(arg.stack?'\n'+arg.stack:'');
                        if(typeof arg==='string')return arg;
                        try{return JSON.stringify(arg);}catch(_){return String(arg);}
                    }).join(' ');
                    log(method==='error'?'error':'warn','console',message);
                }catch(_){}
            }
            return original.apply(this,args);
        };
    }
    window.__stDebugLog=log;

    function nativeLogs() {
        try {
            const data = JSON.parse(window.STAndroidDiagnostics?.getLogs() || '[]');
            return Array.isArray(data) ? data.filter(x => x && typeof x.message === 'string') : [];
        } catch (_) {
            return [];
        }
    }
    function combinedLogs() {
        const all = nativeLogs().concat(state.logs);
        const signatures = new Set();
        return all.filter(item => {
            const sig = item.level + '|' + item.source + '|' + item.message + '|' +
                Math.floor(Number(item.timestamp) / 1000);
            if (signatures.has(sig)) return false;
            signatures.add(sig);
            return true;
        }).sort((a,b) => Number(b.timestamp) - Number(a.timestamp));
    }
    function updateStatus() {
        if (!statusEl) return;
        const errors = combinedLogs().filter(x => x.level === 'error').reduce((n,e)=>n+(Number(e.repeatCount)||1),0);
        statusEl.textContent = errors > 0 ? String(errors) + ' lỗi' : '';
        statusEl.hidden = errors === 0;
    }
    function notice(message) {
        if (!liveNotice) return;
        liveNotice.textContent = message;
    }
    async function copy(text, success) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const input = node('textarea');
                input.value = text;
                input.style.position = 'fixed';
                input.style.opacity = '0';
                document.body.append(input);
                input.focus(); input.select();
                const ok = document.execCommand('copy');
                input.remove();
                if (!ok) throw new Error('Không sao chép được');
            }
            notice(success || 'Đã sao chép.');
        } catch (error) {
            log('warn', 'clipboard', 'Không sao chép được: ' + error.message);
            notice('Không thể sao chép.');
        }
    }

    // Extract only displayable content: never retain base64 image/audio blobs.
    function contentParts(content) {
        if (typeof content === 'string') {
            return {text: limitText(content, 180000), parts: []};
        }
        if (Array.isArray(content)) {
            const parts = [];
            for (const item of content.slice(0, 100)) {
                if (typeof item === 'string') parts.push(limitText(item, 20000));
                else if (item?.type === 'text' && typeof item.text === 'string')
                    parts.push(limitText(item.text, 20000));
                else if (item?.type?.includes('image')) parts.push('[Hình ảnh]');
                else if (item?.type?.includes('audio')) parts.push('[Âm thanh]');
                else if (item?.type?.includes('video')) parts.push('[Video]');
                else parts.push('[Nội dung đa phương thức]');
            }
            return {text: limitText(parts.join('\n'), 180000), parts};
        }
        if (content == null) return {text: '', parts: []};
        if (typeof content === 'object' && typeof content.text === 'string') {
            return {text: limitText(content.text, 180000), parts: []};
        }
        return {text: '[Nội dung đa phương thức]', parts: []};
    }
    function normalizeRequest(detail) {
        const messages = Array.isArray(detail.messages) ? detail.messages : [];
        const sections = [];
        let remaining = MAX_PROMPT;
        const roles = {};
        for (const message of messages.slice(0, 300)) {
            const role = cut(message?.role || 'unknown', 30);
            roles[role] = (roles[role] || 0) + 1;
            const parsed = contentParts(message?.content);
            const text = limitText(parsed.text, Math.min(remaining, 180000));
            remaining -= text.length;
            if (remaining <= 0) break;
            const name = (typeof message?.name === 'string' && message.name.trim())
                ? cut(message.name, 80) : (roleName[role] || role) + ' #' + roles[role];
            sections.push({
                id: 'msg-' + sections.length, name, role, content: text,
                subSections: parsed.parts.length > 1 ? parsed.parts : [],
                listMode: false
            });
        }
        if (Array.isArray(detail.stop) && detail.stop.length) {
            const parts = detail.stop.slice(0,100).map(item => cut(item,500));
            sections.push({
                id:'stop', name:'Chuỗi dừng', role:'parameter',
                content:parts.join('\n'), subSections:parts, listMode:true
            });
        }
        return sections;
    }

    function capture(kind, detail) {
        if (!detail || typeof detail.id !== 'string') return;
        let turn = state.turns.find(entry => entry.id === detail.id);
        if (kind === 'request') {
            if (turn) return;
            turn = {
                id: detail.id, sequence: ++state.counter,
                timestamp: Date.now(), status: 'Đang gửi',
                model: cut(detail.model, 80), source: cut(detail.source, 70),
                sections: normalizeRequest(detail), raw: '', stream: !!detail.stream,
                truncatedRaw: false, http: null
            };
            state.turns.unshift(turn);
            state.turns.length = Math.min(state.turns.length, MAX_TURNS);
            if (root?.open && state.tab !== 'console') renderCurrent();
            return;
        }
        if (!turn) return;
        if (kind === 'chunk' || kind === 'response' || kind === 'failure') {
            if (detail.status) turn.http = Number(detail.status);
            if (detail.raw != null && turn.raw.length < MAX_RAW) {
                const fragment = String(detail.raw);
                const space = MAX_RAW - turn.raw.length;
                const fragmentText = fragment.slice(0, space);
                turn.raw += (turn.raw ? '\n' : '') + fragmentText;
                if (fragment.length > space) turn.truncatedRaw = true;
            } else if (detail.raw != null) turn.truncatedRaw = true;
            if (kind === 'response') turn.status = 'Hoàn tất';
            if (kind === 'failure') {
                turn.status = 'Lỗi';
                turn.error = cut(detail.message || 'Lỗi phản hồi API', 300);
                log('error', 'api', turn.error + (turn.http ? ' (HTTP ' + turn.http + ')' : ''));
            }
        }
        if (kind === 'complete') {
            turn.status = 'Hoàn tất';
            if (detail.status) turn.http = Number(detail.status);
        }
        updateRawNode(turn);
        if (root?.open && state.tab === 'raw' && kind !== 'chunk') scheduleRender();
    }

    // The final native fetch boundary invokes this after all ST settings hooks.
    window.__stDebugCapture = capture;
    window.__stDebugPanelState = state;

    function formatAll(sections) {
        return sections.map(x => x.name + '\n' + x.content).join('\n\n');
    }
    function makeSection(section) {
        const block = node('section', undefined, 'st-db-section');
        block.append(node('h4', section.name));
        const copyItem = button('Sao chép', () => copy(section.content, 'Đã sao chép ' + section.name));
        copyItem.setAttribute('aria-label', 'Sao chép ' + section.name);
        block.append(copyItem);
        const list = node('div',undefined,'st-db-content');
        if (section.subSections?.length) {
            section.subSections.forEach((part,index) => {
                const row = node('div',undefined,'st-db-part');
                row.tabIndex = 0;
                row.append(node('span', '#' + (index + 1) + ' ', 'st-db-index'));
                row.append(node('span',part));
                row.addEventListener('keydown',event => {
                    if (!['ArrowUp','ArrowDown'].includes(event.key)) return;
                    event.preventDefault();
                    const siblings = Array.from(list.querySelectorAll('.st-db-part'));
                    const next = siblings[index + (event.key === 'ArrowDown' ? 1 : -1)];
                    next?.focus();
                });
                list.append(row);
            });
        } else {
            const pre = node('pre',section.content || '(Nội dung trống)');
            pre.tabIndex = 0;
            list.append(pre);
        }
        block.append(list);
        return block;
    }
    function lengthButton(turn) {
        const number = turn.sections.reduce((sum,x)=>sum + (x.content?.length || 0),0);
        const btn = button('Đếm độ dài',event => {
            event.preventDefault();
            event.stopPropagation();
            const detailsShown = btn.dataset.shown === '1';
            btn.dataset.shown = detailsShown ? '0' : '1';
            btn.textContent = detailsShown ? 'Đếm độ dài' :
                number.toLocaleString('vi-VN') + ' ký tự | ~' +
                Math.ceil(number / 3.5).toLocaleString('vi-VN') + ' token';
        },'st-db-count');
        btn.title = 'Ước lượng token từ số ký tự';
        return btn;
    }
    function turnSummary(turn, showCount) {
        const left = node('span',undefined,'st-db-turn-title');
        left.append(node('strong', 'Lượt #' + turn.sequence));
        left.append(node('time',stamp(turn.timestamp)));
        const right = node('span',undefined,'st-db-turn-stats');
        if (showCount) {
            right.append(lengthButton(turn));
            right.append(node('span', String(turn.sections.length) + ' mục'));
        } else {
            right.append(node('span',turn.status,'st-db-turn-status'));
        }
        return [left,right];
    }
    function turnCard(turn, isRaw, expanded) {
        const item = node('details',undefined,'st-db-turn');
        item.dataset.turnId = turn.id;
        item.open = expanded;
        const summary = node('summary');
        for (const piece of turnSummary(turn,!isRaw)) summary.append(piece);
        item.append(summary);
        const body = node('div',undefined,'st-db-turn-body');
        if (isRaw) {
            const toolbar = node('div',undefined,'st-db-tools');
            toolbar.append(button('Sao chép',()=>copy(turn.raw,'Đã sao chép phản hồi thô')));
            body.append(toolbar);
            const pre = node('pre',turn.raw || '(Chưa có phản hồi)');
            pre.className = 'st-db-raw';
            pre.dataset.rawId = turn.id;
            pre.tabIndex = 0;
            body.append(pre);
            if (turn.truncatedRaw) body.append(node('p','Phản hồi được giới hạn dung lượng trong bộ nhớ.'));
        } else {
            const toolbar = node('div',undefined,'st-db-tools');
            toolbar.append(button('Sao chép tất cả',
                ()=>copy(formatAll(turn.sections),'Đã sao chép tất cả lời nhắc')));
            body.append(toolbar);
            if (!turn.sections.length) body.append(node('p','Không có thông điệp để hiển thị.'));
            for (const section of turn.sections) body.append(makeSection(section));
        }
        item.append(body);
        return item;
    }
    function updateRawNode(turn) {
        if (!root?.open || state.tab !== 'raw') return;
        if (repaintTimer) return;
        repaintTimer = setTimeout(() => {
            repaintTimer = null;
            if (!root?.open || state.tab !== 'raw') return;
            for (const block of content.querySelectorAll('.st-db-turn[data-turn-id]')) {
                const current = state.turns.find(x => x.id === block.dataset.turnId);
                if (!current) continue;
                const pre = block.querySelector('.st-db-raw');
                if (pre) pre.textContent = current.raw || '(Chưa có phản hồi)';
                const status = block.querySelector('.st-db-turn-status');
                if (status) status.textContent = current.status;
            }
        }, 180);
    }

    function logsMatch(entry) {
        const kind = state.filter;
        if (kind === 'errors' && entry.level !== 'error') return false;
        if (kind === 'warn' && entry.level !== 'warn') return false;
        if (kind === 'webview' && !['webview','javascript','console','promise','tài nguyên'].includes(entry.source)) return false;
        if (kind === 'node' && entry.source !== 'node') return false;
        if (kind === 'api' && !['api','http'].includes(entry.source)) return false;
        if (state.search && !(String(entry.message).toLowerCase().includes(state.search) ||
            String(entry.source).toLowerCase().includes(state.search))) return false;
        return true;
    }
    function describeLog(e) {
        const pairs=[
            ['Lần đầu',e.firstTimestamp?stamp(e.firstTimestamp):''],
            ['Lần gần nhất',e.lastTimestamp?stamp(e.lastTimestamp):''],
            ['Số lần xảy ra',Number(e.repeatCount||1)>1?e.repeatCount:''],
            ['Loại tài nguyên',e.resourceType],['Phần tử',e.element],
            ['URL yêu cầu',e.url],
            ['URL gốc',e.originalUrl===''?'(để trống)':e.originalUrl],
            ['Phương thức',e.method],['HTTP',e.httpStatus],
            ['Mã lỗi',e.errorCode],
            ['Khung chính',e.mainFrame==null?'':(e.mainFrame?'Có':'Không')],
            ['Vị trí',e.location],['Stack trace',e.stack]
        ];
        return pairs.filter(([,v])=>v!==undefined&&v!==null&&v!=='')
            .map(([k,v])=>k+': '+v).join('\n');
    }
    function formatLog(e) {
        return '['+stamp(e.lastTimestamp||e.timestamp)+'] ['+e.source+'] ['+
            e.level+'] '+safeLog(e.message)+(Number(e.repeatCount||1)>1?
            ' (lặp '+e.repeatCount+' lần)':'')+
            (describeLog(e)?'\n'+describeLog(e):'');
    }
    function renderConsole() {
        const controls = node('div',undefined,'st-db-console-controls');
        const filters = node('div',undefined,'st-db-filters');
        filters.setAttribute('role','group');
        filters.setAttribute('aria-label','Lọc nhật ký');
        const choices = [
            ['all','Tất cả'],['errors','Lỗi'],['warn','Cảnh báo'],
            ['webview','WebView'],['node','Máy chủ'],['api','API']
        ];
        for (const [key,label] of choices) {
            const control = button(label,()=>{
                state.filter=key;renderCurrent();
            });
            control.setAttribute('aria-pressed',String(state.filter===key));
            filters.append(control);
        }
        controls.append(filters);
        const search = node('input');
        search.type='search';
        search.placeholder='Tìm kiếm nhật ký';
        search.setAttribute('aria-label','Tìm kiếm nhật ký');
        search.value=state.search;
        search.addEventListener('input',()=>{
            state.search=search.value.toLowerCase().trim();
            drawLogs();
        });
        controls.append(search);
        const actions = node('div',undefined,'st-db-tools');
        actions.append(button('Sao chép log',()=>{
            // Copy the full retained console, regardless of search/filter/visible rows.
            return copy(combinedLogs().map(formatLog).join('\n\n'),'Đã sao chép toàn bộ nhật ký');
        }));
        actions.append(button('Xuất báo cáo lỗi',()=>{
            const lines = [
                'BÁO CÁO GỠ LỖI SILLYTAVERN',
                'Phiên bản: ' + cut(window.STAndroidDiagnostics?.getVersion?.() || '1.19.0',80),
                'Thời gian: ' + new Date().toLocaleString('vi-VN'),
                'Số lượt gửi AI ghi nhận: ' + state.turns.length,
                'Nội dung prompt và phản hồi AI không được tự động đưa vào báo cáo.',
                '',
                ...combinedLogs().map(formatLog)
            ];
            return copy(lines.join('\n'),'Đã sao chép báo cáo lỗi');
        }));
        actions.append(button('Xóa log',()=>{
            try { window.STAndroidDiagnostics?.clearLogs?.(); } catch (_) {}
            state.logs = [];state.errors=0;drawLogs();updateStatus();
            notice('Đã xóa nhật ký.');
        }));
        controls.append(actions);
        content.append(controls);
        const logList = node('div',undefined,'st-db-log-list');
        logList.id = 'st-db-log-list';
        content.append(logList);
        drawLogs();
    }
    function drawLogs() {
        const target = document.getElementById('st-db-log-list');
        if (!target || !root?.open || state.tab !== 'console') return;
        const filtered = combinedLogs().filter(logsMatch);
        target.replaceChildren();
        if (!filtered.length) {
            target.append(node('p','Không có nhật ký phù hợp.'));
            return;
        }
        for(const entry of filtered.slice(0,state.logLimit)){
            const row=node('div',undefined,'st-db-log-row st-db-'+cut(entry.level,10));
            row.append(node('time',stamp(entry.lastTimestamp||entry.timestamp)));
            row.append(node('strong',cut(entry.source,30)));
            const count=Number(entry.repeatCount||1);
            const shortMessage=cut(entry.message,220);
            const msg=shortMessage+(entry.message.length>220?'…':'')+
                (count>1?' (lặp '+count+' lần)':'');
            const message=node('span',msg);
            message.setAttribute('aria-label',entry.level+': '+msg);
            row.append(message);
            if(entry.location)row.append(node('small',entry.location));
            const detailText=describeLog(entry);
            if(detailText){
                const disclosure=node('details',undefined,'st-db-log-details');
                disclosure.append(node('summary','Chi tiết lỗi'));
                const detail=node('pre',detailText);
                detail.tabIndex=0;
                disclosure.append(detail);row.append(disclosure);
            }
            target.append(row);
        }
        // Present only five rows. The full 200k-character ring remains
        // available through Copy Log / Export Report, not as thousands of
        // TalkBack focusable rows or extra "load more" buttons.
    }
    function renderTurns(isRaw) {
        const items = state.turns.slice(0,isRaw?state.rawLimit:state.turnLimit);
        const opened = new Set(
            Array.from(content.querySelectorAll('.st-db-turn[open]')).map(x=>x.dataset.turnId)
        );
        if (!items.length) {
            content.append(node('p',isRaw ? 'Chưa có dữ liệu phản hồi.' : 'Chưa có dữ liệu lời nhắc.'));
            return;
        }
        items.forEach((turn,index)=>content.append(turnCard(turn,isRaw,opened.has(turn.id) || index===0)));
        if (items.length < state.turns.length) {
            content.append(button('Xem thêm lượt',()=>{
                if (isRaw) state.rawLimit+=3; else state.turnLimit+=3;
                renderCurrent();
            }));
        }
    }
    function renderCurrent() {
        if (!root?.open || !content) return;
        content.replaceChildren();
        if (state.tab === 'console') renderConsole();
        else renderTurns(state.tab === 'raw');
        updateStatus();
    }
    function scheduleRender() {
        if (repaintTimer) return;
        repaintTimer=setTimeout(()=>{
            repaintTimer=null;
            renderCurrent();
        },220);
    }

    function installUI() {
        if (root) return true;
        const sheld=document.getElementById('sheld');
        const form=document.getElementById('form_sheld');
        if (!sheld || !form) return false;

        root=node('details',undefined,'st-db-panel');
        root.id='st-debug-panel';
        const summary=node('summary',undefined,'st-db-heading');
        summary.append(node('strong','Bảng gỡ lỗi'));
        statusEl=node('span','', 'st-db-error-count');
        statusEl.hidden=true;
        summary.append(statusEl);
        root.append(summary);

        const body=node('div',undefined,'st-db-body');
        const tabs=node('div',undefined,'st-db-tabs');
        tabs.setAttribute('role','tablist');
        tabs.setAttribute('aria-label','Các mục gỡ lỗi');
        const names=[['console','Console'],['prompts','Lời nhắc gửi đi'],['raw','Phản hồi AI']];
        for(const [name,label] of names){
            const control=button(label,()=>{
                state.tab=name;
                for(const item of tabs.children) {
                    item.setAttribute('aria-selected',String(item.dataset.tab===name));
                }
                content.setAttribute('aria-labelledby','st-db-tab-'+name);
                renderCurrent();
            });
            control.id='st-db-tab-'+name;
            control.dataset.tab=name;
            control.setAttribute('role','tab');
            control.setAttribute('aria-selected',String(name===state.tab));
            control.setAttribute('aria-controls','st-db-view');
            tabs.append(control);
        }
        body.append(tabs);
        content=node('div',undefined,'st-db-view');
        content.id='st-db-view';
        content.setAttribute('role','tabpanel');
        content.setAttribute('aria-labelledby','st-db-tab-console');
        body.append(content);
        liveNotice=node('div','', 'st-db-live');
        liveNotice.setAttribute('aria-live','polite');
        body.append(liveNotice);
        root.append(body);
        // Last item of the main chat shell, after the existing composer.
        // No existing SillyTavern or extension DOM node is removed or cloned.
        sheld.append(root);
        root.addEventListener('toggle',()=>{
            if (root.open) renderCurrent();
            else if(content) content.replaceChildren();
        });
        updateStatus();
        return true;
    }

    if (!installUI()) {
        let tries=0;
        const interval=setInterval(()=>{
            if (installUI() || ++tries>=40) clearInterval(interval);
        },500);
    }
    // Refresh native logs when the panel is actually in use.
    setInterval(()=>{
        if (root?.open && state.tab==='console') {
            drawLogs();updateStatus();
        }
    },2500);
})();