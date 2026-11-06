const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(value: string | null): string {
  if (!value) return 'never'
  const seconds = (Date.parse(value) - Date.now()) / 1000
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export function fullDate(value: string): string {
  return new Date(value).toLocaleString()
}
