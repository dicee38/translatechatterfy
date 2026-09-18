// Единственное место с дефолтами для локальной разработки — чтобы
// background.js (реальные запросы) и popup.js (форма настроек/бюджет)
// не могли разъехаться. TODO(вечер): после деплоя прокси — либо поменять
// дефолт здесь на реальный домен, либо просто сохранить его через попап
// (тогда он переживёт эти дефолты, см. chrome.storage.local).
const CFT_DEFAULT_PROXY_BASE_URL = 'http://localhost:8787';
const CFT_DEFAULT_EXTENSION_TOKEN = 'dev-local-token';
