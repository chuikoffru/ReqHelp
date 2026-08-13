import { z } from 'zod'
import {
  ENTITY_TYPES,
  CONFIDENCE_LEVELS,
  SEVERITY_LEVELS,
  type EntityType,
  type Confidence,
  type Severity,
} from '../../shared/analysis'

const ENTITY_TYPE_SET = new Set<string>(ENTITY_TYPES)
const CONFIDENCE_SET = new Set<string>(CONFIDENCE_LEVELS)
const SEVERITY_SET = new Set<string>(SEVERITY_LEVELS)

const TYPE_ALIASES: Record<string, EntityType> = {
  реквизит: 'Объект',
  атрибут: 'Объект',
  поле: 'Объект',
  документ: 'Документ',
  справочник: 'Справочник',
  регистр: 'Регистр',
  'регистр накопления': 'Регистр',
  'регистр сведений': 'Регистр',
  отчет: 'Отчёт',
  отчёт: 'Отчёт',
  обработка: 'Обработка',
  перечисление: 'Перечисление',
  константа: 'Константа',
  'бизнес-процесс': 'Бизнес-процесс',
  'бизнес процесс': 'Бизнес-процесс',
  объект: 'Объект',
}

const CONFIDENCE_ALIASES: Record<string, Confidence> = {
  высокая: 'высокая',
  средняя: 'средняя',
  низкая: 'низкая',
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
}

const SEVERITY_ALIASES: Record<string, Severity> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  критично: 'critical',
  важно: 'warning',
  уточнить: 'info',
}

function normalizeEntityType(value: unknown): EntityType {
  if (typeof value !== 'string') return 'Объект'
  const trimmed = value.trim()
  if (ENTITY_TYPE_SET.has(trimmed)) return trimmed as EntityType
  return TYPE_ALIASES[trimmed.toLowerCase()] ?? 'Объект'
}

function normalizeConfidence(value: unknown): Confidence {
  if (typeof value !== 'string') return 'средняя'
  const trimmed = value.trim()
  if (CONFIDENCE_SET.has(trimmed)) return trimmed as Confidence
  return CONFIDENCE_ALIASES[trimmed.toLowerCase()] ?? 'средняя'
}

function normalizeSeverity(value: unknown): Severity {
  if (typeof value !== 'string') return 'info'
  const trimmed = value.trim()
  if (SEVERITY_SET.has(trimmed)) return trimmed as Severity
  return SEVERITY_ALIASES[trimmed.toLowerCase()] ?? 'info'
}

const countSchema = z.coerce.number().int().nonnegative().catch(1)
const textSchema = z.string().catch('')

export const llmAnalysisSchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.preprocess(normalizeEntityType, z.enum(ENTITY_TYPES)),
        confidence: z.preprocess(normalizeConfidence, z.enum(CONFIDENCE_LEVELS)),
        context: textSchema,
        count: countSchema,
      }),
    )
    .catch([]),
  attributes: z
    .array(
      z.object({
        name: z.string().min(1),
        context: textSchema,
        count: countSchema,
      }),
    )
    .catch([]),
  sections: z
    .array(
      z.object({
        name: z.string().min(1),
        count: countSchema,
      }),
    )
    .catch([]),
  gaps: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().catch(''),
        question: z.string().catch(''),
        severity: z.preprocess(normalizeSeverity, z.enum(SEVERITY_LEVELS)),
      }),
    )
    .catch([]),
  recommendations: z
    .array(
      z.union([
        z.object({ text: z.string().min(1) }),
        z.string().min(1).transform((text) => ({ text })),
      ]),
    )
    .catch([]),
})

export const analysisResultSchema = llmAnalysisSchema.extend({
  words: z.number().int().nonnegative(),
})
