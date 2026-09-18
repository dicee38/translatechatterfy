const { config } = require('../config');
const { estimateTranscribeCostUsdFromFileSize } = require('./pricing');

async function transcribe({ fileBuffer, fileName, mimeType }) {
  const estimatedCostUsd = estimateTranscribeCostUsdFromFileSize(fileBuffer.length);

  if (config.mockMode) {
    return {
      transcript: '[MOCK расшифровка] это фиктивный текст голосового сообщения для проверки скелета прокси',
      language: 'ar',
      costUsd: estimatedCostUsd,
    };
  }

  // TODO(вечер): реальный вызов OpenAI transcription API. Подставить
  // OPENAI_API_KEY (уже читается в config.openaiApiKey) и раскомментировать:
  //
  // const form = new FormData();
  // form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
  // form.append('model', 'gpt-4o-transcribe'); // или актуальное имя STT-модели
  //
  // const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  //   method: 'POST',
  //   headers: { Authorization: `Bearer ${config.openaiApiKey}` },
  //   body: form,
  // });
  // if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  // const data = await response.json();
  // const actualCostUsd = estimateTranscribeCostUsdFromDuration(data.duration ?? 0);
  //
  // return { transcript: data.text, language: data.language, costUsd: actualCostUsd };

  throw new Error('OpenAI API вызов не реализован: MOCK_MODE=false, но реального вызова ещё нет (ключей не было на момент разработки).');
}

module.exports = { transcribe };
