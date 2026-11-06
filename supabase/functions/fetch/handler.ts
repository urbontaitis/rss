export type ResolveDns = (hostname: string, type: 'A' | 'AAAA') => Promise<string[]>

export interface HandlerOptions {
  fetch: typeof fetch
  resolveDns?: ResolveDns
  allowedOrigins?: string[]
  maxBytes?: number
  maxRedirects?: number
  timeoutMs?: number
}

const exposed = 'x-fetch-status, x-fetch-url, x-fetch-etag, x-fetch-last-modified, x-fetch-content-type'
const allowedHeaders = 'authorization, apikey, x-client-info, content-type, x-fetch-user-agent, x-fetch-cookie, x-fetch-authorization, x-fetch-if-none-match, x-fetch-if-modified-since'
const defaultUserAgent = 'Mozilla/5.0 (compatible; RSS Reader)'

export function isPrivateAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)
    if (mapped) return isPrivateAddress(mapped[1])
    return /^(fc|fd|fe[89ab])/.test(host)
  }
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const [a, b] = parts.map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

export function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(host)) return true
  return isPrivateAddress(host)
}

async function resolvesToPrivate(hostname: string, resolveDns?: ResolveDns): Promise<boolean> {
  if (!resolveDns || /^[\d.]+$/.test(hostname) || hostname.includes(':')) return false
  const results = await Promise.all(
    (['A', 'AAAA'] as const).map((type) => resolveDns(hostname, type).catch(() => [] as string[])),
  )
  return results.flat().some(isPrivateAddress)
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Response too large')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export function createHandler(options: HandlerOptions): (req: Request) => Promise<Response> {
  const maxBytes = options.maxBytes ?? 15 * 1024 * 1024
  const maxRedirects = options.maxRedirects ?? 5
  const timeoutMs = options.timeoutMs ?? 25000

  return async (req) => {
    const origin = req.headers.get('origin') || ''
    const allowOrigin = !options.allowedOrigins?.length ? '*' : options.allowedOrigins.includes(origin) ? origin : ''
    const cors: Record<string, string> = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': allowedHeaders,
      'Access-Control-Expose-Headers': exposed,
      Vary: 'Origin',
    }
    const fail = (status: number, message: string) => new Response(message, { status, headers: cors })

    if (!allowOrigin) return fail(403, 'Origin not allowed')
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    if (req.method !== 'GET') return fail(405, 'Method not allowed')

    const target = new URL(req.url).searchParams.get('url')
    if (!target) return fail(400, 'Missing url parameter')

    let current: URL
    try {
      current = new URL(target)
    } catch {
      return fail(400, 'Invalid url')
    }

    const headers = new Headers({
      'User-Agent': req.headers.get('x-fetch-user-agent') || defaultUserAgent,
      Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/html;q=0.8, */*;q=0.7',
    })
    const forward: [string, string][] = [
      ['x-fetch-cookie', 'Cookie'],
      ['x-fetch-authorization', 'Authorization'],
      ['x-fetch-if-none-match', 'If-None-Match'],
      ['x-fetch-if-modified-since', 'If-Modified-Since'],
    ]
    for (const [from, to] of forward) {
      const value = req.headers.get(from)
      if (value) headers.set(to, value)
    }

    try {
      const signal = AbortSignal.timeout(timeoutMs)
      let upstream: Response | null = null
      for (let hop = 0; hop <= maxRedirects; hop++) {
        if (!['http:', 'https:'].includes(current.protocol) || isForbiddenHost(current.hostname) || (await resolvesToPrivate(current.hostname, options.resolveDns))) {
          return fail(403, 'Forbidden url')
        }
        upstream = await options.fetch(current, { headers: new Headers(headers), redirect: 'manual', signal })
        const location = upstream.headers.get('location')
        if (upstream.status < 300 || upstream.status >= 400 || upstream.status === 304 || !location) break
        await upstream.body?.cancel()
        const next = new URL(location, current)
        if (next.origin !== current.origin) {
          headers.delete('Cookie')
          headers.delete('Authorization')
        }
        current = next
        upstream = null
      }
      if (!upstream) return fail(508, 'Too many redirects')

      const body = upstream.status === 304 ? null : await readLimited(upstream, maxBytes)
      const contentType = upstream.headers.get('content-type') || ''
      return new Response(body, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': contentType || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'x-fetch-status': String(upstream.status),
          'x-fetch-url': current.toString(),
          'x-fetch-etag': upstream.headers.get('etag') || '',
          'x-fetch-last-modified': upstream.headers.get('last-modified') || '',
          'x-fetch-content-type': contentType,
        },
      })
    } catch (error) {
      return fail(502, error instanceof Error ? error.message : String(error))
    }
  }
}
