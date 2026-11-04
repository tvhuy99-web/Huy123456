/*
 * SillyTavern 1.19.0 Android Extension Studio.
 * A compact navigation layer only: no extension is removed, reinstalled or
 * reconfigured here without calling the original SillyTavern handlers.
 */
(() => {
    'use strict';
    if (window.__stExtensionStudioInstalled) return;
    const byId = id => document.getElementById(id);
    const panel = byId('rm_extensions_block');
    const nativeManager = byId('extensions_details');
    const nativeInstall = byId('third_party_extension_button');
    const columns = [byId('extensions_settings'), byId('extensions_settings2')];
    const header = panel?.querySelector('.extensions_block > .alignitemscenter.flex-container.wide100p');
    if (!panel || !nativeManager || !nativeInstall || !header || columns.some(x => !x)) return;
    window.__stExtensionStudioInstalled = true;

    const make = (tag, value, cls) => {
        const node = document.createElement(tag);
        if (value !== undefined) node.textContent = value;
        if (cls) node.className = cls;
        return node;
    };
    const button = (name, callback, cls) => {
        const node = make('button', name, cls);
        node.type = 'button';
        node.addEventListener('click', callback);
        return node;
    };
    const clean = value => String(value ?? '').trim();
    let apiPromise;
    let extensionApi = null;
    const api = () => apiPromise ||= import(
        new URL('scripts/extensions.js', document.baseURI).href
    );

    const hub = make('section', undefined, 'st-ex-hub');
    hub.id = 'st-extension-studio';
    const optionsButton = button('Tùy chọn khác', showOptions, 'st-ex-menu-button');
    optionsButton.id = 'st-ex-options';
    const backButton = button('Quay lại', showList, 'st-ex-back');
    backButton.id = 'st-ex-back';
    backButton.hidden = true;
    const search = make('input');
    search.id = 'st-ex-search';
    search.type = 'search';
    search.placeholder = 'Tìm tiện ích';
    const toolbar = make('div',undefined,'st-ex-toolbar');
    toolbar.append(optionsButton,backButton);
    const list = make('div',undefined,'st-ex-list');
    list.id = 'st-ex-list';
    hub.append(toolbar,search,list);
    header.after(hub);

    // Extras API is deprecated but the original connection controls must
    // stay available and keep their native listeners.
    const extrasRows = [
        panel.querySelector('.extensions_block > .alignitemscenter.flex-container.justifyCenter.wide100p'),
        panel.querySelector('.extensions_block > .alignitemsflexstart.flex-container.wide100p'),
    ].filter(Boolean);
    for (const row of extrasRows) row.classList.add('st-ex-native-extras');
    panel.classList.add('st-ex-ready');

    let currentMode='list';
    let currentConfig=null;
    let dataSignature='';
    let filterText='';
    function mode(modeName, config=null) {
        currentMode=modeName;
        panel.classList.remove('st-ex-detail','st-ex-all','st-ex-extras');
        for (const column of columns) column.classList.remove('st-ex-visible-column');
        for (const node of panel.querySelectorAll('.extension_container.st-ex-selected')) {
            node.classList.remove('st-ex-selected');
        }
        currentConfig=config;
        if (modeName==='detail' && config) {
            panel.classList.add('st-ex-detail');
            config.classList.add('st-ex-selected');
            for (const column of columns) if (column.contains(config)) {
                column.classList.add('st-ex-visible-column');
            }
        } else if (modeName==='all') {
            panel.classList.add('st-ex-all');
        } else if (modeName==='extras') {
            panel.classList.add('st-ex-extras');
        }
        list.hidden=modeName!=='list';
        search.hidden=modeName!=='list';
        backButton.hidden=modeName==='list';
        if (modeName==='list') optionsButton.focus({preventScroll:true});
        else backButton.focus({preventScroll:true});
    }
    function showList() { mode('list'); }

    function popup(title, items, returnFocus) {
        const dialog=make('dialog',undefined,'st-ex-popup');
        dialog.setAttribute('aria-label',title);
        const heading=make('h3',title);
        heading.setAttribute('aria-hidden','true');
        dialog.append(heading);
        let chosen=false;
        for (const item of items) {
            const choice=button(item.label,() => {
                chosen=true;
                dialog.close();
                item.run();
            });
            dialog.append(choice);
        }
        dialog.append(button('Đóng',() => dialog.close()));
        dialog.addEventListener('close',() => {
            dialog.remove();
            if (!chosen && returnFocus?.isConnected) {
                returnFocus.focus({preventScroll:true});
            }
        });
        document.body.append(dialog);
        dialog.showModal();
    }

    function displayName(name, manifest) {
        return clean(manifest?.display_name) || clean(name.replace(/^third-party\/?/,''));
    }
    function normalized(value) {
        return clean(value).toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
    }
    function findSettings(name,manifest) {
        const pieces=name.split('/');
        const short=pieces[pieces.length-1];
        const keys=new Set([normalized(name),normalized(short),
            normalized('third-party'+short),normalized(displayName(name,manifest))]);
        for (const column of columns) {
            for (const container of column.querySelectorAll('.extension_container')) {
                if (!container.children.length) continue;
                const id=normalized(container.id.replace(/_container$/,''));
                if (keys.has(id)) return container;
                const heading=container.querySelector('h2,h3,h4,summary,.standoutHeader');
                if (heading && keys.has(normalized(heading.textContent))) return container;
            }
        }
        return null;
    }

    async function nativeManage(name,actionClass='') {
        const externalId=name.replace(/^third-party/,'');
        nativeManager.click();
        // Original manager owns authorization, confirmation and persistence.
        if (!name) return;
        const getTarget=() => {
            const root=document.querySelector('.extensions_info');
            return Array.from(root?.querySelectorAll('.extension_block') || [])
                .find(el => el.dataset.name===externalId) || null;
        };
        let row=getTarget();
        if (!row) {
            row=await new Promise(resolve => {
                const timer=setTimeout(() => {observer.disconnect();resolve(null);},3500);
                const observer=new MutationObserver(() => {
                    const found=getTarget();
                    if (!found) return;
                    clearTimeout(timer);
                    observer.disconnect();
                    resolve(found);
                });
                observer.observe(document.body,{childList:true,subtree:true});
            });
        }
        if (!row) return;
        const target=actionClass && row.querySelector('.'+actionClass);
        if (target) target.click();
        else {
            // If this extension has no native settings/action, put TalkBack
            // on its original management row rather than an empty screen.
            row.tabIndex=-1;
            row.focus({preventScroll:true});
            row.scrollIntoView({block:'nearest',behavior:'auto'});
        }
    }
    async function updateAll(selector) {
        nativeManager.click();
        let tries=0;
        const attempt=() => {
            const el=document.querySelector(selector);
            if (el) el.click();
            else if (++tries<30) setTimeout(attempt,100);
        };
        setTimeout(attempt,80);
    }
    async function exportList() {
        const module=await api();
        const data=module.extensionNames.map(name => {
            const manifest=module.getExtensionManifest(name) || {};
            return {
                name,display_name:displayName(name,manifest),
                type:module.extensionTypes[name] || '',
                version:clean(manifest.version),
                repository:clean(
                    typeof manifest.homepage==='string' ? manifest.homepage :
                    typeof manifest.repository==='string' ? manifest.repository : ''
                ),
            };
        });
        const payload={format:'sillytavern-extension-inventory-v1',extensions:data};
        const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
        const url=URL.createObjectURL(blob);
        const anchor=document.createElement('a');
        anchor.href=url;
        anchor.download='sillytavern-extensions-list.json';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url),60000);
    }
    function showOptions() {
        popup('Tùy chọn tiện ích',[
            {label:'Cài tiện ích từ Git',run:() => nativeInstall.click()},
            {label:'Xuất danh sách tiện ích',run:() => void exportList()},
            {label:'Quản lý tiện ích',run:() => nativeManage('')},
            {label:'Cập nhật tất cả',run:() =>
                updateAll('.extensions_info .extensions_toolbar button:first-child')},
            {label:'Cập nhật các tiện ích đang bật',run:() =>
                updateAll('.extensions_info .extensions_toolbar button:nth-child(2)')},
            {label:byId('extensions_notify_updates')?.checked
                ? 'Tắt thông báo cập nhật' : 'Bật thông báo cập nhật',
                run:() => byId('extensions_notify_updates')?.click()},
            {label:'Cài đặt kết nối',run:() => mode('extras')},
            {label:'Hiển thị mọi cấu hình gốc',run:() => mode('all')},
        ],optionsButton);
    }
    async function toggleExtension(name,disabled) {
        const module=await api();
        if (disabled) await module.enableExtension(name);
        else await module.disableExtension(name);
    }
    function showEntryMenu(name,manifest,focusTarget) {
        const external=name.startsWith('third-party');
        const disabled=extensionApi?.extension_settings?.disabledExtensions?.includes(name);
        const items=[
            {label:'Mở tiện ích',run:() => void enterExtension(name,manifest)},
            {label:disabled?'Bật tiện ích':'Tắt tiện ích',
                run:() => void toggleExtension(name,disabled)},
        ];
        if (external) {
            items.push({label:'Cập nhật',run:()=>void nativeManage(name,'btn_update')});
            if (manifest?.hooks?.clean) {
                items.push({label:'Dọn dữ liệu',run:()=>void nativeManage(name,'btn_clean')});
            }
            items.push(
                {label:'Chuyển vị trí',run:()=>void nativeManage(name,'btn_move')},
                {label:'Chuyển nhánh',run:()=>void nativeManage(name,'btn_branch')},
                {label:'Xóa tiện ích',run:()=>void nativeManage(name,'btn_delete')}
            );
        }
        items.push({label:'Quản lý nâng cao',run:()=>void nativeManage(name)});
        popup(displayName(name,manifest),items,focusTarget);
    }
    async function enterExtension(name,manifest) {
        const config=findSettings(name,manifest);
        if (config) {
            mode('detail',config);
        } else {
            // Extensions without a configuration page still have a native
            // management entry (version, source, enable/update/delete).
            await nativeManage(name);
        }
    }

    function render() {
        const module=extensionApi;
        if (!module?.extensionNames?.length) return;
        const names=module.extensionNames.slice();
        const states=module.extension_settings.disabledExtensions || [];
        const signature=JSON.stringify([names,states,filterText]);
        if (dataSignature===signature) return;
        dataSignature=signature;
        const fragment=document.createDocumentFragment();
        const words=normalized(filterText);
        for (const name of names) {
            const manifest=module.getExtensionManifest(name) || {};
            const label=displayName(name,manifest);
            if (words && !normalized(label+' '+name).includes(words)) continue;
            const disabled=states.includes(name);
            const card=make('article',undefined,'st-ex-card');
            card.dataset.extensionName=name;
            const heading=make('h4');
            const title=button(label,() => {
                if (title.dataset.longPressed==='1') {
                    title.dataset.longPressed='0';
                    return;
                }
                void enterExtension(name,manifest);
            },'st-ex-entry-title');
            title.setAttribute('aria-haspopup','dialog');
            title.setAttribute('aria-label',label+(disabled?', đã tắt':''));
            heading.append(title);
            const metadata=make('span',[
                clean(manifest.version) ? 'v'+manifest.version : '',
                disabled ? 'Đã tắt' : '',
            ].filter(Boolean).join(' '),'st-ex-meta');
            metadata.setAttribute('aria-hidden','true');
            card.append(heading,metadata);
            let longTimer,clearTimer;
            const menu=() => {
                if (document.querySelector('.st-ex-popup[open]')) return;
                title.dataset.longPressed='1';
                clearTimeout(clearTimer);
                clearTimer=setTimeout(()=>{title.dataset.longPressed='0';},1100);
                showEntryMenu(name,manifest,title);
            };
            title.addEventListener('pointerdown',event => {
                if (event.button!==0) return;
                clearTimeout(longTimer);
                longTimer=setTimeout(menu,600);
            });
            for (const ev of ['pointerup','pointerleave','pointercancel']) {
                title.addEventListener(ev,()=>clearTimeout(longTimer));
            }
            title.addEventListener('contextmenu',event=>{
                event.preventDefault();
                clearTimeout(longTimer);
                menu();
            });
            title.addEventListener('keydown',event=>{
                if (event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')) {
                    event.preventDefault();menu();
                }
            });
            fragment.append(card);
        }
        list.replaceChildren(fragment);
    }
    search.addEventListener('input',() => {
        filterText=search.value;
        render();
    });
    // Native extension module is the only source for installed names,
    // manifests, permissions, enable/disable and persistence.
    api().then(module => {
        extensionApi=module;
        render();
    }).catch(error => {
        console.error('[Extension Studio] Native extensions unavailable',error);
    });
    let lastCount=0;
    const refresh=() => {
        const module=extensionApi;
        if (module) {
            if (module.extensionNames.length!==lastCount) {
                lastCount=module.extensionNames.length;
                render();
            }
            // Extensions can add configuration containers after startup.
        }
    };
    const visibilityObserver=new MutationObserver(refresh);
    visibilityObserver.observe(panel,{attributes:true,attributeFilter:['class']});
    // The drawer can open after the upstream settings/extension loader.
    const refreshTimer=setInterval(()=>{
        refresh();
        if (extensionApi?.extensionNames?.length) clearInterval(refreshTimer);
    },750);
})();
