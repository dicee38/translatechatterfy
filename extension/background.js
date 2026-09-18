// Service worker: единственное место в расширении, которое знает адрес
// прокси и токен авторизации. Content script никогда не ходит в прокси
// напрямую — шлёт сообщение сюда, это исключает зависимость от CSP/CORS
// конкретной страницы Chatterfy и держит конфиг прокси в одном месте
// (проще будет добавить UI настроек на этапе 5).

// TODO(этап 5): вынести proxyBaseUrl/extensionToken в попап настроек
// (chrome.storage.local), сейчас дефолты — для локальной разработки.
// TODO(вечер): DEFAULT_EXTENSION_TOKEN должен совпадать с EXTENSION_TOKEN
// из proxy/.env на реальном/локальном прокси.
const DEFAULT_PROXY_BASE_URL = 'http://localhost:8787';
const DEFAULT_EXTENSION_TOKEN = 'dev-local-token';

async function getProxyConfig() {
  const stored = await chrome.storage.local.get(['proxyBaseUrl', 'extensionToken']);
  return {
    proxyBaseUrl: stored.proxyBaseUrl || DEFAULT_PROXY_BASE_URL,
    extensionToken: stored.extensionToken || DEFAULT_EXTENSION_TOKEN,
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
