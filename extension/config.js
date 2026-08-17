export const SITE_URL = 'http://localhost:5173'
export const SITE_URL_ALT = 'http://127.0.0.1:5173'
export const API_URL = 'http://localhost:3001'
export const COOKIE_NAME = 'auth_token'
export const MIN_TZ_CHARS = 10
export const MAX_TZ_CHARS = 50_000

export const ERROR_MESSAGES = {
  too_short:
    'Слишком мало текста. Выделите фрагмент ТЗ или откройте страницу с описанием задачи.',
  need_login: 'Войдите на сайте ТЗ-Ассистент',
  unavailable: 'Сервер недоступен. Запустите сайт (`npm run dev`) и попробуйте снова.',
  page_unavailable:
    'На этой странице текст недоступен. Откройте обычную веб-страницу или выделите текст.',
}
