import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import './db'
import { env } from './lib/env'
import authRoutes from './routes/auth'
import analyzeRoutes from './routes/analyze'

const app = new Hono()

app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      const allowed = ['http://localhost:5173', 'http://127.0.0.1:5173']
      if (allowed.includes(origin)) return origin
      if (origin.startsWith('chrome-extension://')) return origin
      return undefined
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/api/auth', authRoutes)
app.route('/api/analyze', analyzeRoutes)

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})
