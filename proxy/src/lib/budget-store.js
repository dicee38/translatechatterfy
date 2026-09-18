const fs = require('fs');
const path = require('path');
const { config } = require('../config');

// TZ п.3.3: суммарная стоимость нарастающим итогом за день, в простом
// хранилище. Для VPS-варианта деплоя — файл на диске; для Cloudflare
// Workers это же место заменяется на KV (интерфейс ниже не меняется).
// TZ п.3.4: хранится только агрегированная стоимость, без самого контента.
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'budget.json');

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function getDailyTotalUsd() {
  const store = readStore();
  return store[todayKey()] || 0;
}

function wouldExceedBudget(estimatedCostUsd) {
  return getDailyTotalUsd() + estimatedCostUsd > config.dailyBudgetUsd;
}

function recordCost(costUsd) {
  const store = readStore();
  const key = todayKey();
  store[key] = (store[key] || 0) + costUsd;
  writeStore(store);
  return store[key];
}

function getBudgetStatus() {
  const spent = getDailyTotalUsd();
  return {
    limitUsd: config.dailyBudgetUsd,
    spentUsd: Number(spent.toFixed(4)),
    remainingUsd: Number(Math.max(0, config.dailyBudgetUsd - spent).toFixed(4)),
  };
}

module.exports = { getDailyTotalUsd, wouldExceedBudget, recordCost, getBudgetStatus };
