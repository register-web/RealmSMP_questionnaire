# RealmSMP questionnaire mini app

- Mini App запускать только через кнопку Web App у бота @bid_admin_bot
- Для диагностики: добавьте `?debug=1` к URL
- API_URL для Google Apps Script задаётся в `config.js` (`const API_URL = "__PASTE_APPS_SCRIPT_EXEC_URL_HERE__"`), замените плейсхолдер на свой endpoint.
- Тестировать мини-апп нужно внутри Telegram WebApp через кнопку у бота, чтобы initData передавалась автоматически.
- Картинка приветствия: `assets/12312313213.png` (raw: `https://raw.githubusercontent.com/register-web/RealmSMP_questionnaire/main/assets/12312313213.png`); установите её в Script Properties как `WELCOME_PHOTO_URL`.
