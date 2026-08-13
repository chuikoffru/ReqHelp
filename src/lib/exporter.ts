import type { AnalysisResult } from '../../shared/analysis'

export function buildMarkdown(result: AnalysisResult): string {
  const lines: string[] = []
  lines.push('# Анализ технического задания')
  lines.push('', `_Сформировано автоматически. Количество слов в ТЗ: **${result.words}**._`)
  lines.push('', '> Результаты носят рекомендательный характер и требуют проверки аналитиком и разработчиком.')

  lines.push('', '## Найденные объекты конфигурации')
  if (result.entities.length === 0) {
    lines.push('', 'Явных имён объектов не обнаружено. Укажите их в кавычках с типом.')
  } else {
    lines.push('', '| Объект | Тип | Уверенность | Упоминаний |')
    lines.push('| --- | --- | --- | --- |')
    for (const e of result.entities) {
      lines.push(`| ${e.name} | ${e.type} | ${e.confidence} | ${e.count} |`)
    }
  }

  lines.push('', '## Предполагаемые реквизиты')
  if (result.attributes.length === 0) {
    lines.push('', 'Реквизиты не обнаружены.')
  } else {
    lines.push('', result.attributes.map((a) => `- ${a.name}`).join('\n'))
  }

  lines.push('', '## Затронутые разделы конфигурации')
  if (result.sections.length === 0) {
    lines.push('', 'Разделы не определены.')
  } else {
    lines.push('', result.sections.map((s) => `- ${s.name}`).join('\n'))
  }

  lines.push('', '## Пробелы в требованиях и вопросы для уточнения')
  if (result.gaps.length === 0) {
    lines.push('', 'Существенных пробелов не выявлено.')
  } else {
    for (const g of result.gaps) {
      lines.push('', `### ${g.title} (${g.severity === 'critical' ? 'критично' : g.severity === 'warning' ? 'важно' : 'уточнить'})`)
      lines.push('', g.description)
      lines.push('', `> **Уточнить:** ${g.question}`)
    }
  }

  lines.push('', '## Рекомендации')
  for (const r of result.recommendations) {
    lines.push('', `- ${r.text}`)
  }

  lines.push('', '## Технические детали (блок для вставки в ТЗ)')
  lines.push('', '**Объекты конфигурации:**')
  if (result.entities.length === 0) {
    lines.push('- _не указаны_')
  } else {
    for (const e of result.entities) lines.push(`- «${e.name}» — ${e.type.toLowerCase()}`)
  }
  lines.push('', '**Предполагаемые реквизиты:**')
  if (result.attributes.length === 0) {
    lines.push('- _не указаны_')
  } else {
    for (const a of result.attributes) lines.push(`- ${a.name}`)
  }
  lines.push('', '**Затронутые разделы:**')
  if (result.sections.length === 0) {
    lines.push('- _не определены_')
  } else {
    for (const s of result.sections) lines.push(`- ${s.name}`)
  }

  return lines.join('\n')
}

export function downloadText(content: string, filename: string, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function copyToClipboard(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = content
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}