import { useEffect, useState } from 'react'
import { formatClock } from '../lib/formatDuration'

const STEPS = [
  'Разбор текста ТЗ',
  'Поиск объектов конфигурации',
  'Выделение реквизитов',
  'Проверка пробелов в требованиях',
  'Ожидание ответа модели',
]

export default function AnalyzingStep() {
  const [index, setIndex] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const clock = setInterval(() => setElapsedMs(Date.now() - started), 200)
    const steps = setInterval(() => {
      setIndex((i) => Math.min(i + 1, STEPS.length - 1))
    }, 4000)
    return () => {
      clearInterval(clock)
      clearInterval(steps)
    }
  }, [])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-indigo-600">
            <svg
              className="h-6 w-6 animate-spin text-indigo-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </div>
        </div>

        <h2 className="mb-2 text-center text-xl font-semibold text-slate-800">
          Идёт анализ…
        </h2>
        <p
          className="mb-2 text-center font-mono text-4xl font-semibold tabular-nums tracking-tight text-indigo-700"
          aria-live="polite"
        >
          {formatClock(elapsedMs)}
        </p>
        <p className="mb-8 text-center text-sm text-slate-500">
          Обычно это занимает от 20 секунд до нескольких минут
        </p>

        <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-indigo-600 transition-all duration-500 ease-out"
            style={{ width: `${Math.min(92, ((index + 1) / STEPS.length) * 88)}%` }}
          />
        </div>

        <ul className="space-y-3">
          {STEPS.map((step, i) => (
            <li
              key={step}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-all ${
                i <= index
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-800'
                  : 'border-slate-100 bg-white text-slate-400'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i < index
                    ? 'bg-indigo-600 text-white'
                    : i === index
                      ? 'border-2 border-indigo-600 text-indigo-600'
                      : 'border-2 border-slate-200 text-slate-300'
                }`}
              >
                {i < index ? '✓' : i + 1}
              </span>
              <span className={i < index ? 'font-medium' : ''}>{step}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
