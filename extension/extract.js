function collectPageText() {
  const MAX = 50000
  const selection = (window.getSelection()?.toString() ?? '').trim()
  if (selection) {
    const truncated = selection.length > MAX
    return {
      ok: true,
      text: truncated ? selection.slice(0, MAX) : selection,
      truncated,
      source: 'selection',
    }
  }

  if (!document.body) {
    return { ok: true, text: '', truncated: false, source: 'page' }
  }

  const clone = document.body.cloneNode(true)
  clone.querySelectorAll('script, style, noscript, svg, canvas').forEach((el) => el.remove())
  const raw = clone.innerText ?? ''
  const text = raw
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  const truncated = text.length > MAX
  return {
    ok: true,
    text: truncated ? text.slice(0, MAX) : text,
    truncated,
    source: 'page',
  }
}
