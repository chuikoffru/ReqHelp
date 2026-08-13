import { useEffect, useState } from 'react'

const STEPS = [
  'Разбор текста ТЗ',
  'Поиск объектов конфигурации',
  'Выделение реквизитов',
  'Проверка пробелов в требованиях',
  'Формирование отчёта',
]

export default function AnalyzingStep() {
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (done) return
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= STEPS.length - 1) {
          clearInterval(t)
          setDone(true)
          return i
        }
        return i + 1
      })
    }, 500)
    return () => clearInterval(t)
  }, [done])

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

        <h2 className="mb-8 text-center text-xl font-semibold text-slate-800">
          {done ? 'Анализ завершён' : 'Идёт анализ...'}
        </h2>

        <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-indigo-600 transition-all duration-300 ease-out"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
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