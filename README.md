# RealmSMP questionnaire mini app

- Mini App запускать только через кнопку Web App у бота @bid_admin_bot
- Для диагностики: добавьте `?debug=1` к URL
- API_URL для Google Apps Script задаётся в `config.js` (`window.APP_CONFIG.API_URL`), измените его там при смене эндпоинта.
- Content-Type в запросах — `text/plain;charset=UTF-8`, чтобы не было CORS preflight на Apps Script.
- Картинка приветствия: `assets/12312313213.png` (raw: `https://raw.githubusercontent.com/register-web/RealmSMP_questionnaire/main/assets/12312313213.png`); установите её в Script Properties как `WELCOME_PHOTO_URL`.
