import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { COOKIE_NAME, verifyToken } from '../lib/token'

export type AuthVariables = {
  userId: number
  userLogin: string
}

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const token = getCookie(c, COOKIE_NAME)
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('userId', payload.sub)
    c.set('userLogin', payload.login)
    await next()
  },
)
