// Приблизительные цены для оценки стоимости запроса (бюджетный счётчик,
// TZ п.3.3). Это ПЛЕЙСХОЛДЕРЫ — проверить точные актуальные цены в
// прайсинге OpenAI/Anthropic перед реальными вызовами вечером и поправить
// здесь при расхождении. Точный дневной лимит и так предварительный
// (TZ п.10), поэтому грубая оценка на старте — ожидаемо, не блокер.

const CLAUDE_HAIKU_PRICE_PER_1M_INPUT_TOKENS_USD = 1.0;
const CLAUDE_HAIKU_PRICE_PER_1M_OUTPUT_TOKENS_USD = 5.0;

const TRANSCRIBE_PRICE_PER_MINUTE_USD = 0.006;

// Грубая оценка токенов из длины строки без токенизатора — 4 символа на
// токен, обычное приближение для латиницы/кириллицы. Для реального
// бюджетного контроля не критична точность до токена, важно не пропустить
// сильно недооценённую стоимость.
function estimateTokensFromText(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function estimateTranslateCostUsd({ text, dialectContext }) {
  const contextText = Array.isArray(dialectContext) ? dialectContext.join(' ') : '';
  const inputTokens = estimateTokensFromText(text) + estimateTokensFromText(contextText) + 200; // +200 на системный промпт
  const outputTokens = estimateTokensFromText(text) + 50; // перевод обычно похожей длины

  const inputCost = (inputTokens / 1_000_000) * CLAUDE_HAIKU_PRICE_PER_1M_INPUT_TOKENS_USD;
  const outputCost = (outputTokens / 1_000_000) * CLAUDE_HAIKU_PRICE_PER_1M_OUTPUT_TOKENS_USD;
  return inputCost + outputCost;
}

// Длительность в секундах не приходит в теле /transcribe (контракт TZ
// п.3.1 — там только файл), поэтому для оценки ДО расшифровки грубо
// прикидываем длительность по размеру файла (типичный битрейт голосовых
// .ogg/opus в Chatterfy ~16-24 kbps -> ~2-3 KB/сек). После реальной
// расшифровки использовать фактическую длительность, если модель её вернёт.
const ASSUMED_BYTES_PER_SECOND = 2500;

function estimateTranscribeCostUsdFromFileSize(fileSizeBytes) {
  const estimatedSeconds = fileSizeBytes / ASSUMED_BYTES_PER_SECOND;
  const estimatedMinutes = estimatedSeconds / 60;
  return estimatedMinutes * TRANSCRIBE_PRICE_PER_MINUTE_USD;
}

function estimateTranscribeCostUsdFromDuration(durationSeconds) {
  return (durationSeconds / 60) * TRANSCRIBE_PRICE_PER_MINUTE_USD;
}

module.exports = {
  estimateTranslateCostUsd,
  estimateTranscribeCostUsdFromFileSize,
  estimateTranscribeCostUsdFromDuration,
};
