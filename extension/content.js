// Feature 1 (TZ п.4): перевод по выделению. Данные диалекта — из
// messages/v1/search (TZ п.0.1), не из DOM. DOM используется только для
// зоны слушателя выделения и позиционирования плашки (TZ, "Архитектура").
(function () {
  const CONFIG = {
    // TODO: проверить на реальной странице v2.chatterfy.ai и уточнить —
    // это предположение по типичной структуре чата, не подтверждено
    // прямой DOM-инспекцией (в этой сессии не было доступа к живой странице).
    chatContainerSelector: '[data-testid="chat-messages"], .chat-messages, .messages-list, main',
    chatIdFromUrlPattern: /\/chats?\/([a-zA-Z0-9-]+)/,
    dialectContextLimit: 30,
    dialectContextMessages: 10,
  };

  const MESSAGES_SEARCH_URL = 'https://migration-api.chatterfy.ai/api/messages/v1/search';

  // TZ п.4.2: кэш в памяти вкладки, ключ hash(text + chatId). Для Map
  // обычная строка-ключ так же надёжна, как явный хэш — отдельная функция
  // хеширования тут не нужна.
  const translationCache = new Map();

  function getChatContainer() {
    return document.querySelector(CONFIG.chatContainerSelector);
  }

  function getChatId() {
    const urlMatch = location.pathname.match(CONFIG.chatIdFromUrlPattern);
    if (urlMatch) return urlMatch[1];
    const el = document.querySelector('[data-chat-id]');
    if (el) return el.getAttribute('data-chat-id');
    return null;
  }

  async function fetchDialectContext(chatId) {
    const res = await fetch(MESSAGES_SEARCH_URL, {
      method: 'POST',
      credentials: 'include', // сессия оператора в самом Chatterfy, не ключи моделей
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, limit: CONFIG.dialectContextLimit }),
    });

    if (!res.ok) {
      throw new Error(`messages/v1/search вернул ${res.status}`);
    }

    const data = await res.json();
    // TODO: подтвердить точную форму верхнего уровня ответа на реальном
    // трафике (TZ п.0.1 показывает схему одного сообщения, не обёртку
    // списка) — на всякий случай понимаем и голый массив, и {messages:[]}/{items:[]}.
    const messages = Array.isArray(data) ? data : data.messages || data.items || [];

    return messages
      .filter((m) => m && m.sender_type === 'incoming' && typeof m.content === 'string' && m.content.trim())
      .slice(-CONFIG.dialectContextMessages)
      .map((m) => m.content);
  }

  function sendTranslateRequest(text, dialectContext) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'translate', payload: { text, dialectContext } },
        (response) => resolve(response || { ok: false, kind: 'network_error' })
      );
    });
  }

  async function runTranslation(text, chatId, cacheKey) {
    window.CftTranslateBubble.showLoading();

    let dialectContext = [];
    if (chatId) {
      try {
        dialectContext = await fetchDialectContext(chatId);
      } catch (err) {
        // Контекст диалекта — это улучшение качества перевода, а не
        // обязательное условие; при сбое просто переводим без него.
        console.warn('[Chatterfy Translator] не удалось получить контекст диалекта:', err);
      }
    }

    const response = await sendTranslateRequest(text, dialectContext);

    if (response.ok) {
      translationCache.set(cacheKey, response.translation);
      window.CftTranslateBubble.showSuccess(response.translation);
    } else if (response.kind === 'budget_exceeded') {
      window.CftTranslateBubble.showBudgetExceeded(response.message);
    } else {
      window.CftTranslateBubble.showNetworkError(() => runTranslation(text, chatId, cacheKey));
    }
  }

  function handleSelection(rect, text) {
    const chatId = getChatId();
    const cacheKey = `${chatId || 'no-chat-id'}::${text}`;

    if (translationCache.has(cacheKey)) {
      // Кэш уже содержит перевод для этого текста в этом чате — не
      // заставляем оператора лишний раз жать "Перевести".
      window.CftTranslateBubble.showIdle(rect, () => {});
      window.CftTranslateBubble.showSuccess(translationCache.get(cacheKey));
      return;
    }

    window.CftTranslateBubble.showIdle(rect, () => runTranslation(text, chatId, cacheKey));
  }

  document.addEventListener('mouseup', (e) => {
    const container = getChatContainer();
    if (!container || !container.contains(e.target)) {
      return;
    }

    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text) {
      window.CftTranslateBubble.hide();
      return;
    }

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    handleSelection(rect, text);
  });
})();
