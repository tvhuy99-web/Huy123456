/*
 * SillyTavern 1.19.0 Android-only TalkBack accessibility bridge.
 * Does not alter SillyTavern's repository, visible styling or interactions.
 * Must run after each page load; dynamic controls are handled by MutationObserver.
 */
(() => {
  'use strict';
  if (window.__stAndroidAccessibilityInstalled) return;
  window.__stAndroidAccessibilityInstalled = true;

  const LABELS = {
    'leftNavDrawerIcon': 'Mở cài đặt phản hồi AI',
    'rightNavDrawerIcon': 'Mở quản lý nhân vật',
    'WIDrawerIcon': 'Mở Lorebook',
    'options_button': 'Mở tùy chọn trò chuyện',
    'send_but': 'Gửi tin nhắn',
    'send_textarea': 'Nhập tin nhắn',
    'swipe_left': 'Xem phản hồi trước',
    'swipe_right': 'Xem phản hồi tiếp theo',
    'rm_button_characters': 'Danh sách nhân vật',
    'rm_button_back': 'Quay lại danh sách nhân vật',
    'rm_button_back_from_group': 'Quay lại nhóm',
    'rm_button_create': 'Tạo nhân vật mới',
    'character_import_button': 'Nhập thẻ nhân vật',
    'external_import_button': 'Nhập nhân vật từ URL',
    'rm_button_group_chats': 'Tạo nhóm chat mới',
    'rm_button_search': 'Tìm kiếm nhân vật',
    'charListGridToggle': 'Đổi kiểu xem danh sách nhân vật',
    'bulkEditButton': 'Chỉnh sửa nhiều nhân vật',
    'bulkSelectAllButton': 'Chọn tất cả nhân vật',
    'bulkDeleteButton': 'Xóa các nhân vật đã chọn',
    'renameCharButton': 'Đổi tên nhân vật',
    'favorite_button': 'Đánh dấu nhân vật yêu thích',
    'world_button': 'Mở Lorebook của nhân vật',
    'export_button': 'Xuất thẻ nhân vật',
    'dupe_button': 'Nhân bản nhân vật',
    'delete_button': 'Xóa nhân vật',
    'newChatFromManageScreenButton': 'Tạo cuộc trò chuyện mới',
    'chat_import_button': 'Nhập lịch sử trò chuyện',
    'closeZoom': 'Đóng ảnh phóng to',
    'ANClose': 'Đóng ghi chú tác giả',
    'CFGClose': 'Đóng hướng dẫn CFG',
    'logprobsViewerClose': 'Đóng bảng xác suất token',
    'world_create_button': 'Tạo Lorebook mới',
    'world_import_button': 'Nhập Lorebook',
    'world_popup_export': 'Xuất Lorebook',
    'world_popup_name_button': 'Đổi tên Lorebook',
    'world_popup_delete': 'Xóa Lorebook',
    'world_popup_new': 'Thêm mục Lorebook',
    'CloseAllWIEntries': 'Thu gọn tất cả mục Lorebook',
    'api_button': 'Kết nối dịch vụ AI',
    'api_button_novel': 'Kết nối NovelAI',
    'api_button_textgenerationwebui': 'Kết nối máy chủ tạo văn bản',
    'api_button_openai': 'Kết nối dịch vụ chat AI',
    'test_api_button': 'Kiểm tra kết nối API',
    'character_context_menu_delete': 'Xóa nhân vật',
    'import_oai_preset': 'Nhập preset AI',
    'export_oai_preset': 'Xuất preset AI',
    'delete_oai_preset': 'Xóa preset AI',
    'new_oai_preset': 'Lưu preset AI mới',
    'newchat_prompt_restore': 'Khôi phục prompt mở đầu',
    'context_delete_preset': 'Xóa mẫu ngữ cảnh',
    'account_button': 'Tài khoản người dùng',
    'admin_button': 'Quản trị người dùng',
    'logout_button': 'Đăng xuất',
    'ui_preset_import_button': 'Nhập chủ đề giao diện',
    'ui_preset_export_button': 'Xuất chủ đề giao diện',
    'ui-preset-delete-button': 'Xóa chủ đề giao diện',
    'ui-preset-update-button': 'Cập nhật chủ đề giao diện',
    'ui-preset-save-button': 'Lưu chủ đề giao diện',
    'bg_add_folder_button': 'Tạo thư mục hình nền',
    'backgrounds-drawer-toggle': 'Mở cài đặt hình nền',
    'third_party_extension_button': 'Cài extension từ kho Git',
    'persona_rename_button': 'Đổi tên persona',
    'persona_set_image_button': 'Đổi ảnh persona',
    'persona_duplicate_button': 'Nhân bản persona',
    'persona_delete_button': 'Xóa persona'
  };

  const ICONS = {
    'fa-paper-plane': 'Gửi tin nhắn',
    'fa-bars': 'Mở menu',
    'fa-xmark': 'Đóng',
    'fa-circle-xmark': 'Đóng',
    'fa-times': 'Đóng',
    'fa-arrow-left': 'Quay lại',
    'fa-left-long': 'Quay lại',
    'fa-arrow-right': 'Tiếp theo',
    'fa-rotate': 'Tạo lại phản hồi',
    'fa-arrows-rotate': 'Tải lại',
    'fa-refresh': 'Làm mới',
    'fa-trash': 'Xóa',
    'fa-trash-can': 'Xóa',
    'fa-pencil': 'Chỉnh sửa',
    'fa-pen': 'Chỉnh sửa',
    'fa-copy': 'Sao chép',
    'fa-clone': 'Nhân bản',
    'fa-plus': 'Thêm mới',
    'fa-minus': 'Giảm',
    'fa-search': 'Tìm kiếm',
    'fa-magnifying-glass': 'Tìm kiếm',
    'fa-gear': 'Cài đặt',
    'fa-cog': 'Cài đặt',
    'fa-book-atlas': 'Mở Lorebook',
    'fa-address-card': 'Quản lý nhân vật',
    'fa-download': 'Tải xuống',
    'fa-upload': 'Tải lên',
    'fa-file-export': 'Xuất dữ liệu',
    'fa-file-import': 'Nhập dữ liệu',
    'fa-save': 'Lưu',
    'fa-floppy-disk': 'Lưu',
    'fa-eye': 'Hiển thị',
    'fa-eye-slash': 'Ẩn',
    'fa-play': 'Bắt đầu',
    'fa-stop': 'Dừng tạo phản hồi',
    'fa-pause': 'Tạm dừng',
    'fa-chevron-left': 'Trước',
    'fa-chevron-right': 'Sau',
    'fa-ellipsis': 'Thêm tùy chọn',
    'fa-ellipsis-vertical': 'Thêm tùy chọn',
    'fa-ellipsis-h': 'Thêm tùy chọn',
    'fa-check': 'Xác nhận',
    'fa-check-double': 'Chọn tất cả',
    'fa-sliders': 'Cấu hình phản hồi AI'
  };

  const TITLE_LABELS = {
    'Message Actions': 'Thao tác với tin nhắn',
    'Copy': 'Sao chép tin nhắn',
    'Copy this message': 'Sao chép tin nhắn',
    'Edit': 'Chỉnh sửa tin nhắn',
    'Confirm': 'Xác nhận chỉnh sửa',
    'Cancel': 'Hủy',
    'Delete': 'Xóa',
    'Swipe left': 'Xem phản hồi trước',
    'Swipe right': 'Xem phản hồi tiếp theo',
    'Translate message': 'Dịch tin nhắn',
    'Regenerate': 'Tạo lại phản hồi',
    'Create New Chat': 'Tạo cuộc trò chuyện mới',
    'Rename chat file': 'Đổi tên cuộc trò chuyện',
  };

  const INTERACTIVE = [
    'button', '[role="button"]',
    'input:not([type="hidden"])', 'textarea', 'select',
    '.menu_button', '.menu_button_icon', '.drawer-icon', '.right_menu_button',
    '.interactable', '.floating_panel_close', '.dragClose',
    '.mes_button', '.mes_edit', '.mes_copy', '.mes_delete', '.mes_swipe_left', '.mes_swipe_right',
    '.mes_regenerate', '.swipe_left', '.swipe_right', '.mes_img_swipe_left', '.mes_img_swipe_right',
    '.character_select', '.group_select', '.bogus_folder_select', '.select_chat_block',
    '.renameChatButton', '.deleteChatButton', '.mes_edit_done', '.mes_edit_cancel',
    '[tabindex][onclick]'
  ].join(',');

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const textName = el => {
    // Avoid reading decorative glyphs as the action's name.
    const name = Array.from(el.childNodes || [])
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent || '').join(' ');
    if (clean(name)) return clean(name);
    return clean(el.textContent);
  };
  const referencedName = el => {
    const ids = clean(el.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    return clean(ids.map(id => document.getElementById(id)?.textContent || '').join(' '));
  };
  const iconName = el => {
    const icons = [el, ...el.querySelectorAll('.fa-solid,.fa-regular,.fas,.far,.fa')];
    for (const icon of icons) {
      for (const cls of Array.from(icon.classList || [])) {
        if (ICONS[cls]) return ICONS[cls];
      }
    }
    return '';
  };
  const fromIdentifier = id => {
    if (!id) return '';
    const tokens = id.replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ').trim().toLowerCase();
    const words = [
      [/\bdelete\b|\bremove\b|\btrash\b/, 'Xóa'],
      [/\bclose\b|\bdismiss\b/, 'Đóng'],
      [/\bcopy\b/, 'Sao chép'],
      [/\bduplicate\b|\bclone\b|\bdupe\b/, 'Nhân bản'],
      [/\bimport\b/, 'Nhập'],
      [/\bexport\b|\bdownload\b/, 'Xuất'],
      [/\brename\b/, 'Đổi tên'],
      [/\bsearch\b/, 'Tìm kiếm'],
      [/\bcreate\b|\bnew\b|\badd\b/, 'Tạo mới'],
      [/\bedit\b/, 'Chỉnh sửa'],
      [/\bsend\b/, 'Gửi tin nhắn'],
      [/\bback\b/, 'Quay lại'],
      [/\brefresh\b|\breload\b/, 'Tải lại'],
      [/\bsave\b/, 'Lưu'],
      [/\bsettings?\b/, 'Cài đặt'],
      [/\bnext\b/, 'Tiếp theo'],
      [/\bprevious\b|\bprev\b/, 'Trước']
    ];
    const action = words.find(([re]) => re.test(tokens))?.[1];
    if (!action) return '';
    const context = /\bworld\b|\bwi\b|\blore\b/.test(tokens) ? ' Lorebook' :
      /\bcharacter\b|\bchara\b|\bchar\b/.test(tokens) ? ' nhân vật' :
      /\bchat\b/.test(tokens) ? ' cuộc trò chuyện' :
      /\bpreset\b/.test(tokens) ? ' preset' :
      /\bgroup\b/.test(tokens) ? ' nhóm' : '';
    return action + context;
  };
  function available(el) {
    if (el.closest('[inert],template,[aria-hidden="true"],.template_element,[hidden]')) return false;
    // Off-screen/closed drawers should not acquire new keyboard stops.
    // CSS display:none already removes them from the accessibility tree.
    if (typeof el.getClientRects === 'function' && !el.getClientRects().length) return false;
    return true;
  }
  function isNativeAction(el) {
    const tag = el.tagName.toLowerCase();
    return tag === 'button' || tag === 'input' || tag === 'textarea' ||
      tag === 'select' || tag === 'summary' || (tag === 'a' && el.hasAttribute('href'));
  }
  function labelFromNativeControl(el) {
    if (!['input','textarea','select'].includes(el.tagName.toLowerCase())) return false;
    return Boolean(el.labels?.length);
  }
  function withinNamedCard(el) {
    const card = el.closest('.character_select[data-chid],.group_select,.select_chat_block');
    if (!card || card === el || !card.hasAttribute('aria-label')) return false;
    // Preserve distinct tag, menu and form actions inside a card.
    if (isNativeAction(el) || el.matches('.menu_button,.menu_button_icon,[role="button"],[role="link"],.tag_remove,.tag')) return false;
    return el.matches('.ch_name,.character_name_block,.avatar,.select_chat_block_filename,.ch_additional_info,.ch_description');
  }
  function setAttr(el, attr, value) {
    if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
  }
  function contextLabel(el) {
    if (el.matches('.swipe_left,.mes_img_swipe_left')) return 'Xem phản hồi trước';
    if (el.matches('.swipe_right,.mes_img_swipe_right')) return 'Xem phản hồi tiếp theo';
    if (el.matches('.character_select')) {
      const name = clean(el.querySelector('.ch_name')?.textContent);
      if (name) return 'Mở trò chuyện với ' + name;
    }
    if (el.matches('.group_select')) {
      const name = clean(el.querySelector('.ch_name')?.textContent);
      if (name) return 'Mở nhóm chat ' + name;
    }
    if (el.matches('.select_chat_block')) {
      const name = clean(el.querySelector('.select_chat_block_filename')?.textContent);
      if (name) return 'Mở cuộc trò chuyện: ' + name;
    }
    return '';
  }
  function internationalizedTitle(el) {
    const i18n = clean(el.getAttribute('data-i18n'));
    const match = i18n.match(/\[title\]([^;]+)/);
    if (match) return clean(match[1]);
    if (i18n && !i18n.includes('[') && !i18n.includes(';')) return i18n;
    return '';
  }
  function ensureAction(el) {
    if (!available(el) || withinNamedCard(el)) return;
    const tag = el.tagName.toLowerCase();
    const native = isNativeAction(el);
    // Avoid inventing a second focus target for the label of a card.
    // Never strip a focus target deliberately owned by SillyTavern.
    if (!native && !el.hasAttribute('role')) setAttr(el, 'role', 'button');
    if (!native && !el.hasAttribute('tabindex')) setAttr(el, 'tabindex', '0');

    // Labels created by this bridge can update when a dynamic character or
    // chat item changes. Respect labels created by SillyTavern/extensions.
    const autoGenerated = el.getAttribute('data-st-a11y-generated') === 'true';
    const currentLabel = clean(el.getAttribute('aria-label'));
    const previousGenerated = clean(el.getAttribute('data-st-a11y-value'));
    // Native scripts may replace a label after our first pass. Do not
    // overwrite a new explicit label just because we generated an old one.
    const generatedUnchanged = autoGenerated &&
      (!previousGenerated || currentLabel === previousGenerated);
    const existingLabel = generatedUnchanged ? '' : currentLabel;
    const existingReference = referencedName(el);
    // Form fields get their accessible names from their associated label,
    // placeholder or ID. Their current values/options are not action names.
    const isFormField = tag === 'input' || tag === 'textarea' || tag === 'select';
    const readableText = isFormField ? '' : textName(el);
    const placeholder = isFormField ? clean(el.getAttribute('placeholder')) : '';
    const namedByLabel = labelFromNativeControl(el);
    const explicit = existingLabel || existingReference || readableText;
    const title = clean(el.getAttribute('title'));
    const tooltip = clean(el.getAttribute('data-tooltip-content'));
    const translatedTitle = TITLE_LABELS[title] || title;
    const i18nTitle = internationalizedTitle(el);
    const imageName = clean(el.querySelector('img[alt]:not([alt=""])')?.getAttribute('alt'));
    const label = existingLabel || existingReference || LABELS[el.id] ||
      contextLabel(el) || readableText || translatedTitle || tooltip ||
      TITLE_LABELS[i18nTitle] || i18nTitle || placeholder || imageName ||
      iconName(el) || fromIdentifier(el.id);
    if (!existingLabel && !existingReference && !namedByLabel && label &&
        // Text buttons are already natively named; another aria-label
        // needlessly replaces that name and may repeat its announcement.
        !(native && !isFormField && readableText === label)) {
      setAttr(el, 'aria-label', label);
      setAttr(el, 'data-st-a11y-generated', 'true');
      setAttr(el, 'data-st-a11y-value', label);
    }

    // Mark icon-only children as decorative only if the parent has a name.
    if (label || explicit || namedByLabel) {
      if (el.matches('.select_chat_block')) {
        const filename = el.querySelector('.select_chat_block_filename');
        if (filename && !filename.matches('a,button,[role="button"]')) {
          setAttr(filename,'aria-hidden','true');
        }
      }
      for (const icon of el.querySelectorAll('i.fa,.fa-solid,.fa-regular,.fas,.far,svg:not([role="img"])')) {
        if (!icon.hasAttribute('aria-label') && !icon.hasAttribute('aria-labelledby')) {
          setAttr(icon, 'aria-hidden', 'true');
          setAttr(icon, 'focusable', 'false');
        }
      }
      for (const image of el.querySelectorAll('img')) {
        if (image.getAttribute('alt') && clean(image.getAttribute('alt')) === clean(label)) {
          setAttr(image, 'alt', '');
          setAttr(image, 'aria-hidden', 'true');
        }
      }
    }
  }
  function hideDecoration(el) {
    if (!available(el)) return;
    if (el.matches('img')) {
      const alt = clean(el.getAttribute('alt'));
      if (!alt && !el.closest(INTERACTIVE)) {
        setAttr(el, 'alt', '');
        setAttr(el, 'aria-hidden', 'true');
      }
      return;
    }
    // Decorative Font Awesome glyphs must not become independent TalkBack
    // nodes. Interactive icons are handled as buttons above.
    if (el.matches('i.fa,i.fas,i.far,i.fa-solid,i.fa-regular') &&
        !el.matches(INTERACTIVE) && !el.closest(INTERACTIVE) &&
        !el.hasAttribute('role') && !el.hasAttribute('aria-label') &&
        !el.hasAttribute('aria-labelledby')) {
      setAttr(el, 'aria-hidden', 'true');
    }
  }
  function scan() {
    if (!document.body) return;
    for (const el of document.querySelectorAll(INTERACTIVE)) ensureAction(el);
    for (const el of document.querySelectorAll('img,i.fa,i.fas,i.far,i.fa-solid,i.fa-regular')) {
      hideDecoration(el);
    }
  }
  // Keyboard and switch-access users should also be able to activate the
  // newly exposed non-native buttons using Enter or Space.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof Element) ||
        !target.matches(INTERACTIVE) || !available(target) || withinNamedCard(target)) return;
    // Character Studio provides its own keyboard handler for card entries.
    // Running both handlers would open the same character twice.
    if (target.matches('.character_select,.group_select') &&
        target.dataset?.stCsReady === '1') return;
    if (target.matches('button,input,textarea,select,a,[contenteditable="true"]')) return;
    if (!target.hasAttribute('data-st-a11y-key-handler')) return;
    event.preventDefault();
    target.click();
  }, true);
  function markKeyboardActions() {
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (!isNativeAction(el) && available(el) && !withinNamedCard(el) &&
          !el.hasAttribute('data-st-a11y-key-handler')) {
        setAttr(el, 'data-st-a11y-key-handler', 'true');
      }
    }
  }
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
      markKeyboardActions();
    }, 120);
  }
  schedule();
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title', 'class', 'aria-label', 'aria-labelledby', 'role',
      'alt', 'data-i18n', 'hidden', 'style', 'inert']
  });
  console.info('[SillyTavern Android] TalkBack labels and decorative icon filtering enabled');
})();
