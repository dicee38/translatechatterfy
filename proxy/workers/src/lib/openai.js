import {
  estimateTranscribeCostUsdFromFileSize,
  estimateTranscribeCostUsdFromDuration,
  estimateTranslateCostUsd,
  computeChatCostUsdFromUsage,
} from './pricing.js';

// Промпт — тот же, что в proxy/src/lib/openai.js (TZ п.4.2), держать в
// синхроне вручную по той же причине, что и pricing.js (см. комментарий там).
function buildTranslatePrompt({ text, dialectContext, targetLang }) {
  const contextBlock = (dialectContext || [])
    .map((line, i) => `${i + 1}. "${line}"`)
    .join('\n');

  return `Вот последние сообщения собеседника (используй тот же диалект, стиль И систему письма — если он пишет латиницей/арабизи, а не арабской графикой, отвечай тем же способом):
${contextBlock || '(контекст пуст)'}

Переведи следующий текст оператора на тот же диалект${targetLang ? ` (целевой язык: ${targetLang})` : ''}, сохраняя тон и уровень формальности:
"${text}"

Ответь только переводом, без пояснений.`;
}

export async function translate(cfg, { text, dialectContext, targetLang }) {
  const estimatedCostUsd = estimateTranslateCostUsd({ text, dialectContext });

  if (cfg.mockMode) {
    return { translation: `[MOCK перевод] ${text}`, costUsd: estimatedCostUsd };
  }

  const prompt = buildTranslatePrompt({ text, dialectContext, targetLang });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.openaiApiKey}`,
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

export async function transcribe(cfg, { fileBuffer, fileName, mimeType }) {
  const estimatedCostUsd = estimateTranscribeCostUsdFromFileSize(fileBuffer.length);

  if (cfg.mockMode) {
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
    headers: { Authorization: `Bearer ${cfg.openaiApiKey}` },
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
