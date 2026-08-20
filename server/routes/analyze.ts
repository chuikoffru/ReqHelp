import { Hono } from 'hono'
import { z } from 'zod'
import { MAX_TZ_CHARS, MIN_TZ_CHARS, type AnalysisResult } from '../../shared/analysis'
import { analyzeWithOpenRouter, OpenRouterError } from '../lib/openrouter'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const bodySchema = z.object({
  text: z
    .string()
    .trim()
    .min(MIN_TZ_CHARS, `Текст ТЗ должен быть не короче ${MIN_TZ_CHARS} символов`)
    .max(MAX_TZ_CHARS, `Текст ТЗ слишком длинный (макс. ${MAX_TZ_CHARS} символов)`),
})

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

const analyze = new Hono<{ Variables: AuthVariables }>()

analyze.post('/', requireAuth, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Некорректный JSON' }, 400)
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Ошибка валидации' }, 400)
  }

  const text = parsed.data.text

  try {
    const { analysis, timing } = await analyzeWithOpenRouter(text)
    const result: AnalysisResult = {
      ...analysis,
      words: countWords(text),
      timing,
    }
    return c.json(result)
  } catch (err) {
    if (err instanceof OpenRouterError) {
      const status = err.kind === 'unavailable' ? 503 : 502
      return c.json({ error: err.message }, status)
    }
    console.error(err)
    return c.json({ error: 'Не удалось проанализировать ТЗ' }, 500)
  }
})

export default analyze
