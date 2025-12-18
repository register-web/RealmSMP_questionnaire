const SCRIPT_PROPS = PropertiesService.getScriptProperties();

const getProp_ = (key, fallback = '') => SCRIPT_PROPS.getProperty(key) || fallback;

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
