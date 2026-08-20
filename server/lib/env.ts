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
  appOrigin: process.env.APP_ORIGIN ?? '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  openrouterModel: required('OPENROUTER_MODEL', 'deepseek/deepseek-v4-flash-0731'),
  openrouterUrl: required('OPENROUTER_URL', 'https://openrouter.ai/api/v1'),
}
