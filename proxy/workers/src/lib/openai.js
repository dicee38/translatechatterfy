import { estimateTranscribeCostUsdFromFileSize, estimateTranslateCostUsd } from './pricing.js';

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

  // TODO(вечер): реальный вызов OpenAI chat completions — то же самое, что
  // в proxy/src/lib/openai.js (см. TODO там про имя модели/цену), только
  // ключ читается из cfg.openaiApiKey (пришёл через env, не process.env):
  //
  // const response = await fetch('https://api.openai.com/v1/chat/completions', {
  //   method: 'POST',
  //   headers: {
  //     Authorization: `Bearer ${cfg.openaiApiKey}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     model: 'gpt-4.1-mini', // TODO: сверить актуальное имя/цену
  //     messages: [{ role: 'user', content: prompt }],
  //   }),
  // });
  // if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  // const data = await response.json();
  // const translation = data.choices?.[0]?.message?.content ?? '';
  // const actualCostUsd = computeActualCostFromUsage(data.usage);
  //
  // return { translation, costUsd: actualCostUsd };

  throw new Error('OpenAI API вызов не реализован: MOCK_MODE=false, но реального вызова ещё нет (ключей не было на момент разработки).');
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

  // TODO(вечер): реальный вызов OpenAI transcription API. В Workers
  // multipart/form-data собирается нативным FormData (без multer/busboy):
  //
  // const form = new FormData();
  // form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
  // form.append('model', 'gpt-4o-transcribe'); // или актуальное имя STT-модели
  //
  // const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  //   method: 'POST',
  //   headers: { Authorization: `Bearer ${cfg.openaiApiKey}` },
  //   body: form,
  // });
  // if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  // const data = await response.json();
  //
  // return { transcript: data.text, language: data.language, costUsd: estimateTranscribeCostUsdFromDuration(data.duration ?? 0) };

  throw new Error('OpenAI API вызов не реализован: MOCK_MODE=false, но реального вызова ещё нет (ключей не было на момент разработки).');
}
