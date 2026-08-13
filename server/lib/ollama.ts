import { env } from './env'
import { llmAnalysisSchema } from './analysisSchema'
import {
  ENTITY_TYPES,
  CONFIDENCE_LEVELS,
  SEVERITY_LEVELS,
  type LlmAnalysis,
} from '../../shared/analysis'

const OLLAMA_TIMEOUT_MS = 180_000

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

export class OllamaError extends Error {
  constructor(
    message: string,
    public readonly kind: 'unavailable' | 'invalid_response',
  ) {
    super(message)
    this.name = 'OllamaError'
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

async function chat(messages: Array<{ role: string; content: string }>): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${env.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.ollamaModel,
        messages,
        stream: false,
        format: 'json',
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new OllamaError(
        'Модель не ответила вовремя. Попробуйте сократить текст ТЗ.',
        'unavailable',
      )
    }
    throw new OllamaError(
      'Ollama недоступна. Запустите Ollama: ollama serve',
      'unavailable',
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 404) {
      throw new OllamaError(
        `Модель ${env.ollamaModel} не найдена. Выполните: ollama pull ${env.ollamaModel}`,
        'unavailable',
      )
    }
    throw new OllamaError(
      body || `Ollama вернула ошибку ${res.status}`,
      'unavailable',
    )
  }

  const data = (await res.json()) as { message?: { content?: string } }
  const content = data.message?.content
  if (!content) {
    throw new OllamaError('Модель вернула пустой ответ', 'invalid_response')
  }
  return content
}

function parseAnalysis(raw: string): LlmAnalysis {
  const parsed = extractJsonObject(raw)
  return llmAnalysisSchema.parse(parsed)
}

export async function analyzeWithOllama(text: string): Promise<LlmAnalysis> {
  const userMessage = `Проанализируй техническое задание:\n\n${text}`

  try {
    const first = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ])
    return parseAnalysis(first)
  } catch (err) {
    if (err instanceof OllamaError && err.kind === 'unavailable') {
      throw err
    }
  }

  try {
    const second = await chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
      { role: 'assistant', content: '{}' },
      { role: 'user', content: RETRY_PROMPT },
    ])
    return parseAnalysis(second)
  } catch (err) {
    if (err instanceof OllamaError) throw err
    throw new OllamaError('Модель вернула невалидный ответ', 'invalid_response')
  }
}
