import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { COOKIE_NAME, verifyToken } from '../lib/token'

export type AuthVariables = {
  userId: number
  userLogin: string
}

export function getAuthToken(c: Context): string | undefined {
  const fromCookie = getCookie(c, COOKIE_NAME)
  if (fromCookie) return fromCookie

  const header = c.req.header('Authorization') ?? ''
  const parts = header.split(/\s+/)
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
    return undefined
  }
  return parts[1]
}

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const token = getAuthToken(c)
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
