// Service worker: единственное место в расширении, которое реально ходит
// в прокси. Content script никогда не ходит туда напрямую — шлёт
// сообщение сюда, это исключает зависимость от CSP/CORS конкретной
// страницы Chatterfy и держит сетевой код прокси в одном месте.
// Адрес прокси и токен настраиваются через попап (этап 5, popup.js),
// хранятся в chrome.storage.local; дефолты на случай, если оператор ещё
// ничего не сохранял, — см. shared-defaults.js.
importScripts('shared-defaults.js');

// TODO(вечер): CFT_DEFAULT_EXTENSION_TOKEN в shared-defaults.js должен
// совпадать с EXTENSION_TOKEN из proxy/.env на реальном/локальном прокси
// (или просто сохраните свой токен через попап — он переживёт дефолт).
async function getProxyConfig() {
  const stored = await chrome.storage.local.get(['proxyBaseUrl', 'extensionToken']);
  return {
    proxyBaseUrl: stored.proxyBaseUrl || CFT_DEFAULT_PROXY_BASE_URL,
    extensionToken: stored.extensionToken || CFT_DEFAULT_EXTENSION_TOKEN,
  };
}

async function handleTranslate({ text, dialectContext, targetLang }) {
  const { proxyBaseUrl, extensionToken } = await getProxyConfig();

  let response;
  try {
    response = await fetch(`${proxyBaseUrl}/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Token': extensionToken,
      },
      body: JSON.stringify({ text, dialectContext: dialectContext || [], targetLang }),
    });
  } catch (err) {
    return { ok: false, kind: 'network_error', message: 'Не удалось связаться с прокси.' };
  }

  if (response.status === 429) {
    const body = await response.json().catch(() => ({}));
    return { ok: false, kind: 'budget_exceeded', message: body.message || 'Дневной лимит бюджета на перевод исчерпан.' };
  }

  if (!response.ok) {
    return { ok: false, kind: 'network_error', message: `Прокси вернул ошибку ${response.status}.` };
  }

  const data = await response.json().catch(() => null);
  if (!data || typeof data.translation !== 'string') {
    return { ok: false, kind: 'network_error', message: 'Прокси вернул неожиданный ответ.' };
  }

  return { ok: true, translation: data.translation };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'translate') {
    handleTranslate(message.payload || {})
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, kind: 'network_error', message: String(err) }));
    return true; // ответ асинхронный
  }
  return false;
});
