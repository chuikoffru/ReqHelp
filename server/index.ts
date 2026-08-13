import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import './db'
import { env } from './lib/env'
import authRoutes from './routes/auth'

const app = new Hono()

app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }),
)

app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/api/auth', authRoutes)

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})
