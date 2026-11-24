const krasnoyarskDateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Krasnoyarsk',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const krasnoyarskParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Krasnoyarsk',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatKrasnoyarskDateTime(timestamp: number | null | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return '—'
  return krasnoyarskDateTime.format(new Date(timestamp))
}

export function isBeforeKrasnoyarskCutoff(startedAt: number | null | undefined, cutoff: string, now = Date.now()): boolean {
  if (!cutoff) return true
  const cutoffMatch = cutoff.match(/^(\d{2}):(\d{2})$/)
  if (!cutoffMatch) return false

  const parts = (timestamp: number) => Object.fromEntries(krasnoyarskParts.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]))
  const nowParts = parts(now)
  if (startedAt != null) {
    const startParts = parts(startedAt)
    const nowDate = `${nowParts.year}-${nowParts.month}-${nowParts.day}`
    const startDate = `${startParts.year}-${startParts.month}-${startParts.day}`
    if (nowDate > startDate) return false
    if (nowDate < startDate) return true
  }

  const nowMinutes = Number(nowParts.hour) * 60 + Number(nowParts.minute)
  const cutoffMinutes = Number(cutoffMatch[1]) * 60 + Number(cutoffMatch[2])
  return nowMinutes <= cutoffMinutes
}
