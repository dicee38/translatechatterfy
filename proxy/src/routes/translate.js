const express = require('express');
const { enforceBudget } = require('../middleware/budget');
const { estimateTranslateCostUsd } = require('../lib/pricing');
const { recordCost } = require('../lib/budget-store');
const claude = require('../lib/claude');

const router = express.Router();

// TZ п.3.1: POST /translate { text, dialectContext, targetLang? } -> { translation }
router.post(
  '/translate',
  enforceBudget((req) => estimateTranslateCostUsd(req.body || {})),
  async (req, res, next) => {
    try {
      const { text, dialectContext, targetLang } = req.body || {};

      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'bad_request', message: 'Поле text обязательно и должно быть непустой строкой.' });
      }
      if (dialectContext !== undefined && !Array.isArray(dialectContext)) {
        return res.status(400).json({ error: 'bad_request', message: 'Поле dialectContext должно быть массивом строк.' });
      }

      const result = await claude.translate({ text, dialectContext: dialectContext || [], targetLang });

      // TZ п.3.4: в лог/хранилище уходит только стоимость, не текст.
      recordCost(result.costUsd);

      res.json({ translation: result.translation });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
