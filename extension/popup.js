// Этап 5 (полировка, docs/TZ.md раздел 9 п.5): вкл/выкл Feature 1,
// ручной override диалекта, настройка прокси, индикатор дневного бюджета.
(function () {
  const feature1Checkbox = document.getElementById('feature1Enabled');
  const feature2Checkbox = document.getElementById('feature2Enabled');
  const dialectInput = document.getElementById('manualDialectOverride');
  const clearDialectBtn = document.getElementById('clearDialect');
  const proxyUrlInput = document.getElementById('proxyBaseUrl');
  const tokenInput = document.getElementById('extensionToken');
  const saveProxyBtn = document.getElementById('saveProxyConfig');
  const saveStatusEl = document.getElementById('saveStatus');
  const budgetStatusEl = document.getElementById('budgetStatus');
  const budgetBarFillEl = document.getElementById('budgetBarFill');
  const refreshBudgetBtn = document.getElementById('refreshBudget');

  async function loadSettings() {
    const stored = await chrome.storage.local.get([
      'feature1Enabled',
      'feature2Enabled',
      'manualDialectOverride',
      'proxyBaseUrl',
      'extensionToken',
    ]);

    feature1Checkbox.checked = stored.feature1Enabled !== false; // дефолт: включено
    feature2Checkbox.checked = stored.feature2Enabled !== false; // дефолт: включено
    dialectInput.value = stored.manualDialectOverride || '';
    proxyUrlInput.value = stored.proxyBaseUrl || CFT_DEFAULT_PROXY_BASE_URL;
    tokenInput.value = stored.extensionToken || CFT_DEFAULT_EXTENSION_TOKEN;
  }

  feature1Checkbox.addEventListener('change', () => {
    chrome.storage.local.set({ feature1Enabled: feature1Checkbox.checked });
  });

  feature2Checkbox.addEventListener('change', () => {
    chrome.storage.local.set({ feature2Enabled: feature2Checkbox.checked });
  });

  let dialectSaveTimer = null;
  dialectInput.addEventListener('input', () => {
    clearTimeout(dialectSaveTimer);
    dialectSaveTimer = setTimeout(() => {
      chrome.storage.local.set({ manualDialectOverride: dialectInput.value.trim() });
    }, 300);
  });

  clearDialectBtn.addEventListener('click', () => {
    dialectInput.value = '';
    chrome.storage.local.set({ manualDialectOverride: '' });
  });

  saveProxyBtn.addEventListener('click', async () => {
    const proxyBaseUrl = proxyUrlInput.value.trim() || CFT_DEFAULT_PROXY_BASE_URL;
    const extensionToken = tokenInput.value.trim() || CFT_DEFAULT_EXTENSION_TOKEN;
    await chrome.storage.local.set({ proxyBaseUrl, extensionToken });
    saveStatusEl.textContent = 'Сохранено';
    setTimeout(() => { saveStatusEl.textContent = ''; }, 1500);
    refreshBudget();
  });

  function renderBudget(status) {
    if (status.error) {
      budgetStatusEl.textContent = status.error;
      budgetStatusEl.classList.add('cft-budget--error');
      budgetBarFillEl.style.width = '0%';
      return;
    }

    budgetStatusEl.classList.remove('cft-budget--error');
    const { limitUsd, spentUsd, remainingUsd } = status.budget;
    budgetStatusEl.textContent = `Потрачено $${spentUsd.toFixed(4)} из $${limitUsd.toFixed(2)} (осталось $${remainingUsd.toFixed(4)})`;

    const ratio = limitUsd > 0 ? Math.min(1, spentUsd / limitUsd) : 1;
    budgetBarFillEl.style.width = `${Math.round(ratio * 100)}%`;
    budgetBarFillEl.classList.remove('cft-budget-bar__fill--warn', 'cft-budget-bar__fill--full');
    if (ratio >= 1) budgetBarFillEl.classList.add('cft-budget-bar__fill--full');
    else if (ratio >= 0.7) budgetBarFillEl.classList.add('cft-budget-bar__fill--warn');
  }

  async function refreshBudget() {
    budgetStatusEl.textContent = 'Проверяю...';
    budgetStatusEl.classList.remove('cft-budget--error');

    const stored = await chrome.storage.local.get(['proxyBaseUrl']);
    const proxyBaseUrl = stored.proxyBaseUrl || CFT_DEFAULT_PROXY_BASE_URL;

    try {
      const res = await fetch(`${proxyBaseUrl}/health`);
      if (!res.ok) throw new Error(`прокси ответил ${res.status}`);
      const data = await res.json();
      if (!data.budget) throw new Error('прокси не вернул данные о бюджете');
      renderBudget({ budget: data.budget });
    } catch (err) {
      renderBudget({ error: `Прокси недоступен (${proxyUrlInput.value.trim() || CFT_DEFAULT_PROXY_BASE_URL}). Он запущен?` });
    }
  }

  refreshBudgetBtn.addEventListener('click', refreshBudget);

  loadSettings().then(refreshBudget);
})();
