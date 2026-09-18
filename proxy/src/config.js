require('dotenv').config();

const MOCK_MODE = process.env.MOCK_MODE === 'true';

// `||` тут был бы багом: DAILY_BUDGET_USD=0 (валидное значение, "лимит
// исчерпан всегда") — falsy, `Number('0') || 5` тихо подменило бы его на 5.
function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
}

const config = {
  port: numberFromEnv(process.env.PORT, 8787),
  mockMode: MOCK_MODE,
  extensionToken: process.env.EXTENSION_TOKEN || '',
  // Один вендор на всё: транскрипция (TZ п.5.2) и перевод/умный ответ
  // (TZ п.4.2, 6.2) теперь оба на OpenAI — один ключ, не два.
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  dailyBudgetUsd: numberFromEnv(process.env.DAILY_BUDGET_USD, 5),
};

// Fail closed, not open: без токена авторизация бессмысленна (TZ п.3.2),
// без ключей вне мок-режима реальные вызовы всё равно провалятся —
// лучше не стартовать вообще, чем стартовать и тихо 500-ить на каждый запрос.
function assertStartupInvariants() {
  const problems = [];

  if (!config.extensionToken) {
    problems.push('EXTENSION_TOKEN не задан — авторизация прокси невозможна (TZ п.3.2).');
  }

  if (!config.mockMode) {
    if (!config.openaiApiKey) {
      problems.push('MOCK_MODE=false, но OPENAI_API_KEY пуст.');
    }
  }

  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Прокси не запущен, обнаружены проблемы конфигурации:\n' + problems.map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }
}

module.exports = { config, assertStartupInvariants };
