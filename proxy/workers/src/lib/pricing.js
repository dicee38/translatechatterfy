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

const TRANSCRIBE_PRICE_PER_MINUTE_USD = 0.006;

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

const ASSUMED_BYTES_PER_SECOND = 2500;

export function estimateTranscribeCostUsdFromFileSize(fileSizeBytes) {
  const estimatedSeconds = fileSizeBytes / ASSUMED_BYTES_PER_SECOND;
  const estimatedMinutes = estimatedSeconds / 60;
  return estimatedMinutes * TRANSCRIBE_PRICE_PER_MINUTE_USD;
}

export function estimateTranscribeCostUsdFromDuration(durationSeconds) {
  return (durationSeconds / 60) * TRANSCRIBE_PRICE_PER_MINUTE_USD;
}
