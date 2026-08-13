import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { createUser, findUserById, findUserByLogin } from '../db'
import { env } from '../lib/env'
import { COOKIE_NAME, cookieOptions, signToken, verifyToken } from '../lib/token'
import type { AuthVariables } from '../middleware/auth'

const credentialsSchema = z.object({
  login: z
    .string()
    .trim()
    .min(3, 'Логин должен быть не короче 3 символов')
    .max(64, 'Логин слишком длинный'),
  password: z
    .string()
    .min(6, 'Пароль должен быть не короче 6 символов')
    .max(128, 'Пароль слишком длинный'),
})

const auth = new Hono<{ Variables: AuthVariables }>()

auth.post('/register', async (c) => {
  if (!env.allowRegistration) {
    return c.json({ error: 'Регистрация отключена' }, 403)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Некорректный JSON' }, 400)
  }

  const parsed = credentialsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Ошибка валидации' }, 400)
  }

  const { login, password } = parsed.data
  if (findUserByLogin(login)) {
    return c.json({ error: 'Пользователь с таким логином уже существует' }, 409)
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = createUser(login, passwordHash)
  const token = await signToken({ sub: user.id, login: user.login })

  setCookie(c, COOKIE_NAME, token, cookieOptions(60 * 60 * 24 * 7))

  return c.json({ id: user.id, login: user.login }, 201)
})

auth.post('/login', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Некорректный JSON' }, 400)
  }

  const parsed = credentialsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Ошибка валидации' }, 400)
  }

  const { login, password } = parsed.data
  const user = findUserByLogin(login)
  if (!user) {
    return c.json({ error: 'Неверный логин или пароль' }, 401)
  }

  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) {
    return c.json({ error: 'Неверный логин или пароль' }, 401)
  }

  const token = await signToken({ sub: user.id, login: user.login })
  setCookie(c, COOKIE_NAME, token, cookieOptions(60 * 60 * 24 * 7))

  return c.json({ id: user.id, login: user.login })
})

auth.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, cookieOptions())
  return c.json({ ok: true })
})

auth.get('/me', async (c) => {
  const token = getCookie(c, COOKIE_NAME)
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const user = findUserById(payload.sub)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return c.json({ id: user.id, login: user.login })
})

export default auth
