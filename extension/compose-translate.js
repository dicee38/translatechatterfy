// Feature 1, альтернативный триггер (по просьбе оператора, в духе DeepL):
// вместо выделения текста и плашки — кнопка прямо в поле ввода, по клику
// переводит то, что оператор уже написал, и заменяет текст на месте.
// Направление всегда 'to_dialect' — это заведомо черновик оператора, а не
// произвольное выделение, определять направление по алфавиту тут не нужно.
// Та же авторизация/бюджет/прокси, что и у обычного Feature 1 — просто
// другой способ вызвать тот же /translate.
(function () {
  const RESCAN_INTERVAL_MS = 1500;
  const DIALECT_CONTEXT_MESSAGES = 10;

  // TZ п.6.2: подтверждено реальной вёрсткой композера — Quill,
  // contenteditable-редактор с классом .ql-editor.
  const EDITOR_SELECTOR = '.ql-editor[contenteditable="true"]';

  const settings = { feature1Enabled: true, manualDialectOverride: '' };

  function applyStoredSettings(stored) {
    if (stored.feature1Enabled !== undefined) settings.feature1Enabled = stored.feature1Enabled !== false;
    if (stored.manualDialectOverride !== undefined) settings.manualDialectOverride = stored.manualDialectOverride || '';
  }

  chrome.storage.local.get(['feature1Enabled', 'manualDialectOverride'], applyStoredSettings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const patch = {};
    if (changes.feature1Enabled) patch.feature1Enabled = changes.feature1Enabled.newValue;
    if (changes.manualDialectOverride) patch.manualDialectOverride = changes.manualDialectOverride.newValue;
    applyStoredSettings(patch);
  });

  function findComposeEditor() {
    return document.querySelector(EDITOR_SELECTOR);
  }

  function getEditorText(editor) {
    return (editor.innerText || editor.textContent || '').trim();
  }

  // TZ п.6.2: execCommand('insertText', ...) — Quill перехватывает это как
  // обычный пользовательский ввод и сам обновляет внутреннюю модель (Delta),
  // ничего досинхронизировать не нужно. Тут — замена, а не просто вставка:
  // сначала выделяем всё содержимое редактора, потом "вставляем" перевод
  // поверх выделения, той же командой (тот же приём, что и в TZ, просто с
  // непустым выделением вместо вставки в курсор).
  function replaceEditorText(editor, newText) {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const ok = document.execCommand('insertText', false, newText);
    if (!ok) {
      // Фолбэк из TZ п.6.2 на случай, если execCommand не подхватится на
      // этой конкретной сборке Quill.
      editor.textContent = newText;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: newText }));
    }
  }

  function sendTranslateRequest(text, dialectContext, targetLang) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'translate', payload: { text, dialectContext, targetLang, direction: 'to_dialect' } },
        (response) => resolve(response || { ok: false, kind: 'network_error' })
      );
    });
  }

  async function handleTranslateClick(editor, btn) {
    const text = getEditorText(editor);
    if (!text || btn.disabled) return;

    btn.disabled = true;
    btn.classList.add('cft-compose-btn--busy');

    const chatId = window.CftChatterfyApi.getChatId();
    let dialectContext = [];
    if (chatId) {
      try {
        const messages = await window.CftChatterfyApi.fetchChatMessages(chatId);
        dialectContext = window.CftChatterfyApi.buildDialectContext(messages, DIALECT_CONTEXT_MESSAGES);
      } catch (err) {
        console.warn('[Chatterfy Translator] не удалось получить контекст диалекта:', err);
      }
    }

    const response = await sendTranslateRequest(text, dialectContext, settings.manualDialectOverride || undefined);

    btn.disabled = false;
    btn.classList.remove('cft-compose-btn--busy');

    if (response.ok) {
      replaceEditorText(editor, response.translation);
      return;
    }

    // Кратко подсвечиваем кнопку и кладём причину в title — не городим
    // модалки и плашки поверх поля ввода, оно и так занято текстом.
    btn.title = response.message || (response.kind === 'budget_exceeded' ? 'Дневной лимит бюджета исчерпан' : 'Не удалось перевести, попробуйте ещё раз');
    btn.classList.add(response.kind === 'budget_exceeded' ? 'cft-compose-btn--warn' : 'cft-compose-btn--error');
    setTimeout(() => {
      btn.classList.remove('cft-compose-btn--warn', 'cft-compose-btn--error');
      btn.title = 'Перевести в диалект собеседника';
    }, 2500);
  }

  function ensureButton(editor) {
    const wrapper = editor.parentElement;
    if (!wrapper) return;

    if (wrapper.querySelector(':scope > .cft-compose-btn')) return; // уже есть

    if (getComputedStyle(wrapper).position === 'static') {
      wrapper.style.position = 'relative';
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cft-compose-btn';
    btn.textContent = '🌐';
    btn.title = 'Перевести в диалект собеседника';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleTranslateClick(editor, btn);
    });
    wrapper.appendChild(btn);
  }

  function scan() {
    if (!settings.feature1Enabled) return;
    const editor = findComposeEditor();
    if (!editor) return;
    ensureButton(editor);
  }

  setInterval(scan, RESCAN_INTERVAL_MS);
  scan();
})();
