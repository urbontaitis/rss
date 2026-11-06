export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function stripTags(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

export function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

export function fromBase64(value: string): string {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function readingTime(html: string): number {
  const text = stripTags(html)
  if (!text) return 0
  const cjk = (text.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g) || []).length
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(cjk > words ? cjk / 500 : words / 265))
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function absoluteUrl(value: string, base: string): string {
  if (!value) return ''
  try {
    return new URL(value.trim(), base || undefined).toString()
  } catch {
    return value.trim()
  }
}

export function textToHtml(value: string): string {
  const linked = escapeHtml(value).replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1">$1</a>')
  return linked
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
