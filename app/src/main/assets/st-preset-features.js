/* Android Preset Studio enhancements. Never creates an alternate preset store. */
(() => {
    'use strict';
    if (window.__stPresetFeaturesInstalled) return;
    const root = document.getElementById('st-preset-studio');
    const configPanel = document.getElementById('st-ps-config-panel');
    const previewButton = document.getElementById('st-ps-preview');
    const editor = document.getElementById('completion_prompt_manager_popup');
    if (!root || !configPanel || !previewButton) return;
    window.__stPresetFeaturesInstalled = true;

    const byId = id => document.getElementById(id);
    const el = (tag, label, className) => {
        const node = document.createElement(tag);
        if (label !== undefined) node.textContent = label;
        if (className) node.className = className;
        return node;
    };
    const btn = (label, onClick) => {
        const node = el('button', label);
        node.type = 'button';
        node.addEventListener('click', onClick);
        return node;
    };
    const bridgeUrl = new URL('scripts/openai.js', document.baseURI).href;
    let nativeApiPromise;
    const nativeApi = () => nativeApiPromise ||= import(bridgeUrl);
    const presetSelector = byId('settings_preset_openai');

    // Logit Bias presets are independent of Chat Completion presets.
    const logitTitle = byId('logit_bias_openai');
    const advanced = Array.from(byId('openai_settings')?.querySelectorAll(':scope > details.st-ps-group') || [])
        .find(node => node.querySelector('summary')?.textContent?.trim() === 'Cấu hình nâng cao');
    const logitBlock = logitTitle?.closest('.range-block');
    if (advanced && logitBlock) {
        const logitGroup = el('details', undefined, 'st-ps-group');
        logitGroup.id = 'st-ps-logit-bias';
        logitGroup.append(el('summary', 'Logit Bias'));
        advanced.append(logitGroup);
        logitGroup.append(logitBlock);
        const biasActions = {
            openai_logit_bias_new_preset: 'Tạo bộ Logit Bias',
            openai_logit_bias_import_preset: 'Nhập bộ Logit Bias',
            openai_logit_bias_export_preset: 'Xuất bộ Logit Bias',
            openai_logit_bias_delete_preset: 'Xóa bộ Logit Bias',
        };
        for (const [id, label] of Object.entries(biasActions)) {
            const icon = byId(id);
            if (!icon) continue;
            icon.title = label;
            icon.setAttribute('aria-label', label);
            icon.setAttribute('role', 'button');
            icon.tabIndex = 0;
            icon.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    icon.click();
                }
            });
        }
    }

    // 'extensions' is the native JSON object on the selected preset.
    if (advanced) {
        const jsonGroup = el('details', undefined, 'st-ps-group');
        jsonGroup.id = 'st-ps-extensions';
        jsonGroup.append(el('summary', 'Extensions JSON'));
        const edit = btn('Chỉnh sửa JSON', async () => {
            edit.disabled = true;
            try {
                const api = await nativeApi();
                if (typeof api.stAndroidGetPresetExtensions !== 'function' ||
                    typeof api.stAndroidSavePresetExtensions !== 'function') {
                    throw new Error('Native Preset extensions adapter unavailable');
                }
                const value = await api.stAndroidGetPresetExtensions();
                const dialog = el('dialog', undefined, 'st-ps-popup st-ps-json-dialog');
                dialog.setAttribute('aria-label', 'Extensions JSON');
                const heading = el('h3', 'Extensions JSON');
                heading.setAttribute('aria-hidden','true');
                dialog.append(heading);
                const input = el('textarea');
                input.setAttribute('aria-label', 'Nội dung JSON');
                input.spellcheck = false;
                input.rows = 12;
                input.value = JSON.stringify(value, null, 2);
                dialog.append(input);
                const notice = el('p', '', 'st-ps-error');
                notice.setAttribute('role', 'alert');
                dialog.append(notice);
                const save = btn('Lưu', async () => {
                    let data;
                    try {
                        data = JSON.parse(input.value);
                        if (data === null || Array.isArray(data) || typeof data !== 'object') {
                            throw new Error('Extensions JSON phải là một đối tượng JSON.');
                        }
                    } catch (error) {
                        notice.textContent = error instanceof SyntaxError ?
                            'JSON không hợp lệ. Hãy kiểm tra cú pháp.' : error.message;
                        return;
                    }
                    save.disabled = true;
                    try {
                        await api.stAndroidSavePresetExtensions(data);
                        dialog.close();
                    } catch (error) {
                        console.error('[Preset Studio] Extensions JSON save error', error);
                        notice.textContent = 'Không thể lưu Extensions JSON.';
                        save.disabled = false;
                    }
                });
                dialog.append(save, btn('Hủy', () => dialog.close()));
                dialog.addEventListener('close', () => { dialog.remove(); edit.focus(); });
                document.body.append(dialog);
                dialog.showModal();
                input.focus();
            } catch (error) {
                console.error('[Preset Studio] Extensions JSON load error', error);
                window.alert('Không thể mở Extensions JSON.');
            } finally {
                edit.disabled = false;
            }
        });
        jsonGroup.append(edit);
        advanced.append(jsonGroup);
    }

    // Render EXACTLY ONE section and one heading for every native outgoing
    // Message, regardless of length. A MessageCollection contains grouped
    // message sources, but it is NOT itself an outgoing prompt. Do not add
    // extra group entries or split one message into fake "part" prompts.
    const sourceTitles = {
        main:'Lời nhắc chính', nsfw:'Lời nhắc NSFW',
        jailbreak:'Lời nhắc bổ sung', enhanceDefinitions:'Hướng dẫn mở rộng',
        worldInfoBefore:'Lorebook trước nhân vật',
        worldInfoAfter:'Lorebook sau nhân vật',
        charDescription:'Mô tả nhân vật', charPersonality:'Tính cách nhân vật',
        scenario:'Kịch bản', personaDescription:'Mô tả người dùng',
        dialogueExamples:'Ví dụ hội thoại', chatHistory:'Lịch sử trò chuyện',
        controlPrompts:'Lời nhắc điều khiển', quietPrompt:'Lời nhắc phụ',
        continueNudge:'Lời nhắc tiếp tục', groupNudge:'Lời nhắc nhóm',
        impersonate:'Nhập vai người dùng', newMainChat:'Bắt đầu cuộc trò chuyện',
        newChat:'Bắt đầu ví dụ hội thoại',
    };
    const roles = {
        system:'Hệ thống', developer:'Nhà phát triển',
        user:'Người dùng', assistant:'Trợ lý', tool:'Công cụ',
    };
    function sourceName(identifier, pm) {
        const id=String(identifier || '').trim();
        if (!id) return '';
        return sourceTitles[id] || pm?.getPromptById?.(id)?.name || id;
    }
    function collectOutgoingPrompts(node, output = [], context = [], depth = 0) {
        if (!node || depth > 100) return output;
        if (Array.isArray(node)) {
            for (const child of node) collectOutgoingPrompts(child,output,context,depth+1);
            return output;
        }
        const children = typeof node.getCollection === 'function'
            ? node.getCollection()
            : Array.isArray(node.collection) ? node.collection : null;
        if (children) {
            const identifier=String(node.identifier || '').trim();
            const path=identifier && identifier !== 'root'
                ? context.concat(identifier) : context;
            collectOutgoingPrompts(children,output,path,depth+1);
        } else if (typeof node.role === 'string' &&
            (node.content || node.tool_calls?.length || node.reasoning)) {
            output.push({message:node,source:context});
        }
        return output;
    }
    function renderOutgoingPrompts(prompts, container, pm) {
        prompts.forEach(({message:msg,source},index) => {
            const item=el('section',undefined,'st-ps-preview-message');
            item.dataset.outgoingPrompt=String(index+1);
            const role=roles[msg.role] || msg.role;
            const ownSource=sourceName(msg.identifier,pm);
            const ancestorSource=source.slice().reverse()
                .map(name=>sourceName(name,pm)).find(Boolean);
            const name=ownSource || ancestorSource;
            // No extra group headings, so N native outgoing messages have
            // exactly N navigable headings, even if one is thousands of words.
            const heading='Lời nhắc '+(index+1)+(name?' · '+name:'')+' · '+role;
            item.append(el('h4',heading));
            const body=printContent(msg.content);
            if (body) item.append(el('pre',body));
            if (msg.tool_calls?.length) {
                item.append(el('pre',JSON.stringify(msg.tool_calls,null,2)));
            }
            if (typeof msg.reasoning==='string' && msg.reasoning) {
                item.append(el('pre',msg.reasoning));
            }
            container.append(item);
        });
    }
    function printContent(content) {
        if (typeof content === 'string') return content;
        if (!Array.isArray(content)) return content?.text || '';
        return content.map(item => {
            if (typeof item === 'string') return item;
            if (typeof item?.text === 'string') return item.text;
            if (item?.type?.includes('image')) return '[Hình ảnh]';
            if (item?.type?.includes('audio')) return '[Âm thanh]';
            if (item?.type?.includes('video')) return '[Video]';
            return '[Nội dung đa phương thức]';
        }).filter(Boolean).join('\n');
    }
    previewButton.addEventListener('click', async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        previewButton.disabled = true;
        try {
            const pm = (await nativeApi()).promptManager;
            if (!pm) throw new Error('Prompt Manager unavailable');
            await pm.tryGenerate(); // Original SillyTavern dry-run, never sends to AI.
            const outgoing = collectOutgoingPrompts(pm.messages);
            const dialog = el('dialog', undefined, 'st-ps-popup st-ps-preview-dialog');
            dialog.setAttribute('aria-label', 'Xem trước lời nhắc gửi tới AI');
            const heading = el('h3', 'Xem trước lời nhắc gửi tới AI');
            heading.setAttribute('aria-hidden','true');
            dialog.append(heading);
            const content = el('div', undefined, 'st-ps-assembled-preview');
            if (pm.error) {
                const warning = el('p', String(pm.error), 'st-ps-error');
                warning.setAttribute('role', 'alert');
                content.append(warning);
            }
            if (!outgoing.length) content.append(el('p', 'Không có thông điệp nào để xem trước.'));
            renderOutgoingPrompts(outgoing,content,pm);
            dialog.append(content, btn('Đóng', () => dialog.close()));
            dialog.addEventListener('close', () => { dialog.remove(); previewButton.focus(); });
            document.body.append(dialog);
            dialog.showModal();
        } catch (error) {
            console.error('[Preset Studio] Preview error', error);
            window.alert('Không thể xem trước lời nhắc.');
        } finally {
            previewButton.disabled = false;
        }
    }, { capture: true });

    // Localize interface text only. Never translate the user's prompt text.
    const translations = {
        'Inspect': 'Xem nội dung', 'Edit': 'Chỉnh sửa',
        'Prompt List': 'Danh sách lời nhắc',
        'The list of prompts associated with this marker.': 'Các lời nhắc thuộc mục đánh dấu này.',
        'Name': 'Tên', 'A name for this prompt.': 'Tên của lời nhắc.',
        'Role': 'Vai trò', 'To whom this message will be attributed.': 'Vai trò của thông điệp này.',
        'Triggers': 'Điều kiện kích hoạt',
        'Filter to specific generation types.': 'Chỉ áp dụng cho những kiểu tạo phản hồi được chọn.',
        'Position': 'Vị trí', 'Relative': 'Tương đối', 'In-chat': 'Trong cuộc trò chuyện',
        'Relative (to other prompts in prompt manager) or In-chat @ Depth.':
            'Đặt tương đối so với các lời nhắc khác hoặc chèn vào cuộc trò chuyện tại độ sâu đã chọn.',
        'Depth': 'Độ sâu',
        '0 = after the last message, 1 = before the last message, etc.':
            '0 = sau tin nhắn cuối, 1 = trước tin nhắn cuối, v.v.',
        'Order': 'Thứ tự',
        'Ordered from low/top to high/bottom, and at same order: Assistant, User, System.':
            'Sắp xếp theo thứ tự tăng dần; nếu bằng nhau: Trợ lý, Người dùng, Hệ thống.',
        "Prompt injections from other sources (World Info, Author's Note, etc.) always have a default order of 100.":
            'Lời nhắc từ nguồn khác (World Info, Ghi chú tác giả, v.v.) mặc định có thứ tự 100.',
        'Prompt': 'Nội dung lời nhắc', 'Forbid Overrides': 'Không cho phép ghi đè',
        'This prompt cannot be overridden by character cards, even if overrides are preferred.':
            'Thẻ nhân vật không được phép ghi đè lời nhắc này.',
        'Close': 'Đóng', 'Reset': 'Đặt lại', 'Save': 'Lưu',
        'Normal': 'Bình thường', 'Continue': 'Tiếp tục',
        'Impersonate': 'Nhập vai người dùng', 'Swipe': 'Đổi phản hồi',
        'Regenerate': 'Tạo lại', 'Quiet': 'Không hiển thị',
        'User': 'Người dùng', 'Assistant': 'Trợ lý', 'System': 'Hệ thống',
    };
    function translatePromptEditor() {
        if (!editor) return;
        const selector = 'h3, label span, option, .text_muted, [title]';
        for (const node of editor.querySelectorAll(selector)) {
            if (!node.children.length) {
                const original = node.textContent.trim();
                if (Object.hasOwn(translations, original) && node.textContent !== translations[original]) {
                    node.textContent = translations[original];
                }
            }
            const title = node.getAttribute('title');
            if (title && Object.hasOwn(translations, title)) {
                node.setAttribute('title', translations[title]);
                if (node.matches('button,a,input,select,textarea,.menu_button,.right_menu_button,[role="button"]') &&
                    !node.getAttribute('aria-label')) {
                    node.setAttribute('aria-label', translations[title]);
                }
            }
        }
    }
    translatePromptEditor();
    if (editor) {
        let translationTimer;
        new MutationObserver(() => {
            clearTimeout(translationTimer);
            translationTimer = setTimeout(translatePromptEditor, 25);
        }).observe(editor, { childList: true, subtree: true });
    }
})();