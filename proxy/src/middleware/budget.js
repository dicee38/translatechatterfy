const { wouldExceedBudget, getBudgetStatus } = require('../lib/budget-store');

// TZ п.3.3: при превышении лимита — 429 с понятным телом, не молчаливое
// продолжение трат. Расширение показывает это как отдельное UI-состояние
// ("дневной лимит исчерпан"), не как обычную сетевую ошибку — поэтому
// error: 'budget_exceeded' должен быть стабильным, различимым полем.
function enforceBudget(estimateCostUsd) {
  return (req, res, next) => {
    const estimatedCostUsd = estimateCostUsd(req);

    if (wouldExceedBudget(estimatedCostUsd)) {
      return res.status(429).json({
        error: 'budget_exceeded',
        message: 'Дневной лимит бюджета на перевод/расшифровку исчерпан. Попробуйте завтра.',
        budget: getBudgetStatus(),
      });
    }

    req.estimatedCostUsd = estimatedCostUsd;
    next();
  };
}

module.exports = { enforceBudget };
