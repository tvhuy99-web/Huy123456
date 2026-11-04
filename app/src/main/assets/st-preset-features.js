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
                input.setAttribute('aria-label', 'Extensions JSON');
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

    // Native MessageCollection is a tree, not a flat message list.
    function collectMessages(node, output = [], depth = 0) {
        if (!node || depth > 50) return output;
        if (Array.isArray(node)) {
            for (const child of node) collectMessages(child, output, depth + 1);
        } else if (typeof node.getCollection === 'function') {
            collectMessages(node.getCollection(), output, depth + 1);
        } else if (typeof node === 'object' && Array.isArray(node.collection)) {
            collectMessages(node.collection, output, depth + 1);
        } else if (typeof node === 'object' && typeof node.role === 'string') {
            if (node.content || node.tool_calls?.length) output.push(node);
        }
        return output;
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
    const roles = {
        system: 'Hệ thống', developer: 'Nhà phát triển',
        user: 'Người dùng', assistant: 'Trợ lý', tool: 'Công cụ',
    };
    previewButton.addEventListener('click', async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        previewButton.disabled = true;
        try {
            const pm = (await nativeApi()).promptManager;
            if (!pm) throw new Error('Prompt Manager unavailable');
            await pm.tryGenerate(); // Original SillyTavern dry-run, never sends to AI.
            const messages = collectMessages(pm.messages);
            const dialog = el('dialog', undefined, 'st-ps-popup st-ps-preview-dialog');
            dialog.setAttribute('aria-label', 'Xem trước lời nhắc gửi tới AI');
            dialog.append(el('h3', 'Xem trước lời nhắc gửi tới AI'));
            const content = el('div', undefined, 'st-ps-assembled-preview');
            if (pm.error) {
                const warning = el('p', String(pm.error), 'st-ps-error');
                warning.setAttribute('role', 'alert');
                content.append(warning);
            }
            if (!messages.length) content.append(el('p', 'Không có thông điệp nào để xem trước.'));
            for (const msg of messages) {
                const item = el('section', undefined, 'st-ps-preview-message');
                item.append(el('h4', roles[msg.role] || msg.role));
                const contentText = printContent(msg.content) ||
                    (msg.tool_calls?.length ? '[Lời gọi công cụ]' : '');
                item.append(el('pre', contentText));
                content.append(item);
            }
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
                if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', translations[title]);
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