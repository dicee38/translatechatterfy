const { config } = require('../config');
const {
  estimateTranscribeCostUsdFromFileSize,
  estimateTranscribeCostUsdFromDuration,
  estimateTranslateCostUsd,
  computeChatCostUsdFromUsage,
} = require('./pricing');

async function transcribe({ fileBuffer, fileName, mimeType }) {
  const estimatedCostUsd = estimateTranscribeCostUsdFromFileSize(fileBuffer.length);

  if (config.mockMode) {
    return {
      transcript: '[MOCK расшифровка] это фиктивный текст голосового сообщения для проверки скелета прокси',
      language: 'ar',
      costUsd: estimatedCostUsd,
    };
  }

  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
  form.append('model', 'gpt-transcribe'); // имя из TZ (уже согласовано, см. этап 1 чек-листа)
  form.append('response_format', 'verbose_json'); // единственный формат, отдающий duration для точного списания

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const actualCostUsd = typeof data.duration === 'number'
    ? estimateTranscribeCostUsdFromDuration(data.duration)
    : estimatedCostUsd;

  return { transcript: data.text ?? '', language: data.language, costUsd: actualCostUsd };
}

// TZ п.4.2 — модель дергается и для перевода (Feature 1), и в перспективе
// для умного ответа (Feature 3, TZ п.6). Раньше это была Claude Haiku,
// теперь — тоже OpenAI, чтобы держать один внешний вендор/один ключ.
function buildTranslatePrompt({ text, dialectContext, targetLang }) {
  const contextBlock = (dialectContext || [])
    .map((line, i) => `${i + 1}. "${line}"`)
    .join('\n');

  // Промпт из TZ п.4.2 — учитывает не только диалект/тон, но и систему
  // письма собеседника (латиница/арабица и т.п.), см. находку из HAR в TZ п.0.1.
  return `Вот последние сообщения собеседника (используй тот же диалект, стиль И систему письма — если он пишет латиницей/арабизи, а не арабской графикой, отвечай тем же способом):
${contextBlock || '(контекст пуст)'}

Переведи следующий текст оператора на тот же диалект${targetLang ? ` (целевой язык: ${targetLang})` : ''}, сохраняя тон и уровень формальности:
"${text}"

Ответь только переводом, без пояснений.`;
}

async function translate({ text, dialectContext, targetLang }) {
  const estimatedCostUsd = estimateTranslateCostUsd({ text, dialectContext });

  if (config.mockMode) {
    return {
      translation: `[MOCK перевод] ${text}`,
      costUsd: estimatedCostUsd,
    };
  }

  const prompt = buildTranslatePrompt({ text, dialectContext, targetLang });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const translation = (data.choices?.[0]?.message?.content ?? '').trim();
  const actualCostUsd = computeChatCostUsdFromUsage(data.usage) || estimatedCostUsd;

  return { translation, costUsd: actualCostUsd };
}

module.exports = { transcribe, translate, buildTranslatePrompt };
