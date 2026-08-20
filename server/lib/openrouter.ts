import { env } from './env'
import { llmAnalysisJsonSchema, llmAnalysisSchema } from './analysisSchema'
import {
  ENTITY_TYPES,
  CONFIDENCE_LEVELS,
  SEVERITY_LEVELS,
  type AnalysisTiming,
  type LlmAnalysis,
} from '../../shared/analysis'

const OPENROUTER_TIMEOUT_MS = 180_000
const OPENROUTER_CHAT_URL = `${env.openrouterUrl}/chat/completions`

const SYSTEM_PROMPT = `Ты — аналитик технических заданий для конфигураций 1С:Предприятие.
Проанализируй текст ТЗ и верни ТОЛЬКО валидный JSON без markdown, комментариев и пояснений.

Формат ответа строго такой:
{
  "entities": [{ "name": string, "type": string, "confidence": string, "context": string, "count": number }],
  "attributes": [{ "name": string, "context": string, "count": number }],
  "sections": [{ "name": string, "count": number }],
  "gaps": [{ "id": string, "title": string, "description": string, "question": string, "severity": string }],
  "recommendations": [{ "text": string }]
}

Правила:
- entities — объекты конфигурации (документы, справочники, регистры и т.д.). type только из: ${ENTITY_TYPES.join(', ')}.
- confidence только из: ${CONFIDENCE_LEVELS.join(', ')}.
- attributes — реквизиты, поля, колонки.
- sections — разделы конфигурации (Продажи, Закупки, Склад, Производство, Кадры, Зарплата, Бухгалтерия, Банк и касса, CRM и маркетинг, НСИ и администрирование и т.п.).
- gaps — пробелы в требованиях. severity только из: ${SEVERITY_LEVELS.join(', ')}. id — короткий латиница_snake_case.
- context — короткая цитата или пересказ фрагмента ТЗ (1 предложение).
- count — сколько раз сущность упоминается, минимум 1.
- Если чего-то нет — верни пустой массив, не выдумывай объекты, которых нет в тексте.
- Рекомендации — конкретные советы, как улучшить ТЗ для передачи разработчику.
- Пиши все строковые значения на русском языке (кроме id и severity).`

const RETRY_PROMPT =
  'Предыдущий ответ не удалось разобрать как JSON нужной схемы. Верни ТОЛЬКО один JSON-объект без markdown и без текста вокруг.'

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly kind: 'unavailable' | 'invalid_response',
  ) {
    super(message)
    this.name = 'OpenRouterError'
  }
}

function extractJsonObject(raw: string): unknown {
  let text = raw.trim()
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('JSON object not found')
  }

  return JSON.parse(text.slice(start, end + 1))
}

function messageFromErrorBody(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string }
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message
    }
  } catch {
    // fall through
  }

  if (status === 401) {
    return 'Неверный API-ключ OpenRouter. Проверьте OPENROUTER_API_KEY в .env'
  }
  if (status === 402) {
    return 'Недостаточно кредитов OpenRouter'
  }
  if (status === 429) {
    return 'Слишком много запросов к OpenRouter. Подождите и повторите'
  }
  if (status === 404) {
    return `Модель ${env.openrouterModel} не найдена на OpenRouter`
  }
  return body.trim() || `OpenRouter вернул ошибку ${status}`
}

type ChatResult = {
  text: string
  durationMs: number
  promptChars: number
  completionTokens: number | null
  reasoningTokens: number | null
}

async function chat(messages: Array<{ role: string; content: string }>): Promise<ChatResult> {
  if (!env.openrouterApiKey) {
    throw new OpenRouterError(
      'Не задан OPENROUTER_API_KEY в .env',
      'unavailable',
    )
  }

  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0)
  const started = Date.now()
  console.log(`[openrouter] request start model=${env.openrouterModel} promptChars=${promptChars}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'TZ-Assistant',
      },
      body: JSON.stringify({
        model: env.openrouterModel,
        messages,
        stream: false,
        temperature: 0.2,
        max_tokens: 8192,
        reasoning: { enabled: false },
        provider: {
          require_parameters: true,
          sort: 'throughput',
          ignore: ['Relace', 'relace'],
        },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'tz_analysis',
            strict: true,
            schema: llmAnalysisJsonSchema,
          },
        },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    console.error(`[openrouter] request failed after ${Date.now() - started}ms`, err)
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new OpenRouterError(
        'Модель не ответила вовремя. Попробуйте сократить текст ТЗ.',
        'unavailable',
      )
    }
    throw new OpenRouterError('OpenRouter недоступен. Проверьте сеть и повторите.', 'unavailable')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[openrouter] HTTP ${res.status} after ${Date.now() - started}ms`)
    throw new OpenRouterError(messageFromErrorBody(body, res.status), 'unavailable')
  }

  const data = (await res.json()) as {
    provider?: string
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
    usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }
  }
  const durationMs = Date.now() - started
  const completionTokens = data.usage?.completion_tokens ?? null
  const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0
  console.log(
    `[openrouter] ok in ${durationMs}ms provider=${data.provider ?? '?'} tokens=${completionTokens ?? '?'} reasoning=${reasoningTokens}`,
  )
  const content = data.choices?.[0]?.message?.content
  const text = Array.isArray(content)
    ? content.map((part) => part.text ?? '').join('')
    : content
  if (!text?.trim()) {
    throw new OpenRouterError('Модель вернула пустой ответ', 'invalid_response')
  }
  return {
    text,
    durationMs,
    promptChars,
    completionTokens,
    reasoningTokens,
  }
}

function parseAnalysis(raw: string): LlmAnalysis {
  const parsed = extractJsonObject(raw)
  const result = llmAnalysisSchema.safeParse(parsed)
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Invalid analysis JSON: ${details}`)
  }
  return result.data
}

export type AnalyzeWithTiming = {
  analysis: LlmAnalysis
  timing: AnalysisTiming
}

function emptyTiming(): Omit<AnalysisTiming, 'totalMs' | 'model'> {
  return {
    firstLlmMs: 0,
    retryLlmMs: 0,
    parseMs: 0,
    attempts: 0,
    promptChars: 0,
    completionTokens: null,
    reasoningTokens: null,
  }
}

function logTiming(timing: AnalysisTiming) {
  const llmMs = timing.firstLlmMs + timing.retryLlmMs
  const llmPct = timing.totalMs > 0 ? Math.round((llmMs / timing.totalMs) * 100) : 0
  console.log(
    `[analyze] timing total=${timing.totalMs}ms llm=${llmMs}ms (${llmPct}%) parse=${timing.parseMs}ms attempts=${timing.attempts} promptChars=${timing.promptChars} tokens=${timing.completionTokens ?? '?'} reasoning=${timing.reasoningTokens ?? 0} model=${timing.model}`,
  )
}

export async function analyzeWithOpenRouter(text: string): Promise<AnalyzeWithTiming> {
  const started = Date.now()
  const timing = emptyTiming()
  const userMessage = `Проанализируй техническое задание:\n\n${text}`

  const parseTimed = (raw: string): LlmAnalysis => {
    const parseStarted = Date.now()
    try {
      return parseAnalysis(raw)
    } finally {
      timing.parseMs += Date.now() - parseStarted
    }
  }

  const finish = (analysis: LlmAnalysis): AnalyzeWithTiming => {
    const result = {
      analysis,
      timing: {
        ...timing,
        totalMs: Date.now() - started,
        model: env.openrouterModel,
      },
    }
    logTiming(result.timing)
    return result
  }

  try {
    timing.attempts = 1
    const first = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ])
    timing.firstLlmMs = first.durationMs
    timing.promptChars = first.promptChars
    timing.completionTokens = first.completionTokens
    timing.reasoningTokens = first.reasoningTokens
    return finish(parseTimed(first.text))
  } catch (err) {
    if (err instanceof OpenRouterError && err.kind === 'unavailable') {
      throw err
    }
  }

  try {
    timing.attempts = 2
    const second = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
      { role: 'assistant', content: '{}' },
      { role: 'user', content: RETRY_PROMPT },
    ])
    timing.retryLlmMs = second.durationMs
    timing.promptChars = second.promptChars
    timing.completionTokens = second.completionTokens
    timing.reasoningTokens = second.reasoningTokens
    return finish(parseTimed(second.text))
  } catch (err) {
    if (err instanceof OpenRouterError) throw err
    throw new OpenRouterError('Модель вернула невалидный ответ', 'invalid_response')
  }
}
