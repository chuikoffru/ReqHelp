import { SignJWT, jwtVerify } from 'jose'
import { env } from './env'

const COOKIE_NAME = 'auth_token'
const secret = new TextEncoder().encode(env.jwtSecret)

export { COOKIE_NAME }

export interface TokenPayload {
  sub: number
  login: string
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ login: payload.login })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(payload.sub))
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    const sub = Number(payload.sub)
    const login = typeof payload.login === 'string' ? payload.login : null
    if (!Number.isFinite(sub) || !login) return null
    return { sub, login }
  } catch {
    return null
  }
}

export function cookieOptions(maxAgeSeconds?: number) {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax' as const,
    secure: env.isProd,
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  }
}
