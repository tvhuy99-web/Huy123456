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
    const MAX_LOGS = 240;
    const state = {
        logs: [], turns: [], counter: 0,
        tab: 'console', filter: 'all', search: '', logLimit: 50,
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
    const safeLog = value => cut(value, 2300)
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

    function log(level, source, message, locationInfo) {
        const entry = {
            timestamp: Date.now(), level, source, message: safeLog(message),
            location: locationInfo ? safeLog(locationInfo) : ''
        };
        const last = state.logs[state.logs.length - 1];
        if (last && last.source === source && last.message === entry.message &&
            last.level === entry.level && entry.timestamp - last.timestamp < 700) return;
        state.logs.push(entry);
        if (state.logs.length > MAX_LOGS) state.logs.shift();
        if (level === 'error') state.errors += 1;
        if (root?.open && state.tab === 'console') scheduleRender();
        updateStatus();
    }

    // Browser-side failures are collected even if native diagnostics
    // cannot be queried. Native WebChromeClient records earlier errors.
    window.addEventListener('error', event => {
        const target = event.target;
        if (target && target !== window && (target.src || target.href)) {
            log('error', 'tài nguyên', 'Tải tài nguyên thất bại: ' +
                simplifySource(target.src || target.href));
            return;
        }
        log('error', 'javascript', event.message || event.error?.message || 'Lỗi JavaScript',
            (event.filename ? simplifySource(event.filename) + ':' + event.lineno : '') +
            (event.error?.stack ? '\n' + cut(event.error.stack, 1400) : ''));
    }, true);
    window.addEventListener('unhandledrejection', event => {
        const reason = event.reason;
        log('error', 'promise', reason?.message || String(reason || 'Lỗi bất đồng bộ'),
            reason?.stack || '');
    });
    for (const method of ['error', 'warn']) {
        const original = console[method];
        if (typeof original !== 'function') continue;
        console[method] = function(...args) {
            try {
                const message = args.map(arg => {
                    if (arg instanceof Error) return arg.message + (arg.stack ? '\n' + arg.stack : '');
                    if (typeof arg === 'string') return arg;
                    try { return JSON.stringify(arg); } catch (_) { return String(arg); }
                }).join(' ');
                log(method === 'error' ? 'error' : 'warn', 'console', message);
            } catch (_) {}
            return original.apply(this, args);
        };
    }

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
        const errors = combinedLogs().filter(x => x.level === 'error').length;
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
                state.filter=key;state.logLimit=50;renderCurrent();
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
            state.logLimit=50;
            drawLogs();
        });
        controls.append(search);
        const actions = node('div',undefined,'st-db-tools');
        actions.append(button('Sao chép log',()=>{
            const found=combinedLogs().filter(logsMatch);
            return copy(found.map(x=>'[' + stamp(x.timestamp) + '] [' +
                x.source + '] [' + x.level + '] ' + x.message +
                (x.location ? '\n' + x.location : '')).join('\n'),
                'Đã sao chép nhật ký');
        }));
        actions.append(button('Xuất báo cáo lỗi',()=>{
            const lines = [
                'BÁO CÁO GỠ LỖI SILLYTAVERN',
                'Phiên bản: ' + cut(window.STAndroidDiagnostics?.getVersion?.() || '1.19.0',80),
                'Thời gian: ' + new Date().toLocaleString('vi-VN'),
                'Số lượt gửi AI ghi nhận: ' + state.turns.length,
                'Nội dung prompt và phản hồi AI không được tự động đưa vào báo cáo.',
                '',
                ...combinedLogs().slice(0,140).map(e=>'['+stamp(e.timestamp)+'] [' +
                    e.level + '/' + e.source + '] ' + safeLog(e.message) +
                    (e.location ? ' (' + e.location + ')' : ''))
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
        for (const entry of filtered.slice(0,state.logLimit)) {
            const row = node('div',undefined,'st-db-log-row st-db-' + cut(entry.level,10));
            row.append(node('time',stamp(entry.timestamp)));
            row.append(node('strong',cut(entry.source,30)));
            const message = node('span',cut(entry.message,2300));
            message.setAttribute('aria-label',entry.level + ': ' + entry.message);
            row.append(message);
            if (entry.location) {
                const trace = node('small',entry.location);
                row.append(trace);
            }
            target.append(row);
        }
        if (filtered.length > state.logLimit) {
            target.append(button('Xem thêm nhật ký',()=>{
                state.logLimit += 50;drawLogs();
            }));
        }
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