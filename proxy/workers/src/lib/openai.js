import {
  estimateTranscribeCostUsdFromFileSize,
  estimateTranscribeCostUsdFromDuration,
  estimateTranslateCostUsd,
  computeChatCostUsdFromUsage,
} from './pricing.js';

// Промпт — тот же, что в proxy/src/lib/openai.js (TZ п.4.2), держать в
// синхроне вручную по той же причине, что и pricing.js (см. комментарий там).
//
// direction: 'to_dialect' (по умолчанию, TZ п.4.2 как задумано — оператор
// пишет черновик, перевод идёт В диалект собеседника для отправки) или
// 'to_operator_language' (обратное — прочитать входящее сообщение
// собеседника на русском). Добавлено после живой проверки на реальном
// Chatterfy: выделение входящего сообщения и перевод "в диалект
// собеседника" давало перевод "с арабского на арабский" — текст и так уже
// на этом диалекте. Направление определяет content.js по sender_type
// найденного сообщения (см. findSenderTypeForSelection).
function buildTranslatePrompt({ text, dialectContext, targetLang, direction }) {
  const contextBlock = (dialectContext || [])
    .map((line, i) => `${i + 1}. "${line}"`)
    .join('\n');

  if (direction === 'to_operator_language') {
    return `Вот сообщение от собеседника и контекст последних его сообщений (для лучшего понимания диалекта/сленга):
${contextBlock || '(контекст пуст)'}

Переведи следующее сообщение собеседника на литературный русский язык, сохраняя смысл и тон:
"${text}"

Ответь только переводом, без пояснений.`;
  }

  return `Вот последние сообщения собеседника (используй тот же диалект, стиль И систему письма — если он пишет латиницей/арабизи, а не арабской графикой, отвечай тем же способом):
${contextBlock || '(контекст пуст)'}

Переведи следующий текст оператора на тот же диалект${targetLang ? ` (целевой язык: ${targetLang})` : ''}, сохраняя тон и уровень формальности:
"${text}"

Ответь только переводом, без пояснений.`;
}

export async function translate(cfg, { text, dialectContext, targetLang, direction }) {
  const estimatedCostUsd = estimateTranslateCostUsd({ text, dialectContext });

  if (cfg.mockMode) {
    return { translation: `[MOCK перевод] ${text}`, costUsd: estimatedCostUsd };
  }

  const prompt = buildTranslatePrompt({ text, dialectContext, targetLang, direction });

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
