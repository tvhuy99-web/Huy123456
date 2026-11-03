(() => {
'use strict';
if (window.__stPresetStudioInstalled) return;
const get = id => document.getElementById(id);
    const host = get('openai_api-presets');
    const area = get('ai_response_configuration');
    const preset = get('settings_preset_openai');
    const source = get('main_api');
    const nativeList = get('completion_prompt_manager');
    if (!host || !area || !preset || !source || !nativeList) {
        console.error('[Preset Studio] Missing SillyTavern 1.19.0 DOM anchors');
        return;
    }
    window.__stPresetStudioInstalled = true;
    let api = null;
    const promptManager = () => api?.promptManager;
    const entries = () => {
        const pm = promptManager();
        return pm?.activeCharacter ? pm.getPromptOrderForCharacter(pm.activeCharacter) : [];
    };
    const make = (tag, textValue, className) => {
        const el = document.createElement(tag);
        el.textContent = String(textValue ?? '');
        if (className) el.className = className;
        return el;
    };
    const action = (label, handler) => {
        const el = make('button', label);
        el.type = 'button';
        el.addEventListener('click', handler);
        return el;
    };
    const ui = document.createElement('div');
    ui.id = 'st-preset-studio';
    ui.innerHTML =
      '<h2>Preset</h2><div class="st-ps-toolbar">' +
      '<select id="st-ps-select" aria-label="Chọn Preset"></select>' +
      '<button id="st-ps-options" type="button">Tùy chọn khác</button></div>' +
      '<div class="st-ps-tabs" role="tablist" aria-label="Mục Preset">' +
      '<button id="st-ps-config-tab" role="tab" type="button" aria-selected="true" aria-controls="st-ps-config-panel">Cấu hình</button>' +
      '<button id="st-ps-prompts-tab" role="tab" type="button" aria-selected="false" aria-controls="st-ps-prompts-panel">Lời nhắc</button></div>' +
      '<section id="st-ps-config-panel" role="tabpanel" aria-labelledby="st-ps-config-tab"></section>' +
      '<section id="st-ps-prompts-panel" role="tabpanel" aria-labelledby="st-ps-prompts-tab" hidden>' +
      '<div class="st-ps-toolbar"><select id="st-ps-filter" aria-label="Lọc lời nhắc">' +
      '<option value="all">Tất cả</option><option value="on">Đã bật</option>' +
      '<option value="off">Đã tắt</option></select>' +
      '<button id="st-ps-add" type="button">Thêm lời nhắc</button></div>' +
      '<div id="st-ps-move"></div><div id="st-ps-prompts"></div>' +
      '<button id="st-ps-preview" type="button">Xem trước lời nhắc gửi tới AI</button></section>';
    area.prepend(ui);

    let tab = 'config';
    let filter = 'all';
    let moving = '';
    let suppress = false;
    let pendingNew = null;
    let pressTimer;
    let renderTimer;
    const nativePrompt = id => Array.from(nativeList.querySelectorAll('.completion_prompt_manager_prompt'))
        .find(el => el.dataset.pmIdentifier === id);

    function popup(title, actions, focusTarget) {
        const dialog = document.createElement('dialog');
        dialog.className = 'st-ps-popup';
        dialog.setAttribute('aria-label', title);
        dialog.append(make('h3', title));
        for (const item of actions) {
            const btn = action(item.label, () => {
                dialog.close();
                item.run();
            });
            btn.disabled = !!item.disabled;
            dialog.append(btn);
        }
        dialog.append(action('Đóng', () => dialog.close()));
        dialog.addEventListener('close', () => {
            dialog.remove();
            if (focusTarget?.isConnected) focusTarget.focus();
        });
        document.body.append(dialog);
        dialog.showModal();
    }
    function clickNative(selector) {
        const node = document.querySelector(selector);
        if (node) node.click();
    }
    function syncPresets() {
        const select = get('st-ps-select');
        select.replaceChildren(...Array.from(preset.options).map(opt => {
            const node = make('option', opt.textContent);
            node.value = opt.value;
            node.disabled = opt.disabled;
            return node;
        }));
        select.value = preset.value;
    }
    get('st-ps-select').addEventListener('change', event => {
        preset.value = event.target.value;
        preset.dispatchEvent(new Event('change', { bubbles: true }));
    });
    preset.addEventListener('change', () => {
        syncPresets();
        setTimeout(render, 100);
    });
    new MutationObserver(syncPresets).observe(preset, { childList:true, subtree:true });
    get('st-ps-options').addEventListener('click', event => {
        const options = [
            ['Cập nhật thiết lập hiện tại', '#update_oai_preset'],
            ['Lưu thành Preset mới', '#new_oai_preset'],
            ['Nhân bản', '#new_oai_preset'],
            ['Đổi tên', '[data-preset-manager-rename="openai"]'],
            ['Nhập', '#import_oai_preset'],
            ['Xuất', '#export_oai_preset'],
            ['Xóa', '#delete_oai_preset'],
            ['Nhập danh sách lời nhắc', '#prompt-manager-import'],
            ['Xuất danh sách lời nhắc', '#prompt-manager-export'],
            ['Khôi phục thứ tự lời nhắc', '#prompt-manager-reset-character'],
            ['Liên kết Preset với API', '#bind_preset_to_connection']
        ];
        popup('Tùy chọn Preset', options.map(([label, selector]) => ({
            label, run: () => clickNative(selector)
        })), event.currentTarget);
    });
    function showTab(which) {
        tab = which;
        area.classList.toggle('st-ps-show-prompts', which === 'prompts');
        get('st-ps-prompts-panel').hidden = which !== 'prompts';
        get('st-ps-config-panel').hidden = which !== 'config';
        area.classList.toggle('st-ps-show-prompts', source.value === 'openai' && which === 'prompts');
        for (const key of ['config','prompts']) {
            const node = get('st-ps-' + key + '-tab');
            node.setAttribute('aria-selected', String(which === key));
            node.tabIndex = which === key ? 0 : -1;
        }
        if (which === 'prompts') render();
    }
    get('st-ps-config-tab').addEventListener('click', () => showTab('config'));
    get('st-ps-prompts-tab').addEventListener('click', () => showTab('prompts'));

    function save() {
        const pm = promptManager();
        pm.render(false);
        pm.saveServiceSettings();
        render();
    }
    function edit(id) {
        const pm = promptManager();
        const node = nativePrompt(id);
        const p = pm?.getPromptById(id);
        if (!node || !p) return;
        if (pm.isPromptEditAllowed(p)) pm.handleEdit({ target: node });
        else pm.handleInspect({ target: node });
    }
    function create(after) {
        const pm = promptManager();
        if (!pm) return;
        pendingNew = { after };
        pm.handleNewPrompt();
    }
    function place(target, after) {
        const list = entries();
        const from = list.findIndex(item => item.identifier === moving);
        if (from < 0 || moving === target) return;
        const [value] = list.splice(from, 1);
        const at = list.findIndex(item => item.identifier === target);
        if (at < 0) return;
        list.splice(at + (after ? 1 : 0), 0, value);
        moving = '';
        save();
    }
    function menu(id, focus) {
        const pm = promptManager();
        const p = pm?.getPromptById(id);
        if (!p) return;
        popup(p.name || 'Lời nhắc', [
            { label:'Chỉnh sửa', run:() => edit(id) },
            { label:'Chọn để di chuyển', run:() => {
                moving = id;
                filter = 'all';
                get('st-ps-filter').value = 'all';
                render();
            }},
            { label:'Nhân bản lời nhắc', disabled:!!p.marker, run:() => {
                const copy = Object.assign({}, structuredClone(p), {
                    identifier:pm.getUuidv4(), system_prompt:false, marker:false,
                    name:(p.name || 'Lời nhắc') + ' (bản sao)'
                });
                pm.addPrompt(copy, copy.identifier);
                const list = entries();
                const index = list.findIndex(item => item.identifier === id);
                list.splice(index + 1, 0, {
                    identifier:copy.identifier, enabled:list[index]?.enabled ?? true
                });
                save();
            }},
            { label:'Sao chép nội dung', disabled:!p.content,
                run:() => navigator.clipboard.writeText(p.content || '').catch(console.error) },
            { label:'Thêm lời nhắc bên dưới', run:() => create(id) },
            { label:'Xóa', disabled:!pm.isPromptDeletionAllowed(p), run:() => {
                if (!window.confirm('Xóa lời nhắc "' + p.name + '"?')) return;
                for (const group of pm.serviceSettings.prompt_order || []) {
                    group.order = (group.order || []).filter(item => item.identifier !== id);
                }
                pm.serviceSettings.prompts = pm.serviceSettings.prompts
                    .filter(item => item.identifier !== id);
                save();
            }}
        ], focus);
    }
    // The original edit form and validation remain authoritative.
    document.addEventListener('click', event => {
        const saveButton = event.target.closest('#completion_prompt_manager_popup_entry_form_save');
        if (saveButton && pendingNew) {
            const info = pendingNew;
            const id = saveButton.dataset.pmPrompt;
            pendingNew = null;
            setTimeout(() => {
                const pm = promptManager();
                const p = pm?.getPromptById(id);
                if (!p) return;
                pm.appendPrompt(p, pm.activeCharacter);
                const list = entries();
                const current = list.findIndex(item => item.identifier === id);
                if (current >= 0 && info.after) {
                    const [item] = list.splice(current, 1);
                    const index = list.findIndex(item => item.identifier === info.after);
                    list.splice(index < 0 ? list.length : index + 1, 0, item);
                }
                const ref = list.find(item => item.identifier === id);
                if (ref) ref.enabled = true;
                save();
            }, 0);
        }
        if (event.target.closest('#completion_prompt_manager_popup_entry_form_close')) {
            pendingNew = null;
        }
    });

    function render() {
        const pm = promptManager();
        if (!pm?.activeCharacter || !pm.serviceSettings) return;
        const list = get('st-ps-prompts');
        const focused = document.activeElement;
        const focusId = focused?.dataset?.presetPromptId;
        const focusSwitch = focused?.classList?.contains('st-ps-switch');
        list.replaceChildren();
        const move = get('st-ps-move');
        move.replaceChildren();
        if (moving) {
            move.append(make('span', 'Di chuyển lời nhắc'));
            move.append(action('Hủy di chuyển', () => {
                moving = ''; render();
            }));
        }
        for (const row of entries()) {
            const p = pm.getPromptById(row.identifier);
            if (!p || (filter === 'on' && !row.enabled) ||
                (filter === 'off' && row.enabled)) continue;
            const id = row.identifier;
            const article = make('article', '', 'st-ps-prompt');
            const header = make('div', '', 'st-ps-heading');
            const toggle = action(row.enabled ? 'Bật' : 'Tắt', () => {
                const original = nativePrompt(id);
                if (original) pm.handleToggle({ target: original });
            });
            toggle.className = 'st-ps-switch';
            toggle.dataset.presetPromptId = id;
            toggle.setAttribute('role','switch');
            toggle.setAttribute('aria-checked',String(!!row.enabled));
            toggle.setAttribute('aria-label','Bật lời nhắc ' + (p.name || 'Không tên'));
            toggle.disabled = !pm.isPromptToggleAllowed(p);
            const h = make('h3','');
            const title = action(p.name || 'Lời nhắc', () => {
                if (suppress) { suppress = false; return; }
                if (!moving) edit(id);
            });
            title.className = 'st-ps-title';
            title.dataset.presetPromptId = id;
            title.addEventListener('contextmenu', event => {
                event.preventDefault();
                clearTimeout(pressTimer);
                suppress = true;
                menu(id,title);
            });
            title.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                clearTimeout(pressTimer);
                pressTimer = setTimeout(() => {
                    suppress = true;
                    menu(id,title);
                }, 550);
            });
            for (const type of ['pointerup','pointercancel','pointerleave']) {
                title.addEventListener(type, () => clearTimeout(pressTimer));
            }
            h.append(title);
            header.append(toggle,h);
            article.append(header);
            article.append(make('div',p.content || '','st-ps-content'));
            if (moving && moving !== id) {
                const target = make('div','','st-ps-destinations');
                target.append(action('Đặt trước lời nhắc này',() => place(id,false)));
                target.append(action('Đặt sau lời nhắc này',() => place(id,true)));
                article.append(target);
            }
            if (moving === id) article.classList.add('st-ps-selected');
            list.append(article);
        }
        if (focusId) {
            const active = Array.from(list.querySelectorAll('[data-preset-prompt-id]'))
                .find(el => el.dataset.presetPromptId === focusId &&
                    el.classList.contains('st-ps-switch') === focusSwitch);
            if (active) active.focus({preventScroll:true});
        }
    }
    get('st-ps-filter').addEventListener('change', event => {
        filter = event.target.value;
        render();
    });
    get('st-ps-add').addEventListener('click', event => {
        popup('Thêm lời nhắc',[
            {label:'Tạo lời nhắc mới',run:() => create(null)},
            {label:'Chèn lời nhắc đã lưu',run:() => {
                const select = get('completion_prompt_manager_footer_append_prompt');
                if (!select) return;
                popup('Chèn lời nhắc đã lưu',Array.from(select.options).map(opt => ({
                    label:opt.textContent,run:() => {
                        select.value = opt.value;
                        promptManager().handleAppendPrompt();
                    }
                })),event.currentTarget);
            }}
        ],event.currentTarget);
    });
    get('st-ps-preview').addEventListener('click',async event => {
        const pm = promptManager();
        if (!pm) return;
        const control = event.currentTarget;
        control.disabled = true;
        try {
            // Dry run uses the upstream prompt assembly, not a fake concatenation.
            await pm.tryGenerate();
            const messages = pm.messages?.getCollection();
            const rendered = Array.isArray(messages)
                ? messages.map(x => String(x.role || 'system') + '\n' +
                    String(x.content || '')).join('\n\n')
                : '';
            const box = document.createElement('dialog');
            box.className = 'st-ps-popup st-ps-preview-dialog';
            box.setAttribute('aria-label','Xem trước lời nhắc gửi tới AI');
            box.append(make('h3','Xem trước lời nhắc gửi tới AI'));
            box.append(make('pre',rendered || 'Không có dữ liệu xem trước.'));
            box.append(action('Đóng',() => box.close()));
            box.addEventListener('close',() => {box.remove();control.focus();});
            document.body.append(box);
            box.showModal();
        } catch (error) {
            console.error('[Preset Studio] Preview error',error);
            window.alert('Không thể xem trước lời nhắc.');
        } finally { control.disabled = false; }
    });

    // Move the actual SillyTavern controls into the tab, never clone them.
    const configPanel = get('st-ps-config-panel');
    const range = get('range_block_openai');
    const advancedSettings = get('openai_settings');
    const rangeAnchor = document.createComment('Original sampler controls');
    const advancedAnchor = document.createComment('Original OpenAI settings');
    if (range) range.before(rangeAnchor);
    if (advancedSettings) advancedSettings.before(advancedAnchor);
    if (range) configPanel.append(range);
    if (advancedSettings) configPanel.append(advancedSettings);
    if (range && !range.dataset.studioGrouped) {
        range.dataset.studioGrouped = 'true';
        const native = Array.from(range.children);
        const group = (name, open) => {
            const details = document.createElement('details');
            details.className = 'st-ps-group';
            details.open = open;
            details.append(make('summary',name));
            range.append(details);
            return details;
        };
        const basic = group('Thông số cơ bản',true);
        const length = group('Độ dài phản hồi',false);
        const sampling = group('Sampling nâng cao',false);
        const generation = group('Điều khiển tạo văn bản',false);
        const advanced = group('Cấu hình nâng cao',false);
        native.forEach((node,index) => {
            const dest = [10,13,14].includes(index) ? basic :
                [0,1,2].includes(index) ? length :
                [11,12,15,16,17,20].includes(index) ? sampling :
                [3,4,9].includes(index) ? generation : advanced;
            dest.append(node);
        });
    }
    if (advancedSettings && !advancedSettings.dataset.studioGrouped) {
        advancedSettings.dataset.studioGrouped = 'true';
        const children = Array.from(advancedSettings.children);
        const reasoning = document.createElement('details');
        reasoning.className = 'st-ps-group';
        reasoning.append(make('summary','Reasoning'));
        const other = document.createElement('details');
        other.className = 'st-ps-group';
        other.append(make('summary','Cấu hình nâng cao'));
        advancedSettings.append(reasoning,other);
        for (const child of children) {
            other.append(child);
        }
        const general = children[0];
        if (general) {
            for (const node of Array.from(general.children)) {
                if (node.querySelector && (node.querySelector('#openai_reasoning_effort') ||
                    node.querySelector('#openai_show_thoughts') ||
                    node.querySelector('#openai_verbosity'))) {
                    reasoning.append(node);
                }
            }
        }
    }
    nativeList.parentElement.classList.add('st-ps-native-list');
    new MutationObserver(() => {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(render,120);
    }).observe(nativeList,{childList:true,subtree:true});
    function active() {
        const on = source.value === 'openai';
        if (on) {
            if (range && range.parentNode !== configPanel) configPanel.append(range);
            if (advancedSettings && advancedSettings.parentNode !== configPanel) configPanel.append(advancedSettings);
        } else {
            if (range && rangeAnchor.parentNode) rangeAnchor.after(range);
            if (advancedSettings && advancedAnchor.parentNode) advancedAnchor.after(advancedSettings);
        }
        area.classList.toggle('st-ps-active',on);
        get('left-nav-panel')?.classList.toggle('st-ps-drawer-active', on);
        area.classList.toggle('st-ps-show-prompts',on && tab === 'prompts');
        ui.hidden = !on;
        if (on) {syncPresets();render();}
    }
    source.addEventListener('change',() => setTimeout(active,0));
    // The shell appears synchronously even if the ES module takes time to load.
    active();
    showTab('config');
    const moduleUrl = new URL('scripts/openai.js', document.baseURI).href;
    import(moduleUrl).then(module => {
        api = module;
        if (source.value === 'openai') render();
    }).catch(err => {
        console.error('[Preset Studio] Unable to import native PromptManager',err);
        const error = make('p','Không thể tải Prompt Manager. Vui lòng tải lại trang.');
        error.setAttribute('role','alert');
        get('st-ps-prompts').append(error);
    });
})();