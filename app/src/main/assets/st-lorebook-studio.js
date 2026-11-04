/*
 * Compact Android Lorebook interface. Native SillyTavern world info entries,
 * handlers, fields, autosave and editor drawers remain the source of truth.
 */
(() => {
    'use strict';
    if (window.__stLorebookStudioInstalled) return;

    const byId = id => document.getElementById(id);
    const panel = byId('WorldInfo');
    const popup = byId('world_popup');
    const holder = byId('wi-holder');
    const list = byId('world_popup_entries_list');
    const select = byId('world_editor_select');
    const search = byId('world_info_search');
    const sort = byId('world_info_sort_order');
    const nativeSettings = byId('wiTopBlock');
    const nativePager = byId('world_info_pagination');
    if (![panel,popup,holder,list,select,search,sort,nativeSettings,nativePager].every(Boolean)) return;
    window.__stLorebookStudioInstalled = true;

    const make = (tag, text, cls) => {
        const el = document.createElement(tag);
        if (text !== undefined) el.textContent = text;
        if (cls) el.className = cls;
        return el;
    };
    const button = (text, handler, cls) => {
        const el = make('button',text,cls);
        el.type = 'button';
        el.addEventListener('click',handler);
        return el;
    };
    const bookName = () => select.value === '' ? '' :
        select.selectedOptions[0]?.textContent?.trim() || '';
    let worldApiPromise;
    const worldApi = () => worldApiPromise ||= import(
        new URL('scripts/world-info.js', document.baseURI).href
    );

    function menu(title, items, returnFocus) {
        const dialog = make('dialog',undefined,'st-wi-dialog');
        dialog.setAttribute('aria-label',title);
        const heading = make('h3',title);
        heading.setAttribute('aria-hidden','true');
        dialog.append(heading);
        let accepted=false;
        for (const item of items) {
            dialog.append(button(item.label,() => {
                accepted=true;
                dialog.close();
                item.run();
            }));
        }
        dialog.append(button('Đóng',()=>dialog.close()));
        dialog.addEventListener('close',() => {
            dialog.remove();
            // Do not steal focus from a native confirmation/edit popup.
            if (!accepted && returnFocus?.isConnected) {
                returnFocus.focus({preventScroll:true});
            }
        });
        document.body.append(dialog);
        dialog.showModal();
    }

    const toolbar = make('section',undefined,'st-wi-toolbar');
    toolbar.id = 'st-lorebook-toolbar';
    const selectorRow = make('div',undefined,'st-wi-selector-row');
    select.setAttribute('aria-label','Chọn Lorebook');
    select.removeAttribute('title');
    const optionsButton = button('Tùy chọn khác',openOptions);
    optionsButton.id = 'st-wi-options';
    selectorRow.append(select,optionsButton);
    const filterRow = make('div',undefined,'st-wi-filter-row');
    search.setAttribute('placeholder','Tìm kiếm mục');
    search.removeAttribute('data-i18n');
    search.removeAttribute('aria-label');
    search.removeAttribute('title');
    // Like the character picker, this native select yields both an
    // unclickable selected-option stop and an actionable TalkBack stop.
    // Keep its exact value/change handlers but offer just one visible action.
    sort.hidden=true;
    sort.setAttribute('aria-hidden','true');
    sort.tabIndex=-1;
    const sortButton=button('',() => {
        menu('Sắp xếp Lorebook',Array.from(sort.options)
            .map((option,index)=>({option,index}))
            .filter(({option})=>!option.hidden && !option.disabled)
            .map(({option,index})=>({
                label:option.textContent.trim(),
                run:()=>{
                    sort.selectedIndex=index;
                    sort.dispatchEvent(new Event('change',{bubbles:true}));
                    syncSortName();
                }
            })),sortButton);
    },'st-wi-sort-button');
    sortButton.id='st-wi-sort';
    sortButton.setAttribute('aria-haspopup','dialog');
    const syncSortName=()=>{
        sortButton.textContent='Sắp xếp: '+
            (sort.selectedOptions[0]?.textContent?.trim()||'Chưa chọn');
    };
    sort.addEventListener('change',syncSortName);
    new MutationObserver(syncSortName).observe(sort,{
        childList:true,subtree:true,attributes:true,
        attributeFilter:['selected','hidden','label']
    });
    filterRow.append(search,sort,sortButton);
    syncSortName();
    toolbar.append(selectorRow,filterRow);
    holder.prepend(toolbar);
    const nativeHeading = panel.querySelector('h3 [data-i18n="Worlds/Lorebooks"]');
    if (nativeHeading) {
        nativeHeading.textContent='Lorebook';
        nativeHeading.removeAttribute('data-i18n');
    }

    // Keep the original global activation configuration accessible, but
    // collapsed so it does not precede every Lorebook entry in TalkBack.
    const settings = make('details',undefined,'st-wi-settings');
    settings.id = 'st-wi-settings';
    settings.append(make('summary','Cài đặt chung'));
    settings.append(nativeSettings);
    toolbar.after(settings);

    const pageHolder = make('div',undefined,'st-wi-page-holder');
    pageHolder.append(nativePager);
    settings.after(pageHolder);

    const nativeActions = [
        ['Tạo Lorebook mới','world_create_button',false],
        ['Nhập Lorebook','world_import_button',false],
        ['Xuất Lorebook','world_popup_export',true],
        ['Đổi tên Lorebook','world_popup_name_button',true],
        ['Nhân bản Lorebook','world_duplicate',true],
        ['Xóa Lorebook','world_popup_delete',true],
        ['Thêm mục','world_popup_new',true],
        ['Mở tất cả mục','OpenAllWIEntries',true],
        ['Thu gọn tất cả mục','CloseAllWIEntries',true],
        ['Điền tiêu đề còn thiếu','world_backfill_memos',true],
        ['Áp dụng thứ tự đang xem','world_apply_current_sorting',true],
        ['Làm mới','world_refresh',true],
    ];
    function expandAllEntries(expanded) {
        for (const row of list.querySelectorAll('.st-wi-entry')) {
            if (row.classList.contains('st-wi-editing') !== expanded) toggleEdit(row);
        }
    }
    function openOptions() {
        const selected = !!bookName();
        menu('Tùy chọn Lorebook', nativeActions
            .filter(([,id,needsBook]) => byId(id) && (!needsBook || selected))
            .map(([label,id]) => ({
                label,
                run:() => id === 'OpenAllWIEntries' ? expandAllEntries(true) :
                    id === 'CloseAllWIEntries' ? expandAllEntries(false) :
                    byId(id)?.click()
            })),
            optionsButton);
    }

    function updatePager() {
        const sizeSelect = nativePager.querySelector('.J-paginationjs-size-select');
        if (sizeSelect && !sizeSelect.dataset.stWiPageSize) {
            sizeSelect.dataset.stWiPageSize='1';
            // Preserve explicit user choices; replace the native default 25
            // with 100 only on the first Android compact UI initialization.
            try {
                if (!localStorage.getItem('st_wi_page_100') && sizeSelect.value === '25' &&
                    [...sizeSelect.options].some(option => option.value === '100')) {
                    localStorage.setItem('st_wi_page_100','1');
                    sizeSelect.value = '100';
                    sizeSelect.dispatchEvent(new Event('change',{bubbles:true}));
                    return;
                }
            } catch (error) {
                console.warn('[Lorebook Studio] Page preference unavailable',error);
            }
        }
        const previous = nativePager.querySelector('.paginationjs-prev');
        const next = nativePager.querySelector('.paginationjs-next');
        nativePager.classList.toggle('st-wi-single-page', Boolean(previous && next &&
            previous.classList.contains('disabled') && next.classList.contains('disabled')));
        for (const [cls,label] of Object.entries({
            'paginationjs-first':'Trang đầu',
            'paginationjs-prev':'Trang trước',
            'paginationjs-next':'Trang sau',
            'paginationjs-last':'Trang cuối',
        })) {
            for (const item of nativePager.querySelectorAll('.'+cls)) {
                const control = item.querySelector('a,button');
                if (!control) continue;
                if (item.classList.contains('disabled')) {
                    control.tabIndex=-1;
                    control.setAttribute('aria-hidden','true');
                } else {
                    control.removeAttribute('tabindex');
                    control.removeAttribute('aria-hidden');
                    control.setAttribute('aria-label',label);
                }
            }
        }
    }
    let pagerTimer;
    new MutationObserver(() => {
        clearTimeout(pagerTimer);
        pagerTimer=setTimeout(updatePager,70);
    }).observe(nativePager,{childList:true,subtree:true});
    updatePager();

    function entryTitle(entry,uid) {
        return String(entry?.comment || entry?.key?.join(', ') || '').trim() || 'Mục ' + uid;
    }
    function entryMenu(row, titleButton) {
        const uid = row.getAttribute('uid');
        const name = titleButton.textContent;
        const original = selector => row.querySelector(selector);
        const actions = [
            {label:'Chỉnh sửa',run:() => toggleEdit(row)},
            {label:'Nhân bản mục',selector:'.duplicate_entry_button'},
            {label:'Chuyển hoặc sao chép',selector:'.move_entry_button'},
            {label:'Xóa mục',selector:'.delete_entry_button'},
        ].filter(item => !item.selector || original(item.selector))
         .map(item => ({
             label:item.label,
             run: item.run || (() => original(item.selector)?.click())
         }));
        if (!uid || !actions.length) return;
        menu(name,actions,titleButton);
    }
    function toggleEdit(row) {
        const nativeToggle = row.querySelector('.inline-drawer-toggle');
        if (!nativeToggle) return;
        row.classList.toggle('st-wi-editing');
        nativeToggle.click();
    }
    function decorateEntry(row,entry) {
        const uid=row.getAttribute('uid');
        const header=row.querySelector('.inline-drawer');
        if (!uid || !header || row.dataset.stWiReady) return;
        row.dataset.stWiReady='1';
        row.classList.add('st-wi-entry');

        const compact = make('div',undefined,'st-wi-entry-summary');
        const name = entryTitle(entry,uid);
        const switchButton = button('',() => {
            row.querySelector('[name="entryKillSwitch"]')?.click();
            syncSwitch();
        },'st-wi-switch');
        switchButton.setAttribute('role','switch');
        switchButton.setAttribute('aria-label','Kích hoạt ' + name);
        const titleHeading = make('h3',undefined,'st-wi-title');
        const titleButton = button(name,() => {
            if (titleButton.dataset.suppressClick === '1') {
                titleButton.dataset.suppressClick='0';
                return;
            }
            toggleEdit(row);
        },'st-wi-title-button');
        titleHeading.append(titleButton);
        const preview = make('div',String(entry?.content || ''),'st-wi-preview');
        compact.append(switchButton,titleHeading);
        row.prepend(compact);
        row.append(preview);

        function syncSwitch() {
            const active = !row.classList.contains('disabledWIEntry');
            switchButton.setAttribute('aria-checked',String(active));
        }
        syncSwitch();

        let holdTimer, releaseTimer;
        const showMenu = () => {
            if (document.querySelector('.st-wi-dialog[open]')) return;
            titleButton.dataset.suppressClick='1';
            clearTimeout(releaseTimer);
            releaseTimer=setTimeout(() => {titleButton.dataset.suppressClick='0';},1000);
            entryMenu(row,titleButton);
        };
        titleButton.addEventListener('pointerdown',event => {
            if (event.button !== 0) return;
            clearTimeout(holdTimer);
            holdTimer=setTimeout(showMenu,600);
        });
        for (const type of ['pointerup','pointercancel','pointerleave']) {
            titleButton.addEventListener(type,()=>clearTimeout(holdTimer));
        }
        titleButton.addEventListener('contextmenu',event => {
            event.preventDefault();
            clearTimeout(holdTimer);
            showMenu();
        });
        titleButton.addEventListener('keydown',event => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                showMenu();
            }
        });
        row.addEventListener('input',event => {
            if (event.target?.matches('textarea[name="comment"]')) {
                const nextName=event.target.value.trim() || 'Mục '+uid;
                titleButton.textContent=nextName;
                switchButton.setAttribute('aria-label','Kích hoạt '+nextName);
            }
            if (event.target?.matches('textarea[name="content"]')) {
                preview.textContent=event.target.value;
            }
        });
        row.querySelector('[name="entryKillSwitch"]')?.addEventListener('click',() => {
            // The native click handler updates disabledWIEntry synchronously.
            queueMicrotask(syncSwitch);
        });
    }

    let listTimer;
    let rendering=false;
    let needsRender=false;
    async function decorateEntries() {
        if (rendering) {
            needsRender=true;
            return;
        }
        rendering=true;
        try {
            const name=bookName();
            if (!name) return;
            const api=await worldApi();
            const data=await api.loadWorldInfo(name);
            if (bookName()!==name || !data?.entries) return;
            for (const row of list.querySelectorAll('.world_entry[uid]')) {
                const entry=data.entries[row.getAttribute('uid')];
                if (entry) decorateEntry(row,entry);
            }
        } catch (error) {
            console.error('[Lorebook Studio] Entry layout unavailable',error);
        } finally {
            rendering=false;
            if (needsRender) {
                needsRender=false;
                scheduleEntries();
            }
        }
    }
    function scheduleEntries() {
        clearTimeout(listTimer);
        listTimer=setTimeout(decorateEntries,90);
    }
    new MutationObserver(scheduleEntries).observe(list,{childList:true,subtree:true});
    // Native editor replaces the list on selection. Observing that render
    // avoids briefly decorating the previous book with the next book's data.
    scheduleEntries();
})();
