// Workers не знает process.env — значения приходят через `env`, переданный
// в fetch(request, env, ctx). Тот же `||`-баг, что чинили в Node-версии:
// DAILY_BUDGET_USD="0" (валидный лимит "всё исчерпано") — falsy строка "0"
// после Number() тоже 0, что само по себе falsy, так что || 5 тихо
// подменил бы явный ноль дефолтом. numberFromEnv так не делает.
function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
}

export function config(env) {
  return {
    mockMode: env.MOCK_MODE === 'true',
    extensionToken: env.EXTENSION_TOKEN || '',
    openaiApiKey: env.OPENAI_API_KEY || '',
    dailyBudgetUsd: numberFromEnv(env.DAILY_BUDGET_USD, 5),
  };
}
