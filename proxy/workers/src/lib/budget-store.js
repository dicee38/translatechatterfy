// Workers-эквивалент proxy/src/lib/budget-store.js: та же идея (сумма
// нарастающим итогом за день, TZ п.3.3), но хранилище — KV вместо файла
// на диске (Workers не имеет файловой системы).
//
// KV не даёт атомарный инкремент — та же нежёсткая гарантия, что и у
// файлового варианта на Node (без блокировок): при двух почти
// одновременных запросах возможна мелкая потеря счёта. Для нескольких
// операторов и лимита $5/день это не критично, отмечено как есть.

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// TZ п.3.4: хранится только агрегированная стоимость, без контента.
// TTL — 2 дня, чтобы не копить историю бесконечно (нужен только "сегодня").
const TTL_SECONDS = 60 * 60 * 24 * 2;

async function getDailyTotalUsd(kv) {
  const raw = await kv.get(todayKey());
  return raw ? Number(raw) : 0;
}

async function wouldExceedBudget(kv, dailyBudgetUsd, estimatedCostUsd) {
  const total = await getDailyTotalUsd(kv);
  return total + estimatedCostUsd > dailyBudgetUsd;
}

async function recordCost(kv, costUsd) {
  const key = todayKey();
  const total = (await getDailyTotalUsd(kv)) + costUsd;
  await kv.put(key, String(total), { expirationTtl: TTL_SECONDS });
  return total;
}

async function getBudgetStatus(kv, dailyBudgetUsd) {
  const spent = await getDailyTotalUsd(kv);
  return {
    limitUsd: dailyBudgetUsd,
    spentUsd: Number(spent.toFixed(4)),
    remainingUsd: Number(Math.max(0, dailyBudgetUsd - spent).toFixed(4)),
  };
}

export { getDailyTotalUsd, wouldExceedBudget, recordCost, getBudgetStatus };
