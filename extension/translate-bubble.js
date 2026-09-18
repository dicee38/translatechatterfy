// Плашка перевода по выделению (TZ п.4.1, 4.3). Загружается как обычный
// content script (не ES-модуль), поэтому экспортируется через глобальный
// объект window.CftTranslateBubble — content.js дергает его методы.
(function () {
  let el = null;
  let outsideClickHandler = null;

  function removeExisting() {
    if (el) {
      el.remove();
      el = null;
    }
    if (outsideClickHandler) {
      document.removeEventListener('mousedown', outsideClickHandler, true);
      outsideClickHandler = null;
    }
  }

  function positionNear(rect) {
    el.style.left = `${window.scrollX + rect.left}px`;
    el.style.top = `${window.scrollY + rect.bottom + 6}px`;
  }

  function create(rect) {
    removeExisting();
    el = document.createElement('div');
    el.className = 'cft-bubble';
    document.body.appendChild(el);
    positionNear(rect);

    outsideClickHandler = (e) => {
      if (el && !el.contains(e.target)) hide();
    };
    // capture-фаза, чтобы поймать клик раньше, чем страница Chatterfy
    // остановит всплытие где-нибудь в своих обработчиках.
    document.addEventListener('mousedown', outsideClickHandler, true);

    return el;
  }

  function hide() {
    removeExisting();
  }

  // Начальное состояние: просто кнопка "Перевести" (TZ 4.1 п.2-3 — плашка
  // появляется сразу при выделении, а "Перевожу..." — только после клика).
  function showIdle(rect, onTranslateClick) {
    create(rect);
    el.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'cft-bubble__row';

    const btn = document.createElement('button');
    btn.className = 'cft-bubble__btn';
    btn.type = 'button';
    btn.textContent = 'Перевести';
    btn.addEventListener('click', onTranslateClick);

    const close = document.createElement('button');
    close.className = 'cft-bubble__btn cft-bubble__btn--ghost';
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', hide);

    row.appendChild(btn);
    row.appendChild(close);
    el.appendChild(row);
  }

  function showLoading() {
    if (!el) return;
    el.classList.remove('cft-bubble--error', 'cft-bubble--budget');
    el.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'cft-bubble__row';
    const spinner = document.createElement('div');
    spinner.className = 'cft-bubble__spinner';
    const text = document.createElement('div');
    text.className = 'cft-bubble__text';
    text.textContent = 'Перевожу...';
    row.appendChild(spinner);
    row.appendChild(text);
    el.appendChild(row);
  }

  function showSuccess(translation) {
    if (!el) return;
    el.classList.remove('cft-bubble--error', 'cft-bubble--budget');
    el.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'cft-bubble__row';

    const text = document.createElement('div');
    text.className = 'cft-bubble__text';
    text.textContent = translation;
    row.appendChild(text);
    el.appendChild(row);

    const actions = document.createElement('div');
    actions.className = 'cft-bubble__row';
    actions.style.marginTop = '8px';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'cft-bubble__btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Копировать';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(translation);
        copyBtn.textContent = 'Скопировано';
        setTimeout(() => {
          if (copyBtn.isConnected) copyBtn.textContent = 'Копировать';
        }, 1200);
      } catch (_) {
        copyBtn.textContent = 'Не вышло скопировать';
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cft-bubble__btn cft-bubble__btn--ghost';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Закрыть';
    closeBtn.addEventListener('click', hide);

    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);
    el.appendChild(actions);
  }

  function showNetworkError(onRetry) {
    if (!el) return;
    el.classList.add('cft-bubble--error');
    el.classList.remove('cft-bubble--budget');
    el.innerHTML = '';

    const text = document.createElement('div');
    text.className = 'cft-bubble__text';
    text.textContent = 'Не удалось перевести, попробуйте ещё раз';
    el.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'cft-bubble__row';
    actions.style.marginTop = '8px';

    const retryBtn = document.createElement('button');
    retryBtn.className = 'cft-bubble__btn';
    retryBtn.type = 'button';
    retryBtn.textContent = 'Повторить';
    retryBtn.addEventListener('click', onRetry);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cft-bubble__btn cft-bubble__btn--ghost';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Закрыть';
    closeBtn.addEventListener('click', hide);

    actions.appendChild(retryBtn);
    actions.appendChild(closeBtn);
    el.appendChild(actions);
  }

  function showBudgetExceeded(message) {
    if (!el) return;
    el.classList.add('cft-bubble--budget');
    el.classList.remove('cft-bubble--error');
    el.innerHTML = '';

    const text = document.createElement('div');
    text.className = 'cft-bubble__text';
    text.textContent = message || 'Дневной лимит на перевод исчерпан';
    el.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'cft-bubble__row';
    actions.style.marginTop = '8px';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cft-bubble__btn cft-bubble__btn--ghost';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Закрыть';
    closeBtn.addEventListener('click', hide);

    actions.appendChild(closeBtn);
    el.appendChild(actions);
  }

  window.CftTranslateBubble = {
    showIdle,
    showLoading,
    showSuccess,
    showNetworkError,
    showBudgetExceeded,
    hide,
  };
})();
