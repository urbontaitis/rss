import { getSettings } from './settings'
import { accessToken } from './supabase'
import { toBase64 } from './text'

export interface FetchOptions {
  userAgent?: string
  cookie?: string
  username?: string
  password?: string
  etag?: string
  lastModified?: string
}

export interface FetchResult {
  status: number
  url: string
  body: string
  etag: string
  lastModified: string
  contentType: string
}

export function applyTemplate(template: string, url: string): string {
  const base64 = toBase64(url)
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (!/\{(url|encoded|base64|base64url)\}/.test(template)) return template + encodeURIComponent(url)
  return template
    .replace(/\{url\}/g, url)
    .replace(/\{encoded\}/g, encodeURIComponent(url))
    .replace(/\{base64\}/g, base64)
    .replace(/\{base64url\}/g, base64url)
}

function detectCharset(contentType: string, bytes: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  if (fromHeader) return fromHeader
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 1024))
  const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1]
  if (fromXml) return fromXml
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
  return fromMeta || 'utf-8'
}

function decode(buffer: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buffer)
  try {
    return new TextDecoder(detectCharset(contentType, bytes)).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

export async function fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const settings = getSettings()
  const userAgent = options.userAgent || settings.defaultUserAgent
  let response: Response

  if (settings.fetchMode === 'edge') {
    const token = await accessToken()
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      apikey: settings.supabaseKey,
    }
    if (userAgent) headers['x-fetch-user-agent'] = userAgent
    if (options.cookie) headers['x-fetch-cookie'] = options.cookie
    if (options.username) headers['x-fetch-authorization'] = 'Basic ' + toBase64(`${options.username}:${options.password ?? ''}`)
    if (options.etag) headers['x-fetch-if-none-match'] = options.etag
    if (options.lastModified) headers['x-fetch-if-modified-since'] = options.lastModified
    const endpoint = `${settings.supabaseUrl.replace(/\/$/, '')}/functions/v1/fetch?url=${encodeURIComponent(url)}`
    response = await fetch(endpoint, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error(`Fetch function error ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const status = Number(response.headers.get('x-fetch-status') || 200)
    const contentType = response.headers.get('x-fetch-content-type') || response.headers.get('content-type') || ''
    return {
      status,
      url: response.headers.get('x-fetch-url') || url,
      body: status === 304 ? '' : decode(await response.arrayBuffer(), contentType),
      etag: response.headers.get('x-fetch-etag') || '',
      lastModified: response.headers.get('x-fetch-last-modified') || '',
      contentType,
    }
  }

  const target = settings.fetchMode === 'custom' && settings.fetchProxyTemplate ? applyTemplate(settings.fetchProxyTemplate, url) : url
  response = await fetch(target, { cache: 'no-store', credentials: 'omit' })
  const contentType = response.headers.get('content-type') || ''
  return {
    status: response.status,
    url: settings.fetchMode === 'direct' ? response.url || url : url,
    body: decode(await response.arrayBuffer(), contentType),
    etag: response.headers.get('etag') || '',
    lastModified: response.headers.get('last-modified') || '',
    contentType,
  }
}
