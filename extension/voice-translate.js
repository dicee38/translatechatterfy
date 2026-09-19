// Feature 2 (TZ п.5): расшифровка + перевод голосовых. Список голосовых —
// из messages/v1/search (files[].type === 'voice'), не из DOM (TZ,
// "Архитектура"). DOM используется только чтобы найти существующий
// <audio>-элемент с тем же src и повесить рядом кнопку/панель —
// сопоставление по точному URL файла, а не по угаданным CSS-классам,
// поэтому не хрупкое к вёрстке конкретной версии Chatterfy.
(function () {
  // Держать в синхроне с TRANSCRIBE_PRICE_PER_MINUTE_USD в
  // proxy/*/lib/pricing.js (там же обоснование цифры — калибровка по
  // реальному расходу на этапе 1, не цена из документации OpenAI).
  const TRANSCRIBE_PRICE_PER_MINUTE_USD = 0.05;
  const RESCAN_INTERVAL_MS = 2000;
  const DIALECT_CONTEXT_MESSAGES = 10;

  const settings = { feature2Enabled: true };

  function applyStoredSettings(stored) {
    if (stored.feature2Enabled !== undefined) settings.feature2Enabled = stored.feature2Enabled !== false;
  }

  chrome.storage.local.get(['feature2Enabled'], applyStoredSettings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.feature2Enabled) applyStoredSettings({ feature2Enabled: changes.feature2Enabled.newValue });
  });

  function cacheKey(chatId, messageId) {
    return `cft-voice:${chatId}:${messageId}`;
  }

  async function getCached(chatId, messageId) {
    const key = cacheKey(chatId, messageId);
    const stored = await chrome.storage.local.get([key]);
    return stored[key] || null;
  }

  async function setCached(chatId, messageId, value) {
    await chrome.storage.local.set({ [cacheKey(chatId, messageId)]: value });
  }

  function transcribeRequest(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'transcribe', payload: { url } },
        (response) => resolve(response || { ok: false, kind: 'network_error' })
      );
    });
  }

  function translateRequest(text, dialectContext) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        // Голосовые всегда переводятся ЧИТАТЬ (собеседник → русский), в
        // отличие от Feature 1 — там направление определяется по тексту,
        // здесь оно всегда одно и то же (TZ п.5.1: "расшифровка → перевод
        // на русский"), не нужно auto-detect.
        { type: 'translate', payload: { text, dialectContext, direction: 'to_operator_language' } },
        (response) => resolve(response || { ok: false, kind: 'network_error' })
      );
    });
  }

  // --- UI ---

  function estimateCostLabel(durationSec) {
    if (typeof durationSec !== 'number') return '';
    const usd = (durationSec / 60) * TRANSCRIBE_PRICE_PER_MINUTE_USD;
    return ` (~${Math.round(durationSec)}с, ~$${usd.toFixed(3)})`;
  }

  function clearPanel(panel) {
    panel.innerHTML = '';
    panel.classList.remove('cft-voice-panel--open', 'cft-voice-panel--warn', 'cft-voice-panel--error');
  }

  function renderIdle(panel, onClick, costLabel) {
    clearPanel(panel);
    const btn = document.createElement('button');
    btn.className = 'cft-voice-btn';
    btn.type = 'button';
    btn.textContent = `Перевести${costLabel}`;
    btn.addEventListener('click', onClick);
    panel.appendChild(btn);
  }

  function renderLoading(panel, label) {
    clearPanel(panel);
    panel.classList.add('cft-voice-panel--open');
    const row = document.createElement('div');
    row.className = 'cft-voice-row';
    const spinner = document.createElement('div');
    spinner.className = 'cft-voice-spinner';
    const text = document.createElement('div');
    text.textContent = label;
    row.appendChild(spinner);
    row.appendChild(text);
    panel.appendChild(row);
  }

  function renderResult(panel, transcript, translation, onClose) {
    clearPanel(panel);
    panel.classList.add('cft-voice-panel--open');

    const original = document.createElement('div');
    original.className = 'cft-voice-block';
    original.innerHTML = '<div class="cft-voice-label">Оригинал (на диалекте):</div>';
    const originalText = document.createElement('div');
    originalText.className = 'cft-voice-text';
    originalText.textContent = transcript;
    original.appendChild(originalText);

    const translated = document.createElement('div');
    translated.className = 'cft-voice-block';
    translated.innerHTML = '<div class="cft-voice-label">Перевод:</div>';
    const translatedText = document.createElement('div');
    translatedText.className = 'cft-voice-text';
    translatedText.textContent = translation;
    translated.appendChild(translatedText);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cft-voice-btn cft-voice-btn--ghost';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Скрыть';
    closeBtn.addEventListener('click', onClose);

    panel.appendChild(original);
    panel.appendChild(translated);
    panel.appendChild(closeBtn);
  }

  function renderUnintelligible(panel, onClose) {
    clearPanel(panel);
    panel.classList.add('cft-voice-panel--open', 'cft-voice-panel--warn');
    const text = document.createElement('div');
    text.className = 'cft-voice-text';
    text.textContent = 'Распознавание не дало разборчивого текста.';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cft-voice-btn cft-voice-btn--ghost';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Закрыть';
    closeBtn.addEventListener('click', onClose);
    panel.appendChild(text);
    panel.appendChild(closeBtn);
  }

  function renderBudgetExceeded(panel, message, onClose) {
    clearPanel(panel);
    panel.classList.add('cft-voice-panel--open', 'cft-voice-panel--warn');
    const text = document.createElement('div');
    text.className = 'cft-voice-text';
    text.textContent = message || 'Дневной лимит бюджета исчерпан.';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cft-voice-btn cft-voice-btn--ghost';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Закрыть';
    closeBtn.addEventListener('click', onClose);
    panel.appendChild(text);
    panel.appendChild(closeBtn);
  }

  function renderError(panel, message, onRetry, onClose) {
    clearPanel(panel);
    panel.classList.add('cft-voice-panel--open', 'cft-voice-panel--error');
    const text = document.createElement('div');
    text.className = 'cft-voice-text';
    text.textContent = message;
    const row = document.createElement('div');
    row.className = 'cft-voice-row';
    const retryBtn = document.createElement('button');
    retryBtn.className = 'cft-voice-btn';
    retryBtn.type = 'button';
    retryBtn.textContent = 'Повторить';
    retryBtn.addEventListener('click', onRetry);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cft-voice-btn cft-voice-btn--ghost';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Закрыть';
    closeBtn.addEventListener('click', onClose);
    row.appendChild(retryBtn);
    row.appendChild(closeBtn);
    panel.appendChild(text);
    panel.appendChild(row);
  }

  // --- Логика ---

  async function dialectContextFor(chatId) {
    if (!chatId) return [];
    try {
      const messages = await window.CftChatterfyApi.fetchChatMessages(chatId);
      return window.CftChatterfyApi.buildDialectContext(messages, DIALECT_CONTEXT_MESSAGES);
    } catch (err) {
      console.warn('[Chatterfy Translator] не удалось получить контекст диалекта:', err);
      return [];
    }
  }

  function resetToIdle(panel, voice) {
    renderIdle(panel, () => runVoiceTranslation(voice, panel), voice.costLabel);
  }

  function handleFailure(response, panel, voice) {
    if (response.kind === 'budget_exceeded') {
      renderBudgetExceeded(panel, response.message, () => resetToIdle(panel, voice));
    } else {
      renderError(
        panel,
        'Не удалось выполнить запрос, попробуйте ещё раз',
        () => runVoiceTranslation(voice, panel),
        () => resetToIdle(panel, voice)
      );
    }
  }

  // Реентерабельная: повторный вызов (например, по кнопке "Повторить")
  // подхватывает состояние из кэша, а не начинает с нуля — если
  // транскрипт уже получен, а перевод упал, повторный запуск платит
  // только за перевод, не за расшифровку заново.
  async function runVoiceTranslation(voice, panel) {
    let cached = await getCached(voice.chatId, voice.messageId);

    if (!cached) {
      renderLoading(panel, 'Распознаю...');
      const transcribeResponse = await transcribeRequest(voice.url);
      if (!transcribeResponse.ok) {
        handleFailure(transcribeResponse, panel, voice);
        return;
      }
      cached = {
        transcript: transcribeResponse.transcript || '',
        translation: null,
        language: transcribeResponse.language || null,
        cachedAt: Date.now(),
      };
      await setCached(voice.chatId, voice.messageId, cached);
    }

    if (!cached.transcript || !cached.transcript.trim()) {
      renderUnintelligible(panel, () => resetToIdle(panel, voice));
      return;
    }

    if (cached.translation) {
      renderResult(panel, cached.transcript, cached.translation, () => resetToIdle(panel, voice));
      return;
    }

    renderLoading(panel, 'Перевожу...');
    const dialectContext = await dialectContextFor(voice.chatId);
    const translateResponse = await translateRequest(cached.transcript, dialectContext);
    if (!translateResponse.ok) {
      handleFailure(translateResponse, panel, voice);
      return;
    }

    cached.translation = translateResponse.translation;
    await setCached(voice.chatId, voice.messageId, cached);
    renderResult(panel, cached.transcript, cached.translation, () => resetToIdle(panel, voice));
  }

  // --- Поиск голосовых сообщений в DOM ---

  const attachedUrls = new Set();

  function findAudioElementForUrl(url) {
    const audios = document.querySelectorAll('audio');
    for (const audio of audios) {
      if (audio.currentSrc === url || audio.src === url) return audio;
      const source = audio.querySelector('source[src]');
      if (source && source.src === url) return audio;
    }
    return null;
  }

  function attachPanel(audioEl, voice) {
    const panel = document.createElement('div');
    panel.className = 'cft-voice-panel';
    audioEl.insertAdjacentElement('afterend', panel);
    resetToIdle(panel, voice);
  }

  async function scanForVoices() {
    if (!settings.feature2Enabled) return;

    const chatId = window.CftChatterfyApi.getChatId();
    if (!chatId) return;

    // Одна страница (see docs/TZ.md §0.1.1 — API отдаёт фиксированные 50
    // сообщений, курсорная пагинация за пределы первой страницы сознательно
    // не реализована). Для контекста диалекта Feature 1 этого с запасом
    // хватало (нужно 5-10 последних); для голосовых Feature 2 это значит,
    // что кнопка появится только у голосовых из последних ~50 сообщений
    // чата — более старые не подхватятся без прокрутки истории и повторного
    // скана. Приемлемо для MVP, но если понадобится вся история — сюда же
    // добавлять курсорный проход.
    let messages;
    try {
      messages = await window.CftChatterfyApi.fetchChatMessages(chatId);
    } catch (err) {
      console.warn('[Chatterfy Translator] не удалось получить список сообщений для голосовых:', err);
      return;
    }

    // TZ п.5.1 говорит "у каждого голосового сообщения" без уточнения
    // направления, но живая проверка этапа 1 показала: исходящие голосовые
    // в реальных чатах часто оказываются заготовленными шаблонами оператора
    // (уже на русском) — "перевести на русский" для них бессмысленно, тот
    // же класс проблемы, что был с Feature 1 до фикса направления. Пока
    // ограничиваемся входящими; при необходимости расширить — тривиально.
    for (const m of messages) {
      if (m.sender_type !== 'incoming') continue;
      for (const f of m.files || []) {
        if (f.type !== 'voice' || !f.url) continue;
        if (attachedUrls.has(f.url)) continue;

        const audioEl = findAudioElementForUrl(f.url);
        if (!audioEl) continue; // ещё не отрендерился в DOM или не найден — попробуем на следующем скане

        attachedUrls.add(f.url);
        attachPanel(audioEl, {
          chatId,
          messageId: m.id,
          url: f.url,
          costLabel: estimateCostLabel(f.meta && f.meta.duration),
        });
      }
    }
  }

  setInterval(scanForVoices, RESCAN_INTERVAL_MS);
  scanForVoices();
})();
