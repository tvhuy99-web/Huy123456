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

    // SillyTavern's MessageCollection is a hierarchy, with identifiers
    // such as main, charDescription, worldInfoBefore, dialogueExamples and
    // chatHistory. Never flatten it: each source must remain navigable.
    function collectMessageTree(node, depth = 0) {
        if (!node || depth > 50) return [];
        if (Array.isArray(node)) {
            return node.flatMap(child => collectMessageTree(child, depth + 1));
        }
        const children = typeof node.getCollection === 'function'
            ? node.getCollection()
            : Array.isArray(node.collection) ? node.collection : null;
        if (children) {
            const items = collectMessageTree(children, depth + 1);
            if (!items.length) return [];
            // "root" is only an implementation wrapper, not a prompt source.
            if (!node.identifier || node.identifier === 'root') return items;
            return [{ kind:'group', identifier:String(node.identifier), items }];
        }
        if (typeof node.role === 'string' &&
            (node.content || node.tool_calls?.length || node.reasoning)) {
            return [{ kind:'message', message:node }];
        }
        return [];
    }
    const sourceTitles = {
        main:'Lời nhắc chính', nsfw:'Lời nhắc NSFW',
        jailbreak:'Lời nhắc bổ sung', enhanceDefinitions:'Hướng dẫn mở rộng',
        worldInfoBefore:'Lorebook trước nhân vật',
        worldInfoAfter:'Lorebook sau nhân vật',
        charDescription:'Mô tả nhân vật',
        charPersonality:'Tính cách nhân vật',
        scenario:'Kịch bản', personaDescription:'Mô tả người dùng',
        dialogueExamples:'Ví dụ hội thoại',
        chatHistory:'Lịch sử trò chuyện',
        controlPrompts:'Lời nhắc điều khiển',
        quietPrompt:'Lời nhắc phụ', continueNudge:'Lời nhắc tiếp tục',
        groupNudge:'Lời nhắc nhóm', impersonate:'Nhập vai người dùng',
        newMainChat:'Bắt đầu cuộc trò chuyện',
        newChat:'Bắt đầu ví dụ hội thoại',
    };
    function sourceName(identifier, pm) {
        const id = String(identifier || '').trim();
        if (!id) return '';
        return sourceTitles[id] || pm?.getPromptById?.(id)?.name || id;
    }
    // Preserve ALL rendered characters, including original spacing. Split
    // long paragraphs at readable boundaries so one several-thousand-word
    // message is not a single giant TalkBack element.
    function splitText(text) {
        if (text.length <= 500) return [text];
        const tokens = text.split(/(\n[ \t]*\n+)/);
        const paragraphs = [];
        for (let i=0;i<tokens.length;i+=2) {
            const chunk = tokens[i] + (tokens[i+1] || '');
            if (chunk) paragraphs.push(chunk);
        }
        const pieces = [];
        for (const paragraph of paragraphs) {
            if (paragraph.length <= 850) {
                pieces.push(paragraph);
                continue;
            }
            let rest = paragraph;
            while (rest.length > 850) {
                let cut = Math.max(rest.lastIndexOf('\n', 850),rest.lastIndexOf(' ',850));
                if (cut < 400) cut = 850;
                else cut += 1;
                pieces.push(rest.slice(0,cut));
                rest = rest.slice(cut);
            }
            if (rest) pieces.push(rest);
        }
        return pieces.length ? pieces : [text];
    }
    function renderAssembledTree(tree, target, pm) {
        const rolesByName = {
            system:'Hệ thống', developer:'Nhà phát triển',
            user:'Người dùng', assistant:'Trợ lý', tool:'Công cụ',
        };
        let sequence = 0;
        let groupSequence = 0;
        const addHeading = (parent, level, title) => {
            const heading = el('h'+Math.min(6,Math.max(4,level)),title);
            parent.append(heading);
        };
        const showMessage = (node, parent, depth, owner, oneInGroup) => {
            const msg = node.message;
            const role = rolesByName[msg.role] || msg.role;
            const identifier = sourceName(msg.identifier,pm);
            if (!oneInGroup || (msg.identifier && msg.identifier !== owner)) {
                const label = identifier && msg.identifier !== owner
                    ? identifier + ' · ' + role
                    : 'Thông điệp ' + (++sequence) + ' · ' + role;
                addHeading(parent,depth,label);
            } else {
                const descriptor = el('p','Vai trò: '+role,'st-ps-preview-role');
                parent.append(descriptor);
            }
            const contentText = printContent(msg.content);
            const extra = msg.tool_calls?.length
                ? JSON.stringify(msg.tool_calls,null,2) : '';
            const raw = contentText || (extra ? '[Lời gọi công cụ]' : '');
            const pieces = splitText(raw);
            if (pieces.length > 1) {
                pieces.forEach((part,index) => {
                    const piece = el('section',undefined,'st-ps-preview-part');
                    addHeading(piece,depth+1,'Phần '+(index+1));
                    piece.append(el('pre',part));
                    parent.append(piece);
                });
            } else if (raw) {
                parent.append(el('pre',raw));
            }
            if (extra) {
                const tools = el('section',undefined,'st-ps-preview-part');
                addHeading(tools,depth+1,'Lời gọi công cụ');
                tools.append(el('pre',extra));
                parent.append(tools);
            }
            if (typeof msg.reasoning==='string' && msg.reasoning) {
                const reasoning=el('section',undefined,'st-ps-preview-part');
                addHeading(reasoning,depth+1,'Nội dung suy luận được gửi');
                reasoning.append(el('pre',msg.reasoning));
                parent.append(reasoning);
            }
        };
        const visit = (node,parent,depth,owner='') => {
            if (node.kind==='message') {
                showMessage(node,parent,depth,owner,false);
                return;
            }
            const group=el('section',undefined,'st-ps-preview-group');
            const label=sourceName(node.identifier,pm) || 'Nhóm '+(++groupSequence);
            addHeading(group,depth,label);
            const justOneMessage=node.items.length===1 && node.items[0].kind==='message';
            for (const child of node.items) {
                if (justOneMessage) {
                    showMessage(child,group,depth+1,node.identifier,true);
                } else {
                    visit(child,group,depth+1,node.identifier);
                }
            }
            parent.append(group);
        };
        for (const item of tree) visit(item,target,4);
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
            const tree = collectMessageTree(pm.messages);
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
            if (!tree.length) content.append(el('p', 'Không có thông điệp nào để xem trước.'));
            renderAssembledTree(tree,content,pm);
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