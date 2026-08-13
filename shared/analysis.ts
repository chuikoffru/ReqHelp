export const MAX_TZ_CHARS = 50_000
export const MIN_TZ_CHARS = 10

export const ENTITY_TYPES = [
  'Документ',
  'Справочник',
  'Регистр',
  'Отчёт',
  'Обработка',
  'Перечисление',
  'Константа',
  'Бизнес-процесс',
  'Объект',
] as const

export const CONFIDENCE_LEVELS = ['высокая', 'средняя', 'низкая'] as const
export const SEVERITY_LEVELS = ['critical', 'warning', 'info'] as const

export type EntityType = (typeof ENTITY_TYPES)[number]
export type Confidence = (typeof CONFIDENCE_LEVELS)[number]
export type Severity = (typeof SEVERITY_LEVELS)[number]

export interface FoundEntity {
  name: string
  type: EntityType
  confidence: Confidence
  context: string
  count: number
}

export interface FoundAttribute {
  name: string
  context: string
  count: number
}

export interface FoundSection {
  name: string
  count: number
}

export interface Gap {
  id: string
  title: string
  description: string
  question: string
  severity: Severity
}

export interface Recommendation {
  text: string
}

export interface AnalysisResult {
  words: number
  entities: FoundEntity[]
  attributes: FoundAttribute[]
  sections: FoundSection[]
  gaps: Gap[]
  recommendations: Recommendation[]
}

export type LlmAnalysis = Omit<AnalysisResult, 'words'>
