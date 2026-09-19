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

  // Настройки из попапа (TZ п.5, этап 5). Дефолты — feature1Enabled: true,
  // пустой override, чтобы до первого чтения storage поведение не менялось.
  const settings = { feature1Enabled: true, manualDialectOverride: '' };

  function applyStoredSettings(stored) {
    if (stored.feature1Enabled !== undefined) settings.feature1Enabled = stored.feature1Enabled !== false;
    if (stored.manualDialectOverride !== undefined) settings.manualDialectOverride = stored.manualDialectOverride || '';
  }

  chrome.storage.local.get(['feature1Enabled', 'manualDialectOverride'], applyStoredSettings);

  // Живое обновление без перезагрузки страницы, если оператор переключил
  // что-то в попапе, пока вкладка с Chatterfy уже открыта.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const patch = {};
    if (changes.feature1Enabled) patch.feature1Enabled = changes.feature1Enabled.newValue;
    if (changes.manualDialectOverride) patch.manualDialectOverride = changes.manualDialectOverride.newValue;
    applyStoredSettings(patch);
    if (patch.feature1Enabled === false) window.CftTranslateBubble.hide();
  });

  function getChatContainer() {
    return document.querySelector(CONFIG.chatContainerSelector);
  }

  function getChatId() {
    // Подтверждено на реальном Chatterfy: id чата лежит в query-параметре
    // ?chat=..., не в пути (напр. /bots/<botId>/chats?chat=<chatId>) —
    // до этой правки chatIdFromUrlPattern матчил только путь и всегда
    // возвращал null для реальных ссылок, из-за чего контекст диалекта
    // тихо оставался пустым без единой ошибки в консоли.
    const fromQuery = new URLSearchParams(location.search).get('chat');
    if (fromQuery) return fromQuery;
    // Фолбэк на случай другого формата ссылки (не подтверждён вживую).
    const urlMatch = location.pathname.match(CONFIG.chatIdFromUrlPattern);
    if (urlMatch) return urlMatch[1];
    const el = document.querySelector('[data-chat-id]');
    if (el) return el.getAttribute('data-chat-id');
    return null;
  }

  async function fetchChatMessages(chatId) {
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
    return Array.isArray(data) ? data : data.messages || data.items || [];
  }

  function buildDialectContext(messages) {
    return messages
      .filter((m) => m && m.sender_type === 'incoming' && typeof m.content === 'string' && m.content.trim())
      .slice(-CONFIG.dialectContextMessages)
      .map((m) => m.content);
  }

  // Живьём выяснилось (проверка на реальном Chatterfy) — направление
  // перевода нельзя определять по sender_type выделенного сообщения:
  // "исходящее → в диалект" ломается, как только оператор отправляет
  // ГОТОВЫЙ перевод на диалекте (обычный рабочий цикл — перевёл, вставил,
  // отправил) — такое сообщение лежит в истории как "outcoming", но
  // ФАКТИЧЕСКИ уже на диалекте, и повторный "перевод в диалект" — то же
  // самое "с дариджи на дариджу", что и было с входящими до этой правки.
  // Надёжнее смотреть не на то, КТО писал, а на то, НА КАКОМ АЛФАВИТЕ
  // написан сам выделенный текст: TZ подразумевает, что оператор пишет
  // по-русски (кириллица), а диалект собеседника — латиница/арабица/иное.
  function detectDirection(selectedText) {
    const cyrillic = (selectedText.match(/[Ѐ-ӿ]/g) || []).length;
    const letters = (selectedText.match(/\p{L}/gu) || []).length;
    if (letters === 0) return 'to_dialect';
    // Заметная доля кириллицы — считаем текст русским (оператора) → в диалект.
    // Иначе — латиница/арабица и т.п., уже похоже на диалект → на русский.
    return cyrillic / letters > 0.3 ? 'to_dialect' : 'to_operator_language';
  }

  function sendTranslateRequest(text, dialectContext, targetLang, direction) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'translate', payload: { text, dialectContext, targetLang, direction } },
        (response) => resolve(response || { ok: false, kind: 'network_error' })
      );
    });
  }

  async function runTranslation(text, chatId, cacheKey) {
    window.CftTranslateBubble.showLoading();

    const direction = detectDirection(text);

    let dialectContext = [];
    if (chatId) {
      try {
        dialectContext = buildDialectContext(await fetchChatMessages(chatId));
      } catch (err) {
        // Контекст диалекта — это улучшение качества перевода, а не
        // обязательное условие; при сбое просто переводим без него.
        console.warn('[Chatterfy Translator] не удалось получить контекст диалекта:', err);
      }
    }

    // Ручной override диалекта из попапа (TZ п.5 — "на случай, если
    // авто-контекст ошибся") применим только к направлению "в диалект" —
    // для чтения входящих целевой язык всегда русский, override тут не при чём.
    const targetLang = direction === 'to_dialect' ? settings.manualDialectOverride || undefined : undefined;
    const response = await sendTranslateRequest(text, dialectContext, targetLang, direction);

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
    if (!settings.feature1Enabled) return;

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
