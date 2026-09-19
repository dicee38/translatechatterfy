// Дублирует proxy/src/lib/pricing.js — держать в синхроне вручную.
// Не шарится между Node- и Workers-версией прокси напрямую: разные
// системы модулей (CommonJS vs Workers ESM) и разные деплой-таргеты,
// а сам файл — чистые вычисления без I/O, дублировать дешевле, чем
// городить cross-runtime import ради ~50 строк.
//
// Приблизительные цены для оценки стоимости запроса (бюджетный счётчик,
// TZ п.3.3). Это ПЛЕЙСХОЛДЕРЫ — проверить точные актуальные цены в
// прайсинге OpenAI перед реальными вызовами и поправить здесь при
// расхождении (см. также TODO в lib/openai.js про имя модели).

const OPENAI_CHAT_PRICE_PER_1M_INPUT_TOKENS_USD = 0.4;
const OPENAI_CHAT_PRICE_PER_1M_OUTPUT_TOKENS_USD = 1.6;

// Откалибровано по реальному расходу на этапе 1 (9 голосовых, ~5.1 мин,
// $0.2564 факта) — вышло ~$0.05/мин, заметно дороже старого плейсхолдера
// $0.006/мин (это была цена Whisper, gpt-transcribe дороже). Раз duration
// из ответа недоступен (verbose_json не поддерживается, см. lib/openai.js),
// эта константа — единственный способ оценить стоимость, точность важна.
const TRANSCRIBE_PRICE_PER_MINUTE_USD = 0.05;

function estimateTokensFromText(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateTranslateCostUsd({ text, dialectContext }) {
  const contextText = Array.isArray(dialectContext) ? dialectContext.join(' ') : '';
  const inputTokens = estimateTokensFromText(text) + estimateTokensFromText(contextText) + 200;
  const outputTokens = estimateTokensFromText(text) + 50;

  const inputCost = (inputTokens / 1_000_000) * OPENAI_CHAT_PRICE_PER_1M_INPUT_TOKENS_USD;
  const outputCost = (outputTokens / 1_000_000) * OPENAI_CHAT_PRICE_PER_1M_OUTPUT_TOKENS_USD;
  return inputCost + outputCost;
}

// Feature 3 (TZ п.6): контекст диалога обычно больше, чем у /translate
// (10-15 сообщений с обеих сторон, не 5-10 только входящих), и системный
// промпт длиннее (просим строгий JSON с двумя полями) — отдельная оценка.
export function estimateSuggestReplyCostUsd({ conversationContext, operatorPersona }) {
  const contextText = Array.isArray(conversationContext)
    ? conversationContext.map((m) => (m && m.text) || '').join(' ')
    : '';
  const inputTokens = estimateTokensFromText(contextText) + estimateTokensFromText(operatorPersona) + 300;
  const outputTokens = 300;
  const inputCost = (inputTokens / 1_000_000) * OPENAI_CHAT_PRICE_PER_1M_INPUT_TOKENS_USD;
  const outputCost = (outputTokens / 1_000_000) * OPENAI_CHAT_PRICE_PER_1M_OUTPUT_TOKENS_USD;
  return inputCost + outputCost;
}

const ASSUMED_BYTES_PER_SECOND = 2500;

export function estimateTranscribeCostUsdFromFileSize(fileSizeBytes) {
  const estimatedSeconds = fileSizeBytes / ASSUMED_BYTES_PER_SECOND;
  const estimatedMinutes = estimatedSeconds / 60;
  return estimatedMinutes * TRANSCRIBE_PRICE_PER_MINUTE_USD;
}

export function estimateTranscribeCostUsdFromDuration(durationSeconds) {
  return (durationSeconds / 60) * TRANSCRIBE_PRICE_PER_MINUTE_USD;
}

// Фактическая стоимость по реальному usage из ответа OpenAI (точнее
// оценки по длине строки из estimateTranslateCostUsd) — считать бюджетный
// расход по факту, когда он известен, а не по грубой прикидке до вызова.
export function computeChatCostUsdFromUsage(usage) {
  if (!usage) return 0;
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;
  const inputCost = (inputTokens / 1_000_000) * OPENAI_CHAT_PRICE_PER_1M_INPUT_TOKENS_USD;
  const outputCost = (outputTokens / 1_000_000) * OPENAI_CHAT_PRICE_PER_1M_OUTPUT_TOKENS_USD;
  return inputCost + outputCost;
}
