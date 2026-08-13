// Эвристический анализатор текста ТЗ (резервный, не используется в UI).
// Основной путь — LLM через /api/analyze.

import type {
  AnalysisResult,
  Confidence,
  EntityType,
  FoundAttribute,
  FoundEntity,
  FoundSection,
  Gap,
  Recommendation,
  Severity,
} from '../../shared/analysis'

// ---------- Словари ----------

const TYPE_WORDS: Record<Exclude<EntityType, 'Объект'>, string[]> = {
  Документ: ['документ', 'документа', 'документы'],
  Справочник: ['справочник', 'справочнике', 'справочники', 'справочника'],
  Регистр: ['регистр', 'регистре', 'регистры', 'регистра'],
  Отчёт: ['отчёт', 'отчет', 'отчёта', 'отчета'],
  Обработка: ['обработка', 'обработки', 'обработку'],
  Перечисление: ['перечисление', 'перечисления'],
  Константа: ['константа', 'константы'],
  'Бизнес-процесс': ['бизнес-процесс', 'бизнес процесс', 'бизнес-процесса', 'бизнес-процессы'],
}

// Префиксы имени объекта → тип (используется, когда тип не указан явно)
const PREFIX_TYPES: Array<[EntityType, string[]]> = [
  ['Документ', ['заказ', 'счёт', 'счет', 'акт', 'реализац', 'поступлен', 'приход', 'расход', 'оплат', 'перемещ', 'списани', 'возврат', 'ордер', 'требовани', 'оприходовани', 'корректировк', 'инвойс', 'накладн', 'поручени']],
  ['Справочник', ['справочник', 'номенклатур', 'контрагент', 'сотрудник', 'склад', 'организаци', 'подразделени', 'пользовател', 'партнер', 'партнёр', 'банк', 'групп']],
  ['Регистр', ['регистр']],
  ['Отчёт', ['отчёт', 'отчет', 'ведомост', 'оборот']],
  ['Обработка', ['обработк', 'помощник', 'мастер', 'загрузк', 'выгрузк']],
  ['Перечисление', ['перечислени']],
  ['Константа', ['констант']],
]

// Типовые объекты конфигурации (упоминание слова → предположительный объект)
const TYPICAL_OBJECTS: Array<{ triggers: string[]; name: string; type: EntityType }> = [
  { triggers: ['номенклатур'], name: 'Номенклатура', type: 'Справочник' },
  { triggers: ['контрагент'], name: 'Контрагенты', type: 'Справочник' },
  { triggers: ['сотрудник'], name: 'Сотрудники', type: 'Справочник' },
  { triggers: ['склад'], name: 'Склады', type: 'Справочник' },
  { triggers: ['организаци'], name: 'Организации', type: 'Справочник' },
  { triggers: ['подразделени'], name: 'Подразделения', type: 'Справочник' },
  { triggers: ['заказ клиента', 'заказ покупател', 'заказчик'], name: 'Заказ клиента', type: 'Документ' },
  { triggers: ['счёт на оплату', 'счет на оплату'], name: 'Счёт на оплату', type: 'Документ' },
  { triggers: ['реализаци'], name: 'Реализация товаров и услуг', type: 'Документ' },
  { triggers: ['поступлени'], name: 'Поступление товаров и услуг', type: 'Документ' },
  { triggers: ['приходн'], name: 'Приходная накладная', type: 'Документ' },
  { triggers: ['оплат'], name: 'Платёжное поручение', type: 'Документ' },
  { triggers: ['возврат'], name: 'Возврат товаров', type: 'Документ' },
  { triggers: ['остатк'], name: 'Регистр остатков', type: 'Регистр' },
  { triggers: ['движени'], name: 'Регистр движений', type: 'Регистр' },
  { triggers: ['ведомост'], name: 'Ведомость', type: 'Отчёт' },
  { triggers: ['отчёт по продажам', 'отчет по продажам', 'отчёт о продажах', 'отчет о продажах'], name: 'Отчёт по продажам', type: 'Отчёт' },
]

const ATTRIBUTE_WORDS: Array<{ triggers: string[]; name: string }> = [
  { triggers: ['количеств'], name: 'Количество' },
  { triggers: ['сумм'], name: 'Сумма' },
  { triggers: ['цена', 'цены', 'цену'], name: 'Цена' },
  { triggers: ['стоимост'], name: 'Стоимость' },
  { triggers: ['дата', 'даты', 'дату'], name: 'Дата' },
  { triggers: ['номер', 'номеру', 'номера'], name: 'Номер' },
  { triggers: ['комментари'], name: 'Комментарий' },
  { triggers: ['статус'], name: 'Статус' },
  { triggers: ['наименовани'], name: 'Наименование' },
  { triggers: ['артикул'], name: 'Артикул' },
  { triggers: ['инн'], name: 'ИНН' },
  { triggers: ['кпп'], name: 'КПП' },
  { triggers: ['адрес'], name: 'Адрес' },
  { triggers: ['телефон'], name: 'Телефон' },
  { triggers: ['email', 'e-mail', 'почт'], name: 'Электронная почта' },
  { triggers: ['валют'], name: 'Валюта' },
  { triggers: ['единиц'], name: 'Единица измерения' },
  { triggers: ['скидк'], name: 'Скидка' },
  { triggers: ['ставк'], name: 'Ставка' },
  { triggers: ['процент'], name: 'Процент' },
  { triggers: ['срок', 'сроки', 'сроку'], name: 'Срок' },
  { triggers: ['период'], name: 'Период' },
  { triggers: ['ответственн'], name: 'Ответственный' },
  { triggers: ['менеджер'], name: 'Менеджер' },
  { triggers: ['вес'], name: 'Вес' },
  { triggers: ['объём', 'объем'], name: 'Объём' },
  { triggers: ['приоритет'], name: 'Приоритет' },
]

const SECTIONS: Array<{ triggers: string[]; name: string }> = [
  { triggers: ['продаж', 'заказ клиента', 'счёт', 'счет', 'реализаци', 'сделк', 'коммерческ'], name: 'Продажи' },
  { triggers: ['закупк', 'поставщик', 'поступлени', 'снабжени'], name: 'Закупки' },
  { triggers: ['склад', 'остатк', 'инвентаризаци', 'приход', 'расход', 'перемещени'], name: 'Склад' },
  { triggers: ['производств', 'технологическ', 'спецификаци', 'нормировани'], name: 'Производство' },
  { triggers: ['кадр', 'сотрудник', 'приём на работу', 'прием на работу', 'персонал'], name: 'Кадры' },
  { triggers: ['зарплат', 'начислени', 'оклад', 'преми'], name: 'Зарплата' },
  { triggers: ['бухгалтер', 'учёт', 'учет', 'налог', 'отчётность', 'отчетность', 'проводк'], name: 'Бухгалтерия' },
  { triggers: ['банк', 'касс', 'платёж', 'платеж', 'эквайринг', 'безналичн'], name: 'Банк и касса' },
  { triggers: ['клиент', 'лид', 'воронк', 'маркетинг', 'crm', 'звонок'], name: 'CRM и маркетинг' },
  { triggers: ['администрирован', 'право', 'доступ', 'роль', 'пользовател', 'нси', 'синхронизаци'], name: 'НСИ и администрирование' },
]

// ---------- Вспомогательные ----------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

const countOccurrences = (text: string, needle: string): number => {
  const re = new RegExp(esc(needle), 'gi')
  const matches = text.match(re)
  return matches ? matches.length : 0
}

const sentenceWith = (sentences: string[], needle: string): string => {
  const found = sentences.find((s) => s.toLowerCase().includes(needle.toLowerCase()))
  return found ?? ''
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

interface Candidate {
  raw: string
  name: string
  confidence: Confidence
  type: EntityType | null
  context: string
  count: number
  kind: 'quoted' | 'camel' | 'typical'
}

// Слова-типы, стоящие перед именем: «документ "X"», «справочник «X»»
function typeBefore(text: string, index: number): EntityType | null {
  const before = text.slice(Math.max(0, index - 60), index).toLowerCase()
  for (const [type, words] of Object.entries(TYPE_WORDS) as Array<[EntityType, string[]]>) {
    if (words.some((w) => before.includes(w))) return type
  }
  return null
}

function typeFromName(name: string): EntityType | null {
  const lower = name.toLowerCase()
  for (const [type, prefixes] of PREFIX_TYPES) {
    if (prefixes.some((p) => lower.startsWith(p))) return type
  }
  return null
}

function typeFromTrigger(raw: string, trigger: string, type: EntityType): EntityType {
  const before = raw.toLowerCase().slice(0, Math.max(0, raw.toLowerCase().indexOf(trigger)))
  for (const [t, words] of Object.entries(TYPE_WORDS) as Array<[EntityType, string[]]>) {
    if (words.some((w) => before.includes(w))) return t
  }
  return type
}

// ---------- Сбор кандидатов ----------

function collectCandidates(text: string, sentences: string[]): Candidate[] {
  const candidates: Candidate[] = []
  const lower = text.toLowerCase()

  // 1. Имена в кавычках: «...», "...", “...”
  const quoteRe = /«([^»]+)»|"([^"]+)"|“([^”]+)”/g
  let m: RegExpExecArray | null
  while ((m = quoteRe.exec(text)) !== null) {
    const rawPhrase = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (!rawPhrase || rawPhrase.length < 2 || rawPhrase.length > 60) continue
    const isAttributeContext = /(реквизит|атрибут|поле|колонк|табличной части)/i.test(
      text.slice(Math.max(0, m.index - 50), m.index),
    )
    if (isAttributeContext) continue // реквизиты обрабатываются отдельно
    const explicitType = typeBefore(text, m.index)
    const name = capitalize(rawPhrase)
    candidates.push({
      raw: rawPhrase,
      name,
      type: explicitType ?? typeFromName(name),
      confidence: explicitType ? 'высокая' : typeFromName(name) ? 'средняя' : 'низкая',
      context: sentenceWith(sentences, rawPhrase),
      count: countOccurrences(text, rawPhrase),
      kind: 'quoted',
    })
  }

  // 2. CamelCase-имена: ЗаказКлиента, СправочникНоменклатура
  const camelRe = /[A-ZА-ЯЁ][a-zа-яё]+(?:[A-ZА-ЯЁ][a-zа-яё]+)+/g
  while ((m = camelRe.exec(text)) !== null) {
    const word = m[0]
    candidates.push({
      raw: word,
      name: word,
      type: typeFromName(word),
      confidence: typeFromName(word) ? 'средняя' : 'низкая',
      context: sentenceWith(sentences, word),
      count: countOccurrences(text, word),
      kind: 'camel',
    })
  }

  // 3. Типовые объекты по словарю
  for (const obj of TYPICAL_OBJECTS) {
    for (const trigger of obj.triggers) {
      if (lower.includes(trigger)) {
        const type = typeFromTrigger(lower, trigger, obj.type)
        candidates.push({
          raw: trigger,
          name: obj.name,
          type,
          confidence: type === obj.type ? 'низкая' : 'средняя',
          context: sentenceWith(sentences, trigger),
          count: countOccurrences(text, trigger),
          kind: 'typical',
        })
        break
      }
    }
  }

  return candidates
}

function dedupeEntities(candidates: Candidate[]): FoundEntity[] {
  const map = new Map<string, FoundEntity>()
  for (const c of candidates) {
    const key = c.name.toLowerCase()
    const existing = map.get(key)
    if (existing) {
      existing.count += c.count
      if (c.confidence === 'высокая' && existing.confidence !== 'высокая') {
        existing.confidence = c.confidence
        existing.context = c.context
      }
    } else {
      map.set(key, {
        name: c.name,
        type: c.type ?? 'Объект',
        confidence: c.confidence,
        context: c.context,
        count: c.count,
      })
    }
  }
  const rank: Record<Confidence, number> = { высокая: 0, средняя: 1, низкая: 2 }
  return Array.from(map.values()).sort(
    (a, b) => rank[a.confidence] - rank[b.confidence] || b.count - a.count,
  )
}

function collectAttributes(text: string, sentences: string[]): FoundAttribute[] {
  const map = new Map<string, FoundAttribute>()
  const lower = text.toLowerCase()

  // 1. Имена после слов «реквизит/атрибут/поле/колонка»
  const attrRe = /(?:реквизит|атрибут|поле|колонк)[а-яё]*\s+«([^»]+)»|(?:реквизит|атрибут|поле|колонк)[а-яё]*\s+"([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(text)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').trim()
    if (!raw || raw.length < 2) continue
    const name = capitalize(raw)
    if (!map.has(name.toLowerCase())) {
      map.set(name.toLowerCase(), {
        name,
        context: sentenceWith(sentences, raw),
        count: countOccurrences(text, raw),
      })
    }
  }

  // 2. Словарь типовых реквизитов
  for (const attr of ATTRIBUTE_WORDS) {
    for (const trigger of attr.triggers) {
      if (lower.includes(trigger)) {
        if (!map.has(attr.name.toLowerCase())) {
          map.set(attr.name.toLowerCase(), {
            name: attr.name,
            context: sentenceWith(sentences, trigger),
            count: countOccurrences(text, trigger),
          })
        }
        break
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

function collectSections(text: string): FoundSection[] {
  const lower = text.toLowerCase()
  const sections: FoundSection[] = []
  for (const section of SECTIONS) {
    let count = 0
    for (const trigger of section.triggers) {
      const re = new RegExp(esc(trigger), 'gi')
      const matches = lower.match(re)
      if (matches) count += matches.length
    }
    if (count > 0) sections.push({ name: section.name, count })
  }
  return sections.sort((a, b) => b.count - a.count)
}

// ---------- Пробелы в требованиях ----------

interface CheckContext {
  text: string
  lower: string
  words: number
  entities: FoundEntity[]
  attributes: FoundAttribute[]
  hasDocuments: boolean
}

const has = (lower: string, re: RegExp) => re.test(lower)

interface GapDef {
  id: string
  title: string
  description: string
  question: string
  severity: Severity
  check: (ctx: CheckContext) => boolean
}

const GAP_DEFS: GapDef[] = [
  {
    id: 'too_short',
    title: 'ТЗ слишком краткое',
    description: 'Текст содержит очень мало деталей — разработчику будет сложно понять задачу без дополнительных вопросов.',
    question: 'Дополните описание: что должно происходить, кто пользователь, какие данные участвуют, каков ожидаемый результат?',
    severity: 'critical',
    check: (ctx) => ctx.words < 40,
  },
  {
    id: 'acceptance',
    title: 'Нет критериев приёмки',
    description: 'Не описано, по каким признакам будет считаться, что задача выполнена корректно.',
    question: 'По каким признакам разработчик поймёт, что задача выполнена? Сформулируйте 2–5 проверяемых критериев.',
    severity: 'critical',
    check: (ctx) => !has(ctx.lower, /критери[йя]|приёмк|приемк|acceptance|готово, когда|приемка/i),
  },
  {
    id: 'roles',
    title: 'Не описаны роли и права доступа',
    description: 'Упоминаются пользователи, но не сказано, кто именно выполняет действие и какие права ему нужны.',
    question: 'Какие роли пользователей задействованы и какие права доступа им необходимы?',
    severity: 'warning',
    check: (ctx) =>
      has(ctx.lower, /пользовател|сотрудник|роль|менеджер/i) &&
      !has(ctx.lower, /рол[ьяи]|прав[ао]|доступ/i),
  },
  {
    id: 'attributes',
    title: 'Не описана структура данных',
    description: 'Найдены объекты, но не указаны их реквизиты и типы данных.',
    question: 'Какие реквизиты должны быть у найденных объектов, какого они типа и какие обязательны?',
    severity: 'warning',
    check: (ctx) => ctx.entities.length > 0 && ctx.attributes.length === 0,
  },
  {
    id: 'moves',
    title: 'Не описаны движения и регистры',
    description: 'Упоминаются документы, но не сказано, какие регистры они должны затрагивать и какие движения формировать.',
    question: 'Какие регистры должны затрагивать документы и какие движения (приход/расход) формировать?',
    severity: 'warning',
    check: (ctx) =>
      ctx.hasDocuments && !has(ctx.lower, /движен|регистр|проведен|оперативн|запис/i),
  },
  {
    id: 'imports',
    title: 'Не описано поведение при повторной загрузке',
    description: 'Есть загрузка/импорт данных, но не указано, что происходит при повторной загрузке тех же данных.',
    question: 'Что делать при повторной загрузке: пропускать дубли, обновлять существующие записи или блокировать?',
    severity: 'warning',
    check: (ctx) =>
      has(ctx.lower, /загрузк|импорт|выгрузк|обмен/i) && !has(ctx.lower, /повторн|дубл|перезапис/i),
  },
  {
    id: 'errors',
    title: 'Не описаны граничные случаи',
    description: 'Не сказано, как система должна вести себя при некорректных, неполных или аномальных данных.',
    question: 'Что делать при некорректных данных, пустых значениях или нештатных ситуациях?',
    severity: 'info',
    check: (ctx) => !has(ctx.lower, /ошибк|исключ|граничн|некорректн|при отсутствии|пуст|не заполнен/i),
  },
  {
    id: 'current',
    title: 'Не описано текущее поведение',
    description: 'Не указано, как система ведёт себя сейчас, — сложно оценить объём изменений.',
    question: 'Как система ведёт себя в настоящее время и что именно нужно изменить?',
    severity: 'info',
    check: (ctx) => !has(ctx.lower, /сейчас|в настоящее время|текущ|существующ|ранее|до сих пор/i),
  },
  {
    id: 'ui',
    title: 'Не описан интерфейс',
    description: 'Не указано, где пользователь выполняет действие: на форме, в списке, в отдельном помощнике.',
    question: 'Где пользователь должен выполнять действие — на форме документа, в списке, в отдельном помощнике?',
    severity: 'info',
    check: (ctx) => !has(ctx.lower, /форма|интерфейс|кнопк|диалог|экран|табличн/i),
  },
  {
    id: 'priority',
    title: 'Не указаны приоритет и сроки',
    description: 'Отсутствует информация о срочности — сложно спланировать передачу задачи в разработку.',
    question: 'Каков приоритет задачи и ожидаемые сроки выполнения?',
    severity: 'info',
    check: (ctx) => !has(ctx.lower, /приоритет|срок|в течение|крайний|дедлайн|до \d{1,2}[ .]\d{1,2}/i),
  },
  {
    id: 'units',
    title: 'Не указаны единицы измерения и валюта',
    description: 'Упоминаются суммы/количества, но не сказано, в каких единицах и валюте.',
    question: 'В каких единицах измерения и валюте считаются суммы и количества?',
    severity: 'info',
    check: (ctx) =>
      has(ctx.lower, /количеств|сумм|цена|стоимост/i) &&
      !has(ctx.lower, /руб|₽|валют|шт|ед\.|единиц|кг|тонн|литр/i),
  },
]

function buildRecommendations(ctx: CheckContext, gaps: Gap[]): Recommendation[] {
  const recs: Recommendation[] = []

  if (ctx.entities.length === 0) {
    recs.push({
      text: 'Указывайте имена объектов конфигурации в кавычках с типом: например, «Документ „Заказ клиента“», «Справочник „Номенклатура“».',
    })
  }
  if (ctx.attributes.length === 0) {
    recs.push({
      text: 'Опишите реквизиты в виде таблицы: наименование, тип данных, обязательность заполнения.',
    })
  }
  if (ctx.entities.length === 0 && ctx.attributes.length === 0) {
    recs.push({
      text: 'Опишите бизнес-процесс по шагам: кто, когда и что делает, какие данные вводятся и что происходит после.',
    })
  }

  for (const gap of gaps) {
    if (gap.severity === 'critical') {
      recs.push({ text: `Добавьте в ТЗ раздел «${gap.title}».` })
    }
  }

  if (ctx.hasDocuments) {
    recs.push({
      text: 'Для каждого документа укажите: печатные формы, движения по регистрам и правила проведения.',
    })
  }
  recs.push({
    text: 'Опишите ожидаемый результат в формате «До» / «После», чтобы разработчик видел разницу.',
  })
  recs.push({
    text: 'Согласуйте найденные объекты и реквизиты с разработчиком до передачи задачи.',
  })

  return recs
}

// ---------- Точка входа ----------

export function analyzeText(text: string): AnalysisResult {
  const normalized = text.trim()
  const words = normalized.split(/\s+/).filter(Boolean).length
  const lower = normalized.toLowerCase()
  const sentences = splitSentences(normalized)

  const candidates = collectCandidates(normalized, sentences)
  const entities = dedupeEntities(candidates)
  const attributes = collectAttributes(normalized, sentences)
  const sections = collectSections(normalized)

  const ctx: CheckContext = {
    text: normalized,
    lower,
    words,
    entities,
    attributes,
    hasDocuments: entities.some((e) => e.type === 'Документ'),
  }

  const gaps: Gap[] = []
  for (const def of GAP_DEFS) {
    if (def.check(ctx)) {
      gaps.push({
        id: def.id,
        title: def.title,
        description: def.description,
        question: def.question,
        severity: def.severity,
      })
    }
  }

  const recommendations = buildRecommendations(ctx, gaps)

  return { words, entities, attributes, sections, gaps, recommendations }
}
