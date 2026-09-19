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

// Живая проверка показала: инструкция "ответь только переводом, без
// пояснений", зашитая внутрь user-сообщения, не всегда соблюдается —
// на неоднозначном/грязном тексте модель иногда отвечала целым
// рассуждением ("похоже, это казахский язык... примерный смысл...")
// вместо чистого перевода. Вынесено в отдельное system-сообщение —
// модели заметно надёжнее следуют системным инструкциям, чем тем же
// текстом внутри user-хода.
const TRANSLATE_SYSTEM_PROMPT = 'Ты выполняешь только одну задачу — перевод текста. Отвечай СТРОГО только самим переводом: без пояснений, без анализа языка/диалекта, без вариантов, без вводных фраз вроде "Похоже, это..." или "Примерный смысл:", без кавычек вокруг перевода. Даже если текст короткий, неоднозначный или содержит опечатки — всё равно дай один наиболее вероятный перевод, никогда не описывай, что текст непонятен.';

// TZ п.4.2 — модель дергается и для перевода (Feature 1), и в перспективе
// для умного ответа (Feature 3, TZ п.6). Раньше это была Claude Haiku,
// теперь — тоже OpenAI, чтобы держать один внешний вендор/один ключ.
//
// direction: 'to_dialect' (по умолчанию, TZ п.4.2 как задумано — оператор
// пишет черновик, перевод идёт В диалект собеседника для отправки) или
// 'to_operator_language' (обратное — прочитать входящее сообщение
// собеседника на русском). Направление определяет content.js по алфавиту
// выделенного текста (см. detectDirection в extension/content.js).
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

  // Промпт из TZ п.4.2 — учитывает не только диалект/тон, но и систему
  // письма собеседника (латиница/арабица и т.п.), см. находку из HAR в TZ п.0.1.
  return `Вот последние сообщения собеседника (используй тот же диалект, стиль И систему письма — если он пишет латиницей/арабизи, а не арабской графикой, отвечай тем же способом):
${contextBlock || '(контекст пуст)'}

Переведи следующий текст оператора на тот же диалект${targetLang ? ` (целевой язык: ${targetLang})` : ''}, сохраняя тон и уровень формальности:
"${text}"

Ответь только переводом, без пояснений.`;
}

async function translate({ text, dialectContext, targetLang, direction }) {
  const estimatedCostUsd = estimateTranslateCostUsd({ text, dialectContext });

  if (config.mockMode) {
    return {
      translation: `[MOCK перевод] ${text}`,
      costUsd: estimatedCostUsd,
    };
  }

  const prompt = buildTranslatePrompt({ text, dialectContext, targetLang, direction });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
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
