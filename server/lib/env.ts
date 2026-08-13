import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env') })

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value) {
    throw new Error(`Missing required env variable: ${name}`)
  }
  return value
}

export const env = {
  jwtSecret: required('JWT_SECRET', 'dev-secret-change-me'),
  port: Number(process.env.PORT ?? '3001'),
  databasePath: required('DATABASE_PATH', './data/app.db'),
  allowRegistration: (process.env.ALLOW_REGISTRATION ?? 'true') !== 'false',
  isProd: process.env.NODE_ENV === 'production',
}
