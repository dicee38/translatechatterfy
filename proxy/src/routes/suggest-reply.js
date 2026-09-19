const express = require('express');
const { enforceBudget } = require('../middleware/budget');
const { estimateSuggestReplyCostUsd } = require('../lib/pricing');
const { recordCost } = require('../lib/budget-store');
const openai = require('../lib/openai');

const router = express.Router();

function isValidConversationContext(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((m) => m && (m.role === 'operator' || m.role === 'interlocutor') && typeof m.text === 'string' && m.text.trim())
  );
}

// TZ п.3.1: POST /suggest-reply { conversationContext } -> { replyInDialect, backTranslationRu }
router.post(
  '/suggest-reply',
  enforceBudget((req) => estimateSuggestReplyCostUsd(req.body || {})),
  async (req, res, next) => {
    try {
      const { conversationContext } = req.body || {};

      if (!isValidConversationContext(conversationContext)) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'Поле conversationContext обязательно: непустой массив { role: "operator"|"interlocutor", text: string }.',
        });
      }

      const result = await openai.suggestReply({ conversationContext });

      // TZ п.3.4: в лог/хранилище уходит только стоимость, не текст диалога.
      recordCost(result.costUsd);

      res.json({ replyInDialect: result.replyInDialect, backTranslationRu: result.backTranslationRu });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
