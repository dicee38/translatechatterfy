const { config } = require('../config');
const { estimateTranslateCostUsd } = require('./pricing');

function buildTranslatePrompt({ text, dialectContext, targetLang }) {
  const contextBlock = (dialectContext || [])
    .map((line, i) => `${i + 1}. "${line}"`)
    .join('\n');

  // TZ п.4.2 — промпт учитывает не только диалект/тон, но и систему письма
  // собеседника (латиница/арабица и т.п.), см. находку из HAR в TZ п.0.1.
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

  // TODO(вечер): реальный вызов Claude API. Подставить ANTHROPIC_API_KEY
  // (уже читается в config.anthropicApiKey) и раскомментировать/доделать:
  //
  // const response = await fetch('https://api.anthropic.com/v1/messages', {
  //   method: 'POST',
  //   headers: {
  //     'x-api-key': config.anthropicApiKey,
  //     'anthropic-version': '2023-06-01',
  //     'content-type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     model: 'claude-haiku-4-5',
  //     max_tokens: 1024,
  //     messages: [{ role: 'user', content: prompt }],
  //   }),
  // });
  // if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
  // const data = await response.json();
  // const translation = data.content?.[0]?.text ?? '';
  // const actualCostUsd = computeActualCostFromUsage(data.usage); // input/output tokens * pricing.js
  //
  // return { translation, costUsd: actualCostUsd };

  throw new Error('Claude API вызов не реализован: MOCK_MODE=false, но реального вызова ещё нет (ключей не было на момент разработки).');
}

module.exports = { translate, buildTranslatePrompt };
