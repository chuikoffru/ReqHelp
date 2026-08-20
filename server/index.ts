import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import './db'
import { env } from './lib/env'
import authRoutes from './routes/auth'
import analyzeRoutes from './routes/analyze'

const app = new Hono()

function isAllowedOrigin(origin: string): boolean {
  if (origin.startsWith('chrome-extension://')) return true
  if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173') return true
  if (env.appOrigin && origin === env.appOrigin) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'gcexp.ru' || hostname.endsWith('.gcexp.ru')
  } catch {
    return false
  }
}

app.use(
  '/api/*',
  cors({
    origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : undefined),
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/api/auth', authRoutes)
app.route('/api/analyze', analyzeRoutes)

if (env.isProd) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

serve({ fetch: app.fetch, port: env.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`API listening on http://${info.address}:${info.port}`)
})
