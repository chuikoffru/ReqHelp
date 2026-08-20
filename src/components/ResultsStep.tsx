import { useState } from 'react'
import type { AnalysisResult, AnalysisTiming, EntityType, Severity } from '../../shared/analysis'
import { buildMarkdown, downloadText, copyToClipboard } from '../lib/exporter'
import { formatDuration } from '../lib/formatDuration'

// ---------- Цвета ----------

const TYPE_COLORS: Record<EntityType, string> = {
  Документ: 'bg-blue-100 text-blue-800 border-blue-200',
  Справочник: 'bg-violet-100 text-violet-800 border-violet-200',
  Регистр: 'bg-amber-100 text-amber-800 border-amber-200',
  'Отчёт': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Обработка: 'bg-pink-100 text-pink-800 border-pink-200',
  Перечисление: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  Константа: 'bg-slate-100 text-slate-800 border-slate-200',
  'Бизнес-процесс': 'bg-orange-100 text-orange-800 border-orange-200',
  Объект: 'bg-gray-100 text-gray-600 border-gray-200',
}

const CONFIDENCE_COLORS: Record<string, string> = {
  высокая: 'bg-green-100 text-green-700',
  средняя: 'bg-yellow-100 text-yellow-700',
  низкая: 'bg-slate-100 text-slate-500',
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'border-rose-200 bg-rose-50',
  warning: 'border-amber-200 bg-amber-50',
  info: 'border-sky-200 bg-sky-50',
}

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Критично',
  warning: 'Важно',
  info: 'Уточнить',
}

// ---------- Подкомпоненты ----------

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${color}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-medium opacity-80">{label}</p>
    </div>
  )
}

function EntityTable({ entities }: { entities: AnalysisResult['entities'] }) {
  if (entities.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        Явных имён объектов не обнаружено. Укажите их в кавычках с типом, например «Документ „Заказ клиента“».
      </p>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-600">
          <tr>
            <th className="px-4 py-3">Объект</th>
            <th className="px-4 py-3">Тип</th>
            <th className="px-4 py-3">Уверенность</th>
            <th className="px-4 py-3 text-right">Упоминаний</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entities.map((e) => (
            <tr key={e.name} className="hover:bg-slate-50/50">
              <td className="px-4 py-3 font-medium text-slate-900">{e.name}</td>
              <td className="px-4 py-3">
                <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[e.type]}`}>
                  {e.type}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[e.confidence]}`}>
                  {e.confidence}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-slate-600">{e.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AttributeTags({ attributes }: { attributes: AnalysisResult['attributes'] }) {
  if (attributes.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Реквизиты не обнаружены. Добавьте их в текст или укажите в таблице, например «реквизит „Скидка“».
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {attributes.map((a) => (
        <span
          key={a.name}
          className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700"
        >
          {a.name}
          <span className="text-xs text-indigo-400">×{a.count}</span>
        </span>
      ))}
    </div>
  )
}

function SectionTags({ sections }: { sections: AnalysisResult['sections'] }) {
  if (sections.length === 0) {
    return <p className="text-sm text-slate-500">Разделы не определены.</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {sections.map((s) => (
        <span
          key={s.name}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 shadow-sm"
        >
          {s.name}
          <span className="text-xs text-slate-400">×{s.count}</span>
        </span>
      ))}
    </div>
  )
}

function GapCards({ gaps }: { gaps: AnalysisResult['gaps'] }) {
  if (gaps.length === 0) {
    return (
      <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 text-sm font-medium text-green-700">
        Существенных пробелов не выявлено.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {gaps.map((g) => (
        <div
          key={g.id}
          className={`rounded-xl border p-4 ${SEVERITY_COLORS[g.severity]}`}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide">
              {SEVERITY_LABELS[g.severity]}
            </span>
            <h4 className="font-semibold text-slate-900">{g.title}</h4>
          </div>
          <p className="mb-2 text-sm text-slate-700">{g.description}</p>
          <p className="text-sm font-medium text-slate-800">
            <span className="opacity-60">Уточнить:</span> {g.question}
          </p>
        </div>
      ))}
    </div>
  )
}

function RecommendationList({ recommendations }: { recommendations: AnalysisResult['recommendations'] }) {
  if (recommendations.length === 0) {
    return <p className="text-sm text-slate-500">Нет дополнительных рекомендаций.</p>
  }
  return (
    <ul className="space-y-2">
      {recommendations.map((r, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
          <span className="mt-0.5 text-indigo-500">✦</span>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  )
}

function TimingPanel({ timing }: { timing: AnalysisTiming }) {
  const llmMs = timing.firstLlmMs + timing.retryLlmMs
  const rows = [
    { label: 'Запрос к модели', ms: timing.firstLlmMs },
    ...(timing.retryLlmMs > 0 ? [{ label: 'Повторный запрос', ms: timing.retryLlmMs }] : []),
    { label: 'Разбор JSON', ms: timing.parseMs },
  ]
  const maxMs = Math.max(timing.totalMs, 1)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Время анализа</h3>
          <p className="text-sm text-slate-500">
            {timing.model} · {timing.attempts === 1 ? 'один запрос' : `${timing.attempts} попытки`}
          </p>
        </div>
        <p className="font-mono text-2xl font-semibold tabular-nums text-indigo-700">
          {formatDuration(timing.totalMs)}
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-slate-600">{row.label}</span>
              <span className="font-mono tabular-nums text-slate-800">{formatDuration(row.ms)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-500"
                style={{ width: `${Math.max(1, Math.round((row.ms / maxMs) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
        <div>
          <dt>Доля LLM</dt>
          <dd className="font-medium text-slate-700">
            {timing.totalMs > 0 ? Math.round((llmMs / timing.totalMs) * 100) : 0}%
          </dd>
        </div>
        <div>
          <dt>Размер промпта</dt>
          <dd className="font-medium text-slate-700">{timing.promptChars.toLocaleString('ru-RU')} симв.</dd>
        </div>
        <div>
          <dt>Токены ответа</dt>
          <dd className="font-medium text-slate-700">{timing.completionTokens ?? '—'}</dd>
        </div>
        <div>
          <dt>Reasoning-токены</dt>
          <dd className="font-medium text-slate-700">{timing.reasoningTokens ?? '—'}</dd>
        </div>
      </dl>
    </div>
  )
}

function ExportPanel({ result }: { result: AnalysisResult }) {
  const [copied, setCopied] = useState(false)
  const [showMd, setShowMd] = useState(false)
  const markdown = buildMarkdown(result)

  const handleCopy = async () => {
    const ok = await copyToClipboard(markdown)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    downloadText(markdown, 'анализ-тз.md')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-700"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Скачать .md
        </button>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {copied ? (
            <>✓ Скопировано</>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Скопировать
            </>
          )}
        </button>
      </div>
      <details className="rounded-xl border border-slate-200 bg-white">
        <summary
          className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          onClick={() => setShowMd(!showMd)}
        >
          {showMd ? 'Скрыть' : 'Показать'} Markdown
        </summary>
        <pre className="max-h-96 overflow-auto border-t border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
          {markdown}
        </pre>
      </details>
    </div>
  )
}

// ---------- Основной компонент ----------

interface ResultsStepProps {
  result: AnalysisResult
  onReset: () => void
}

export default function ResultsStep({ result, onReset }: ResultsStepProps) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-12 pt-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Результаты анализа</h2>
          <p className="mt-1 text-sm text-slate-500">
            Результаты носят рекомендательный характер и требуют проверки человеком.
          </p>
        </div>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Новый анализ
        </button>
      </div>

      {/* Статистика */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Слов в ТЗ" value={result.words} color="border-slate-200 bg-white" />
        <StatCard label="Объектов" value={result.entities.length} color="border-blue-200 bg-blue-50" />
        <StatCard label="Реквизитов" value={result.attributes.length} color="border-violet-200 bg-violet-50" />
        <StatCard label="Разделов" value={result.sections.length} color="border-amber-200 bg-amber-50" />
        <StatCard label="Пробелов" value={result.gaps.length} color="border-rose-200 bg-rose-50" />
      </div>

      {/* Секции */}
      <section className="mb-8">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">Найденные объекты конфигурации</h3>
        <EntityTable entities={result.entities} />
      </section>

      <section className="mb-8">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">Предполагаемые реквизиты</h3>
        <AttributeTags attributes={result.attributes} />
      </section>

      <section className="mb-8">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">Затронутые разделы конфигурации</h3>
        <SectionTags sections={result.sections} />
      </section>

      <section className="mb-8">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">Пробелы и вопросы для уточнения</h3>
        <GapCards gaps={result.gaps} />
      </section>

      <section className="mb-8">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">Рекомендации</h3>
        <RecommendationList recommendations={result.recommendations} />
      </section>

      {result.timing && (
        <section className="mb-8">
          <TimingPanel timing={result.timing} />
        </section>
      )}

      <section className="mb-8">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">Экспорт результата</h3>
        <ExportPanel result={result} />
      </section>
    </div>
  )
}