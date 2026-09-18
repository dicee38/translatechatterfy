// Самопроверка Workers-скелета БЕЗ wrangler/Cloudflare-аккаунта и БЕЗ
// реальных ключей: вызывает экспортированный `fetch(request, env)`
// напрямую (Workers-модуль — обычный JS с Fetch API, Node их тоже
// понимает), с фейковым KV вместо настоящего. Проверяет то же самое,
// что proxy/test/verify-skeleton.js для Node-версии: auth, роутинг,
// бюджетный счётчик — на моках.
//
// Запуск: npm run test:skeleton (из proxy/workers/).
// Это НЕ проверяет реальный деплой/wrangler dev — только логику воркера.

import worker from '../src/index.js';

const TOKEN = 'test-token-for-skeleton-check';

function createFakeKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    MOCK_MODE: 'true',
    EXTENSION_TOKEN: TOKEN,
    OPENAI_API_KEY: '',
    DAILY_BUDGET_USD: '5',
    BUDGET_KV: createFakeKv(),
    ...overrides,
  };
}

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures += 1;
  }
}

async function run() {
  console.log('== Health / auth / роутинг (обычный бюджет $5/день) ==');
  const env = makeEnv();

  const health = await worker.fetch(new Request('http://local/health'), env).then((r) => r.json());
  check('GET /health отвечает mockMode: true', health.mockMode === true);

  const noAuth = await worker.fetch(
    new Request('http://local/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello', dialectContext: [] }),
    }),
    env
  );
  check('POST /translate без токена -> 401', noAuth.status === 401);

  const badAuth = await worker.fetch(
    new Request('http://local/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Extension-Token': 'wrong-token' },
      body: JSON.stringify({ text: 'hello', dialectContext: [] }),
    }),
    env
  );
  check('POST /translate с неверным токеном -> 401', badAuth.status === 401);

  const okTranslate = await worker.fetch(
    new Request('http://local/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Extension-Token': TOKEN },
      body: JSON.stringify({ text: 'Привет, как дела?', dialectContext: ['salam', 'ca va?'] }),
    }),
    env
  );
  const okTranslateBody = await okTranslate.json();
  check('POST /translate с верным токеном -> 200', okTranslate.status === 200);
  check(
    'POST /translate возвращает мок-перевод',
    typeof okTranslateBody.translation === 'string' && okTranslateBody.translation.includes('[MOCK')
  );

  const badBody = await worker.fetch(
    new Request('http://local/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Extension-Token': TOKEN },
      body: JSON.stringify({ dialectContext: [] }),
    }),
    env
  );
  check('POST /translate без text -> 400', badBody.status === 400);

  const fakeOggBytes = new Uint8Array(50_000).fill(7);
  const form = new FormData();
  form.append('file', new Blob([fakeOggBytes], { type: 'audio/ogg' }), 'voice.ogg');
  const okTranscribe = await worker.fetch(
    new Request('http://local/transcribe', {
      method: 'POST',
      headers: { 'X-Extension-Token': TOKEN },
      body: form,
    }),
    env
  );
  const okTranscribeBody = await okTranscribe.json();
  check('POST /transcribe с файлом и верным токеном -> 200', okTranscribe.status === 200);
  check(
    'POST /transcribe возвращает мок-расшифровку',
    typeof okTranscribeBody.transcript === 'string' && okTranscribeBody.transcript.includes('[MOCK')
  );

  const noAuthTranscribe = await worker.fetch(
    new Request('http://local/transcribe', { method: 'POST', body: new FormData() }),
    env
  );
  check('POST /transcribe без токена -> 401', noAuthTranscribe.status === 401);

  console.log('== Нулевой бюджет (проверка 429) ==');
  const zeroBudgetEnv = makeEnv({ DAILY_BUDGET_USD: '0' });
  const overBudget = await worker.fetch(
    new Request('http://local/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Extension-Token': TOKEN },
      body: JSON.stringify({ text: 'Привет, как дела?', dialectContext: [] }),
    }),
    zeroBudgetEnv
  );
  const overBudgetBody = await overBudget.json();
  check('POST /translate при нулевом бюджете -> 429', overBudget.status === 429);
  check('POST /translate 429 содержит error: budget_exceeded', overBudgetBody.error === 'budget_exceeded');

  console.log('== EXTENSION_TOKEN не задан на сервере ==');
  const misconfiguredEnv = makeEnv({ EXTENSION_TOKEN: '' });
  const misconfigured = await worker.fetch(
    new Request('http://local/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    }),
    misconfiguredEnv
  );
  check('POST /translate без EXTENSION_TOKEN на сервере -> 500', misconfigured.status === 500);

  console.log('');
  if (failures > 0) {
    console.error(`Провалено проверок: ${failures}`);
    process.exit(1);
  } else {
    console.log('Все проверки Workers-скелета прошли (auth, роутинг, бюджет на фейковом KV) — без wrangler/аккаунта Cloudflare и без единого реального вызова модели.');
  }
}

run().catch((err) => {
  console.error('Ошибка самопроверки:', err);
  process.exit(1);
});
