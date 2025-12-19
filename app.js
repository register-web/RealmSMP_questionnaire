document.addEventListener('DOMContentLoaded', () => {
  const screens = {
    loading: document.getElementById('loadingScreen'),
    telegram: document.getElementById('telegramScreen'),
    form: document.getElementById('formScreen'),
    pending: document.getElementById('pendingScreen'),
    approved: document.getElementById('approvedScreen'),
  };
  const formMessageEl = document.getElementById('formMessage');
  const submitBtn = document.getElementById('submitBtn');
  const requiredNames = ['name', 'age', 'about', 'mc_nick'];
  const checkboxNames = ['with_cam', 'with_voice'];

  const debugEnabled = new URLSearchParams(location.search).get('debug') === '1';
  const hasWebApp = Boolean(window.Telegram && window.Telegram.WebApp);
  const tg = hasWebApp ? window.Telegram.WebApp : null;
  if (tg) { tg.ready?.(); tg.expand?.(); }
  const initData = tg?.initData || '';

  let isSubmitting = false;
  const state = { pollingId: null, status: null, lastStatus: null, lastError: null, lastErrorDetail: null };
  let debugBox = null;

  const hideAll = () => Object.values(screens).forEach((el) => {
    if (el) { el.classList.remove('active'); el.hidden = true; }
  });
  const showScreen = (key) => { hideAll(); const el = screens[key]; if (el) { el.classList.add('active'); el.hidden = false; } };
  showScreen('loading');

  const setFormMessage = (msg, isError = true) => {
    if (!formMessageEl) return;
    if (!msg) {
      formMessageEl.hidden = true;
      formMessageEl.textContent = '';
      formMessageEl.classList.remove('error');
    } else {
      formMessageEl.hidden = false;
      formMessageEl.textContent = msg;
      formMessageEl.classList.toggle('error', isError);
    }
  };

  const normalizeErrorText = (text) => {
    const s = String(text || '').trim();
    if (!s) return 'Не удалось связаться с сервером';
    if (s.toLowerCase().includes('<html')) return 'Сервер вернул ошибку. Попробуйте позже.';
    return s;
  };

  const ensureDebugBox = () => {
    if (!debugEnabled) return null;
    if (!debugBox) {
      debugBox = document.createElement('div');
      debugBox.className = 'debug-info';
      (document.querySelector('.content') || document.body).appendChild(debugBox);
    }
    return debugBox;
  };
  const updateDebug = () => {
    if (!debugEnabled) return;
    const box = ensureDebugBox(); if (!box) return;
    box.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px;">DEBUG</div>
      <div>hasTelegramWebApp: <code>${hasWebApp}</code></div>
      <div>initData length: <code>${initData ? initData.length : 0}</code></div>
      <div>API_URL: <code>${API_URL || '—'}</code></div>
      <div>lastStatus: <code>${state.lastStatus ? JSON.stringify(state.lastStatus) : '—'}</code></div>
      <div>lastError: <code>${state.lastError || '—'}</code></div>
      <div>lastErrorDetail: <code>${state.lastErrorDetail || '—'}</code></div>
    `;
  };

  const autoGrow = (el) => {
    const minH = 44;
    const maxH = parseFloat(getComputedStyle(el).maxHeight) || 260;
    const setH = () => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(Math.max(el.scrollHeight, minH), maxH)}px`;
    };
    el.addEventListener('input', setH);
    setH();
  };
  document.querySelectorAll('.textarea').forEach(autoGrow);
  document.querySelectorAll('.textarea, .input').forEach((el) => {
    const counter = document.querySelector(`[data-counter="${el.name}"]`);
    if (counter) {
      counter.textContent = `${el.value.length}/${el.maxLength}`;
      el.addEventListener('input', () => { counter.textContent = `${el.value.length}/${el.maxLength}`; });
    }
  });
  document.querySelectorAll('input[name], textarea[name]').forEach((el) => {
    const handler = () => syncSubmitState();
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  const allRequiredFilled = () => {
    const filled = requiredNames.every((n) => (document.querySelector(`[name="${n}"]`)?.value || '').trim());
    const checked = checkboxNames.some((n) => document.querySelector(`[name="${n}"]`)?.checked);
    return filled && checked;
  };
  const syncSubmitState = () => {
    const ok = allRequiredFilled() && !!initData && !isSubmitting;
    submitBtn.disabled = !ok;
    submitBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
  };

  const collectAnswers = () => {
    const answers = {};
    document.querySelectorAll('input[name], textarea[name]').forEach((el) => {
      answers[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    return answers;
  };

  // Сетевой слой: только URLSearchParams, без headers
  const postApiForm = async (payload) => {
    if (!API_URL) throw new Error('API_URL не задан');
    const params = new URLSearchParams();
    Object.entries(payload).forEach(([k, v]) => params.append(k, typeof v === 'object' ? JSON.stringify(v) : v));
    let raw = '';
    try {
      const res = await fetch(API_URL, { method: 'POST', body: params, cache: 'no-store' });
      raw = await res.text();
      let data; try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = { error: raw }; }
      if (!res.ok) throw new Error(normalizeErrorText(data?.error || raw || `Ошибка ${res.status}`));
      if (!data) throw new Error('Пустой ответ сервера');
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : raw || 'Неизвестная ошибка сети';
      const friendly = normalizeErrorText(message);
      const e = new Error(friendly); e.debugMessage = message; throw e;
    }
  };

  const applyStatus = (status) => {
    state.status = status || 'NONE';
    if (state.status === 'APPROVED') {
      clearInterval(state.pollingId); state.pollingId = null; showScreen('approved');
    } else if (state.status === 'PENDING') {
      showScreen('pending');
      if (!state.pollingId) state.pollingId = setInterval(() => {
        if (document.visibilityState === 'visible') checkStatus();
      }, 10000);
    } else {
      clearInterval(state.pollingId); state.pollingId = null; showScreen('form');
    }
  };

  const checkStatus = async (fromLoad = false) => {
    if (!hasWebApp || !initData) { showScreen('telegram'); setFormMessage('Открой внутри Telegram'); updateDebug(); return; }
    if (fromLoad) showScreen('loading');
    try {
      setFormMessage('');
      const data = await postApiForm({ action: 'status', initData });
      state.lastStatus = data; state.lastError = null; state.lastErrorDetail = null;
      applyStatus(data?.status);
    } catch (err) {
      state.lastError = err.message || 'Не удалось получить статус';
      state.lastErrorDetail = err.debugMessage || err.message || '';
      setFormMessage('Не удалось получить статус');
      applyStatus('NONE');
    } finally { syncSubmitState(); updateDebug(); }
  };

  const submitApplication = async () => {
    if (submitBtn.disabled || isSubmitting) return;
    if (!hasWebApp || !initData) { showScreen('telegram'); setFormMessage('Открой внутри Telegram'); return; }
    isSubmitting = true; syncSubmitState(); submitBtn.textContent = 'Отправляем...'; setFormMessage('');
    try {
      const res = await postApiForm({ action: 'submit', initData, answers: collectAnswers() });
      state.lastStatus = res; state.lastError = null; state.lastErrorDetail = null;
      if (res?.ok) {
        applyStatus('PENDING');
      } else if (res?.error === 'ALREADY_SUBMITTED') {
        await checkStatus();
      } else if (res?.error) {
        state.lastError = normalizeErrorText(res.error);
        state.lastErrorDetail = res.error;
        setFormMessage(state.lastError);
        applyStatus('NONE');
      } else {
        applyStatus('PENDING');
      }
    } catch (err) {
      state.lastError = err.message || 'Не удалось отправить заявку';
      state.lastErrorDetail = err.debugMessage || err.message || '';
      setFormMessage('Не удалось отправить заявку');
      applyStatus('NONE');
    } finally {
      isSubmitting = false; submitBtn.textContent = 'Отправить заявку'; syncSubmitState(); updateDebug();
    }
  };

  submitBtn?.addEventListener('click', (e) => { e.preventDefault(); submitApplication(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.status === 'PENDING') checkStatus();
  });

  syncSubmitState();
  checkStatus(true);
});
