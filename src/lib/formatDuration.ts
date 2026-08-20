export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} мс`
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(1)} с`
  const m = Math.floor(totalSec / 60)
  const s = Math.round(totalSec % 60)
  return `${m} мин ${s} с`
}
