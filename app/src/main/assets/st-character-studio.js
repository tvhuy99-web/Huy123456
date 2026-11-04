/*
 * SillyTavern 1.19.0 Android Character Studio.
 * Presentation-only integration: all native character/group objects,
 * jQuery handlers, chat DOM, composer and extension event hooks stay intact.
 */
(() => {
    'use strict';
    if (window.__stCharacterStudioMounted) return;

    const byId = id => document.getElementById(id);
    const make = (tag, value, cls) => {
        const node = document.createElement(tag);
        if (value !== undefined) node.textContent = value;
        if (cls) node.className = cls;
        return node;
    };
    const button = (title, fn, cls) => {
        const node = make('button', title, cls);
        node.type = 'button';
        node.addEventListener('click', fn);
        return node;
    };

    function initialize() {
        if (window.__stCharacterStudioMounted) return true;
        const listPanel = byId('rm_characters_block');
        const fixedTop = byId('charListFixedTop');
        const nativeList = byId('rm_print_characters_block');
        const sort = byId('character_sort_order');
        const searchBlock = byId('form_character_search_form');
        const search = byId('character_search_bar');
        const chatShell = byId('sheld');
        const chat = byId('chat');
        const originalPanel = byId('right-nav-panel');
        const createForm = byId('form_create');
        if (![listPanel, fixedTop, nativeList, sort, searchBlock,
            search, chatShell, chat, originalPanel, createForm].every(Boolean)) return false;
        window.__stCharacterStudioMounted = true;

        // Only move native sort and search controls (and keep their IDs and
        // event handlers). Never move the chat or the character editor.
        const toolbar = make('section', undefined, 'st-cs-toolbar');
        toolbar.id = 'st-character-toolbar';
        const heading = make('h2', 'Nhân vật');
        const more = button('Tùy chọn khác', openMore);
        more.id = 'st-cs-more';
        const sortLabel = make('label', 'Thứ tự sắp xếp nhân vật');
        sortLabel.htmlFor = 'character_sort_order';
        sortLabel.className = 'st-cs-label';
        search.placeholder = 'Tìm kiếm nhân vật';
        search.setAttribute('aria-label', 'Tìm kiếm nhân vật');
        searchBlock.classList.add('st-cs-search');
        for (const option of Array.from(sort.options)) {
            const labels = {
                'name:asc':'A-Z', 'name:desc':'Z-A',
                'create_date:desc':'Mới nhất', 'create_date:asc':'Cũ nhất',
                'fav:desc':'Yêu thích', 'date_last_chat:desc':'Gần đây',
                'chat_size:desc':'Nhiều cuộc trò chuyện nhất',
                'chat_size:asc':'Ít cuộc trò chuyện nhất',
                'data_size:desc':'Nhiều token nhất',
                'data_size:asc':'Ít token nhất',
                'name:random':'Ngẫu nhiên',
                'search:desc':'Theo tìm kiếm',
            };
            const key = option.dataset.field + ':' + option.dataset.order;
            if (labels[key]) {
                option.textContent = labels[key];
                // Prevent SillyTavern's general locale refresh from
                // relabeling this Android-specific presentation.
                option.removeAttribute('data-i18n');
            }
        }
        toolbar.append(heading, more, sortLabel, sort, searchBlock);
        fixedTop.prepend(toolbar);
        listPanel.classList.add('st-cs-enabled');

        // Native list items stay the native live nodes. Only add accessible
        // roles to their existing name spans and support long-press actions.
        function prepareNativeCards() {
            for (const card of nativeList.querySelectorAll('.character_select[data-chid]')) {
                if (card.dataset.stCsReady) continue;
                card.dataset.stCsReady = '1';
                card.setAttribute('role', 'button');
                card.tabIndex = 0;
                const name = card.querySelector('.ch_name');
                const label = name?.textContent?.trim() || 'Nhân vật';
                card.setAttribute('aria-label', 'Mở trò chuyện với ' + label);
                if (name) {
                    name.setAttribute('role', 'heading');
                    name.setAttribute('aria-level', '3');
                }
                card.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        card.click();
                    }
                });
            }
        }
        prepareNativeCards();
        let cardRefresh;
        new MutationObserver(() => {
            clearTimeout(cardRefresh);
            cardRefresh = setTimeout(prepareNativeCards, 60);
        }).observe(nativeList, { childList:true, subtree:true });

        // Keep original bulk edit, tag filters and extension-added toolbar
        // slots mounted. These actions are reachable in the compact menu.
        function nativeClick(id) {
            const target = byId(id);
            if (!target) {
                console.warn('[Character Studio] Native action unavailable:', id);
                return;
            }
            target.click();
        }
        function popup(title, choices, focus) {
            const dialog = make('dialog', undefined, 'st-cs-dialog');
            dialog.setAttribute('aria-label', title);
            dialog.append(make('h3', title));
            for (const item of choices) {
                dialog.append(button(item.label, () => {
                    dialog.close();
                    item.run();
                }));
            }
            dialog.append(button('Đóng', () => dialog.close()));
            dialog.addEventListener('close', () => {
                dialog.remove();
                if (focus?.isConnected) focus.focus();
            });
            document.body.append(dialog);
            dialog.showModal();
        }
        function openMore() {
            popup('Tùy chọn nhân vật', [
                {label:'Tạo nhân vật mới',run:()=>nativeClick('rm_button_create')},
                {label:'Nhập thẻ nhân vật',run:()=>nativeClick('character_import_button')},
                {label:'Nhập nhân vật từ URL',run:()=>nativeClick('external_import_button')},
                {label:'Tạo nhóm chat mới',run:()=>nativeClick('rm_button_group_chats')},
                {label:'Chỉnh sửa nhiều nhân vật',run:()=>nativeClick('bulkEditButton')},
                {label:'Đổi kiểu hiển thị',run:()=>nativeClick('charListGridToggle')},
            ], more);
        }

        // Two-tab navigation; the actual chat remains in #sheld and the
        // actual edit form remains in #right-nav-panel for extensions.
        const tabs = make('section', undefined, 'st-cs-tabs');
        tabs.id = 'st-character-tabs';
        tabs.hidden = true;
        const activeName = make('h2','');
        activeName.id = 'st-cs-active-name';
        const tabRow = make('div',undefined,'st-cs-tab-row');
        tabRow.setAttribute('role','tablist');
        tabRow.setAttribute('aria-label','Nhân vật đang chọn');
        const chatButton = button('Trò chuyện',()=>setView('chat'));
        const editButton = button('Chỉnh sửa',()=>setView('edit'));
        chatButton.id = 'st-cs-tab-chat';
        editButton.id = 'st-cs-tab-edit';
        for (const [node,which] of [[chatButton,'chat'],[editButton,'edit']]) {
            node.setAttribute('role','tab');
            node.setAttribute('aria-controls',which === 'chat' ? 'chat' : 'rm_ch_create_block');
        }
        tabRow.append(chatButton,editButton);
        tabs.append(activeName,tabRow);
        chat.before(tabs);

        // Mobile right drawer overlays the chat header. Mirror only the
        // navigation controls within the native drawer, not the chat/editor.
        const drawerTabs = make('section',undefined,'st-cs-drawer-tabs');
        drawerTabs.id = 'st-cs-drawer-tabs';
        drawerTabs.hidden = true;
        const drawerName = make('h2','');
        const drawerRow = make('div',undefined,'st-cs-tab-row');
        drawerRow.setAttribute('role','tablist');
        drawerRow.setAttribute('aria-label','Chế độ nhân vật');
        const drawerChat = button('Trò chuyện',()=>setView('chat'));
        const drawerEdit = button('Chỉnh sửa',()=>setView('edit'));
        drawerChat.id='st-cs-drawer-tab-chat';
        drawerEdit.id='st-cs-drawer-tab-edit';
        for (const node of [drawerChat,drawerEdit]) node.setAttribute('role','tab');
        drawerRow.append(drawerChat,drawerEdit);
        drawerTabs.append(drawerName,drawerRow);
        originalPanel.insertBefore(drawerTabs,byId('rm_PinAndTabs'));

        const editorMenu = make('div',undefined,'st-cs-editor-menu');
        editorMenu.id = 'st-cs-editor-menu';
        editorMenu.hidden = true;
        const editorOptions = button('Tùy chọn khác', () => {
            const id = currentCharacterId();
            if (id === null) return;
            popup(selectedCharacterName(), characterMenuItems(id), editorOptions);
        });
        editorOptions.id = 'st-cs-editor-options';
        editorMenu.append(editorOptions);
        drawerTabs.after(editorMenu);

        // Moving the original live form controls preserves field values,
        // native listeners and extension hooks. Restore their exact DOM
        // positions outside the compact character editor.
        const compactIds = [
            'spoiler_free_desc', 'descriptionWrapper', 'tags_div',
            'scenario_div', 'depth_prompt_div', 'character_popup'
        ];
        const nativePositions = new Map();
        for (const id of compactIds) {
            const node = byId(id);
            if (!node?.parentNode) continue;
            const marker = document.createComment('native position: ' + id);
            node.parentNode.insertBefore(marker,node);
            nativePositions.set(id,{node,marker});
        }
        const extraButton = button('Hiển thị thêm', () => {
            const expanded = extraFields.hidden;
            extraFields.hidden = !expanded;
            extraButton.textContent = expanded ? 'Thu gọn' : 'Hiển thị thêm';
            extraButton.setAttribute('aria-expanded',String(expanded));
            document.body.classList.toggle('st-cs-more-open', expanded);
        },'st-cs-extra-toggle');
        extraButton.id = 'st-cs-extra-toggle';
        extraButton.hidden = true;
        extraButton.setAttribute('aria-controls','st-cs-extra-fields');
        extraButton.setAttribute('aria-expanded','false');
        const extraFields = make('div',undefined,'st-cs-extra-fields');
        extraFields.id = 'st-cs-extra-fields';
        extraFields.hidden = true;
        const hiddenFormFields = byId('hidden-divs');
        if (hiddenFormFields) {
            createForm.insertBefore(extraButton, hiddenFormFields);
            createForm.insertBefore(extraFields, hiddenFormFields);
        }
        let compactActive = false;
        function setCompactEditor(active) {
            if (active === compactActive) return;
            if (active) {
                if (!hiddenFormFields || nativePositions.size !== compactIds.length) return;
                for (const id of ['scenario_div','depth_prompt_div']) {
                    createForm.insertBefore(nativePositions.get(id).node,extraButton);
                }
                for (const id of ['spoiler_free_desc','descriptionWrapper','tags_div',
                    'character_popup']) {
                    extraFields.append(nativePositions.get(id).node);
                }
                extraButton.hidden = false;
                extraFields.hidden = true;
                extraButton.textContent = 'Hiển thị thêm';
                extraButton.setAttribute('aria-expanded','false');
            } else {
                for (const id of compactIds) {
                    const item = nativePositions.get(id);
                    if (item?.marker.parentNode) item.marker.after(item.node);
                }
                extraButton.hidden = true;
                extraFields.hidden = true;
                extraButton.setAttribute('aria-expanded','false');
                document.body.classList.remove('st-cs-more-open');
            }
            compactActive = active;
        }

        let scriptApi = null;
        let groupApi = null;
        let selectedView = 'chat';
        let nativeActionsPending = false;
        let longPressed = false;
        let pressTimer = null;
        let cancelledClickTimer = null;
        // Leave native group cards in place. They use a separate
        // selection and editing path from individual characters.
        const decorateGroups = () => {
            for (const card of nativeList.querySelectorAll('.group_select')) {
                if (card.dataset.stCsReady) continue;
                card.dataset.stCsReady = '1';
                card.tabIndex = 0;
                card.setAttribute('role','button');
                card.setAttribute('aria-label','Mở nhóm chat ' +
                    (card.querySelector('.ch_name')?.textContent?.trim() || ''));
                card.addEventListener('keydown',event=>{
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();card.click();
                    }
                });
            }
        };
        decorateGroups();
        new MutationObserver(decorateGroups).observe(nativeList,{childList:true});

        function isDrawerClosed() {
            return originalPanel.classList.contains('closedDrawer') &&
                !originalPanel.classList.contains('openDrawer');
        }
        function closeDrawer() {
            if (!isDrawerClosed()) byId('rightNavDrawerIcon')?.click();
        }
        function openDrawer() {
            if (isDrawerClosed()) byId('rightNavDrawerIcon')?.click();
        }
        function currentCharacterId() {
            const id = Number(scriptApi?.this_chid);
            return scriptApi?.this_chid !== undefined &&
                scriptApi?.this_chid !== null &&
                Number.isInteger(id) && scriptApi?.characters?.[id] ? id : null;
        }
        function selectedCharacterName() {
            if (!scriptApi) return '';
            const ch = scriptApi.this_chid;
            if (ch !== undefined && ch !== null && scriptApi.characters?.[ch]) {
                return scriptApi.characters[ch].name || '';
            }
            if (groupApi?.selected_group) {
                const group = groupApi.groups?.find(item => String(item.id) === String(groupApi.selected_group));
                return group?.name || document.querySelector('#rm_button_selected_ch h2')?.textContent?.trim() || 'Nhóm chat';
            }
            return '';
        }
        function syncSelected() {
            const name = selectedCharacterName();
            activeName.textContent = name;
            drawerName.textContent = name;
            tabs.hidden = !name;
            drawerTabs.hidden = !name;
            editorMenu.hidden = currentCharacterId() === null;
            if (name) {
                chatButton.setAttribute('aria-label','Trò chuyện với ' + name);
                editButton.setAttribute('aria-label','Chỉnh sửa ' + name);
            }
        }
        function setView(view, {fromCard = false} = {}) {
            selectedView = view;
            syncSelected();
            const compact = view === 'edit' && currentCharacterId() !== null;
            setCompactEditor(compact);
            document.body.classList.toggle('st-cs-editing',compact);
            for (const [node,which] of [[chatButton,'chat'],[editButton,'edit'],
                [drawerChat,'chat'],[drawerEdit,'edit']]) {
                node.setAttribute('aria-selected', String(view === which));
                node.tabIndex = view === which ? 0 : -1;
            }
            if (!activeName.textContent) {
                closeDrawer();
                return;
            }
            if (view === 'chat') {
                closeDrawer();
                if (!fromCard) chat.focus?.({preventScroll:true});
            } else {
                openDrawer();
                byId('rm_button_selected_ch')?.click();
            }
        }

        const nativeCharacterActions = [
            { label:'Xuất thẻ nhân vật', id:'export_button' },
            { label:'Nhân bản nhân vật', id:'dupe_button' },
            { label:'Đổi tên', operation:'rename' },
            { label:'Lorebook nhân vật', id:'world_button' },
            { label:'Liên kết Lorebook', option:'set_character_world' },
            { label:'Nhập Lorebook từ thẻ', option:'import_character_info' },
            { label:'Lịch sử trò chuyện', id:'option_select_chat' },
            { label:'Yêu thích', id:'favorite_button' },
            { label:'Persona liên kết', id:'char_connections_button' },
            { label:'Thiết lập riêng', option:'set_chat_character_settings' },
            { label:'Chuyển thành Persona', option:'convert_to_persona' },
            { label:'Liên kết nguồn', option:'character_source' },
            { label:'Thay thế / Cập nhật', option:'replace_update' },
            { label:'Nhập thẻ tag', option:'import_tags' },
            { label:'Đặt làm trợ lý', option:'set_as_assistant' },
            { label:'Xóa nhân vật', id:'delete_button' },
        ];
        function nativeCharacterOption(optionId) {
            const option = Array.from(byId('char-management-dropdown')?.options || [])
                .find(item => item.id === optionId);
            if (!option) return false;
            const dropdown = option.parentElement;
            dropdown.value = option.value;
            dropdown.dispatchEvent(new Event('change',{bubbles:true}));
            return true;
        }
        function characterMenuItems(id) {
            return nativeCharacterActions
                .filter(item => item.operation === 'rename' ||
                    (item.id && byId(item.id)) ||
                    (item.option && Array.from(byId('char-management-dropdown')?.options || [])
                        .some(option => option.id === item.option)))
                .map(item => ({
                    label:item.label,
                    run:()=>selectedNativeAction(id,item),
                }));
        }
        async function selectedNativeAction(id, action) {
            if (!scriptApi || nativeActionsPending || !Number.isInteger(id) ||
                !scriptApi.characters?.[id]) return;
            nativeActionsPending = true;
            try {
                if (currentCharacterId() !== id) {
                    await scriptApi.selectCharacterById(id);
                }
                if (currentCharacterId() !== id) return;
                if (action.operation === 'rename') {
                    setView('edit');
                    const nameInput = byId('character_name_pole');
                    nameInput?.focus();
                    nameInput?.select();
                    return;
                }
                // Use the original native handlers and their confirmations.
                // Opening edit only prepares the native form for off-screen cards.
                if (selectedView !== 'edit') setView('edit');
                else {
                    openDrawer();
                    byId('rm_button_selected_ch')?.click();
                }
                if (action.id) nativeClick(action.id);
                else if (action.option) nativeCharacterOption(action.option);
            } catch (error) {
                console.error('[Character Studio] Native action failed',error);
                window.alert('Không thể thực hiện thao tác với nhân vật.');
            } finally {
                nativeActionsPending = false;
            }
        }
        function openCardActions(card) {
            const id = Number(card.dataset.chid);
            if (!Number.isInteger(id) || !scriptApi?.characters?.[id]) return;
            const name = card.querySelector('.ch_name')?.textContent?.trim() || 'Nhân vật';
            popup(name, characterMenuItems(id),card);
        }

        // Capture prevents a long press from also triggering the delegated
        // native character selection click. Regular clicks are untouched.
        nativeList.addEventListener('pointerdown', event => {
            const card = event.target.closest('.character_select[data-chid]');
            if (!card || event.button !== 0) return;
            clearTimeout(pressTimer);
            pressTimer = setTimeout(() => {
                longPressed = true;
                openCardActions(card);
                clearTimeout(cancelledClickTimer);
                cancelledClickTimer = setTimeout(() => {longPressed=false;},1000);
            },600);
        },{passive:true});
        for (const type of ['pointerup','pointerleave','pointercancel']) {
            nativeList.addEventListener(type,()=>clearTimeout(pressTimer),{passive:true});
        }
        nativeList.addEventListener('contextmenu',event => {
            const card = event.target.closest('.character_select[data-chid]');
            if (!card) return;
            event.preventDefault();
            clearTimeout(pressTimer);
            if (!longPressed) openCardActions(card);
            longPressed = true;
            clearTimeout(cancelledClickTimer);
            cancelledClickTimer = setTimeout(()=>{longPressed=false;},1000);
        },true);
        nativeList.addEventListener('click',event => {
            const card = event.target.closest('.character_select[data-chid]');
            if (!card) return;
            if (longPressed) {
                event.preventDefault();
                event.stopImmediatePropagation();
                longPressed=false;
                return;
            }
            // Let SillyTavern's own delegated click select the character.
            // Its CHAT_CHANGED event will subsequently switch to chat tab.
            if (!nativeActionsPending) {
                setTimeout(()=>{ if (!nativeActionsPending) setView('chat',{fromCard:true});},200);
            }
        },true);

        // React to original SillyTavern events; never synthesize them.
        const moduleUrl = new URL('script.js',document.baseURI).href;
        import(moduleUrl).then(api => {
            scriptApi = api;
            syncSelected();
            if (!tabs.hidden) setView('chat',{fromCard:true});
            import(new URL('scripts/group-chats.js',document.baseURI).href)
                .then(group=>{groupApi=group;syncSelected();})
                .catch(error=>console.warn('[Character Studio] Group state unavailable',error));
            api.eventSource.on(api.event_types.CHAT_CHANGED,()=>{
                if (!nativeActionsPending) setView('chat',{fromCard:true});
            });
            api.eventSource.on(api.event_types.CHARACTER_DELETED,()=>{
                setTimeout(syncSelected,0);
            });
            api.eventSource.on(api.event_types.APP_READY,()=>syncSelected());
            setTimeout(syncSelected,500);
        }).catch(error=>console.error('[Character Studio] Native events unavailable',error));
    }

    if (!initialize()) {
        let count = 0;
        const retry = setInterval(() => {
            if (initialize() || ++count > 40) clearInterval(retry);
        },500);
    }
})();