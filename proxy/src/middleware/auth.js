const { config } = require('../config');

// TZ п.3.2: фиксированный секретный токен в заголовке X-Extension-Token.
// Токен можно вытащить из расширения, как и ключ модели — это ожидаемо и
// ограничивается бюджетным лимитом (budget.js), а не секретностью токена.
function requireExtensionToken(req, res, next) {
  const provided = req.get('X-Extension-Token');

  if (!provided || provided !== config.extensionToken) {
    return res.status(401).json({ error: 'unauthorized', message: 'Неверный или отсутствующий X-Extension-Token.' });
  }

  next();
}

module.exports = { requireExtensionToken };
