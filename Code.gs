const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const APPLICATION_PREFIX = 'APPLICATION_';
const STATUS = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED',
};

const getProp_ = (key, fallback = '') => SCRIPT_PROPS.getProperty(key) || fallback;
const getRequiredProp_ = (key) => {
  const val = getProp_(key, '');
  if (!val) throw new Error(`${key}_NOT_SET`);
  return val;
};

const tgApiFetch_ = (method, payload) => {
  const token = getProp_('BOT_TOKEN');
  if (!token) throw new Error('BOT_TOKEN not set');
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const params = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  const res = UrlFetchApp.fetch(url, params);
  const code = res.getResponseCode();
  const text = res.getContentText();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error(`Telegram response parse failed: ${text}`);
  }
  if (code >= 300 || !data.ok) {
    throw new Error(`Telegram error: ${text}`);
  }
  return data;
};

const tgSendMessage_ = (chatId, text, replyMarkup, options = {}) => {
  if (!chatId) return null;
  return tgApiFetch_('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: options.parse_mode || 'HTML',
    reply_markup: replyMarkup,
    disable_web_page_preview: options.disable_web_page_preview ?? true,
  });
};

const tgSendPhoto_ = (chatId, photoUrl, caption, replyMarkup) => {
  if (!chatId || !photoUrl) return null;
  return tgApiFetch_('sendPhoto', {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });
};

const tgHtmlEscape_ = (text) => String(text || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const formatAnswers_ = (answers) => {
  if (!answers || typeof answers !== 'object') return '—';
  return Object.entries(answers)
    .map(([key, val]) => `<b>${tgHtmlEscape_(key)}:</b> ${tgHtmlEscape_(val)}`)
    .join('\n');
};

function handleMessage_(msg) {
  if (!msg) return;
  const chatId = msg.chat?.id;
  const text = (msg.text || '').trim();
  const webAppUrl = getProp_('WEB_APP_URL');

  if (text.startsWith('/start')) {
    const caption = 'Realm SMP — заявки на сервер.\n\nЗаполни анкету в мини-аппе. Статус появится там же.';
    const welcomePhoto = getProp_('WELCOME_PHOTO_URL');
    if (welcomePhoto) {
      tgSendPhoto_(chatId, welcomePhoto, caption);
    } else {
      tgSendMessage_(chatId, caption);
    }

    const replyMarkup = webAppUrl
      ? {
          keyboard: [[{ text: 'Подать заявку', web_app: { url: webAppUrl } }]],
          resize_keyboard: true,
          one_time_keyboard: false,
        }
      : undefined;
    tgSendMessage_(chatId, 'Открыть мини-апп:', replyMarkup);
    return;
  }
}

function notifyAdminNewApplication_(application) {
  const adminChatId = Number(getProp_('ADMIN_CHAT_ID') || 0);
  if (!adminChatId) return;
  const user = application?.telegram || {};
  const username = user.username ? `@${tgHtmlEscape_(user.username)}` : '—';
  const userId = user.id ? `<code>${tgHtmlEscape_(user.id)}</code>` : '—';
  const answersFormatted = formatAnswers_(application?.answers);
  const text = [
    '<b>🆕 Новая заявка</b>',
    `👤 <b>Профиль:</b> ${username}`,
    `🆔 <b>ID:</b> ${userId}`,
    `📋 <b>Ответы:</b>\n${answersFormatted}`,
  ].join('\n');
  tgSendMessage_(adminChatId, text, null, { parse_mode: 'HTML' });
}

function notifyUserApproved_(chatId) {
  if (!chatId) return;
  const webAppUrl = getProp_('WEB_APP_URL');
  const replyMarkup = webAppUrl
    ? {
        keyboard: [[{ text: 'Открыть мини-апп', web_app: { url: webAppUrl } }]],
        resize_keyboard: true,
        one_time_keyboard: false,
      }
    : undefined;
  tgSendMessage_(
    chatId,
    '<b>✅ Заявка принята</b>\n\nОткрой мини-апп, чтобы увидеть статус и инструкции.',
    replyMarkup,
    { parse_mode: 'HTML' }
  );
}

const jsonResponse_ = (data) => ContentService
  .createTextOutput(JSON.stringify(data || {}))
  .setMimeType(ContentService.MimeType.JSON);

const errorResponse_ = (code, detail) => jsonResponse_({ error: code, detail: detail || '' });

const bytesToHex_ = (bytes) => (bytes || [])
  .map((b) => {
    const normalized = b < 0 ? 256 + b : b;
    return normalized.toString(16).padStart(2, '0');
  })
  .join('');

const parseInitData_ = (initData) => {
  const result = {};
  const pairs = String(initData || '').split('&').filter(Boolean);
  pairs.forEach((pair) => {
    const [rawKey, rawValue = ''] = pair.split('=');
    const key = decodeURIComponent(rawKey || '');
    // Telegram передаёт '+' как пробел, нормализуем перед decodeURIComponent
    const value = decodeURIComponent((rawValue || '').replace(/\+/g, '%20'));
    result[key] = value;
  });
  return result;
};

const buildDataCheckString_ = (data) => Object.keys(data || {})
  .filter((key) => key !== 'hash')
  .sort()
  .map((key) => `${key}=${data[key]}`)
  .join('\n');

const verifyInitData_ = (initData) => {
  if (!initData) throw new Error('INIT_DATA_REQUIRED');
  const parsed = parseInitData_(initData);
  const hash = parsed.hash;
  if (!hash) throw new Error('INIT_DATA_HASH_MISSING');

  const token = getRequiredProp_('BOT_TOKEN');

  const dataCheckString = buildDataCheckString_(parsed);
  // Первый ключ: HMAC_SHA256("WebAppData", botToken)
  const secretKeyBytes = Utilities.computeHmacSha256Signature('WebAppData', token, Utilities.Charset.UTF_8);
  // Проверочный хэш: HMAC_SHA256(dataCheckString, secretKeyBytes)
  const checkBytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    dataCheckString,
    secretKeyBytes
  );
  const checkHash = bytesToHex_(checkBytes);
  if (checkHash !== hash) throw new Error('INIT_DATA_INVALID');

  let user = null;
  try {
    user = parsed.user ? JSON.parse(parsed.user) : null;
  } catch (_) {
    user = null;
  }
  return { user, authDate: Number(parsed.auth_date) || 0, raw: parsed };
};

const parseAnswers_ = (raw) => {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
};

const loadApplication_ = (userId) => {
  if (!userId) return null;
  const raw = SCRIPT_PROPS.getProperty(`${APPLICATION_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

const saveApplication_ = (userId, data) => {
  if (!userId || !data) return;
  SCRIPT_PROPS.setProperty(`${APPLICATION_PREFIX}${userId}`, JSON.stringify(data));
};

const getStatus_ = (userId) => {
  const application = loadApplication_(userId);
  return application?.status || STATUS.NONE;
};

const setStatus_ = (userId, status) => {
  if (!userId) throw new Error('USER_ID_REQUIRED');
  const allowed = Object.values(STATUS);
  if (!allowed.includes(status)) throw new Error('STATUS_NOT_ALLOWED');

  const existing = loadApplication_(userId) || { telegram: { id: userId } };
  const updated = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
  };
  saveApplication_(userId, updated);

  if (status === STATUS.APPROVED) {
    try { notifyUserApproved_(userId); } catch (err) { Logger.log(`notify user failed: ${err}`); }
  }
  return updated;
};

function doPost(e) {
  try {
    const params = e?.parameter || {};
    const action = String(params.action || '').toLowerCase();
    if (!action) return errorResponse_('NO_ACTION');

    const initData = params.initData;
    const { user } = verifyInitData_(initData);
    if (!user || !user.id) return errorResponse_('TELEGRAM_USER_MISSING');

    if (action === 'status') {
      const status = getStatus_(user.id);
      return jsonResponse_({ status });
    }

    if (action === 'submit') {
      const answers = parseAnswers_(params.answers);
      const currentStatus = getStatus_(user.id);
      if (currentStatus !== STATUS.NONE) {
        return jsonResponse_({ error: 'ALREADY_SUBMITTED', status: currentStatus });
      }

      const application = {
        status: STATUS.PENDING,
        telegram: user,
        answers,
        createdAt: new Date().toISOString(),
      };
      saveApplication_(user.id, application);
      try { notifyAdminNewApplication_(application); } catch (notifyErr) { Logger.log(`notify admin failed: ${notifyErr}`); }
      return jsonResponse_({ ok: true, status: 'PENDING' });
    }

    return jsonResponse_({ error: 'UNKNOWN_ACTION' });
  } catch (err) {
    Logger.log(`handler error: ${err.message}\n${err.stack}`);
    return errorResponse_(err.message || 'SERVER_ERROR');
  }
}

// Утилиты для ручного управления статусами из редактора Apps Script (Run -> select function):
function adminApproveUser(userId) {
  return setStatus_(userId, STATUS.APPROVED);
}

function adminDenyUser(userId) {
  return setStatus_(userId, STATUS.DENIED);
}

function adminResetUser(userId) {
  return setStatus_(userId, STATUS.NONE);
}
