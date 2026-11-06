const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-fetch-user-agent, x-fetch-cookie, x-fetch-authorization, x-fetch-if-none-match, x-fetch-if-modified-since',
  'Access-Control-Expose-Headers': 'x-fetch-status, x-fetch-url, x-fetch-etag, x-fetch-last-modified, x-fetch-content-type',
}

const defaultUserAgent = 'Mozilla/5.0 (compatible; RSS Reader)'

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return host.includes(':')
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false
  const [a, b] = parts
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const target = new URL(req.url).searchParams.get('url')
  if (!target) return new Response('Missing url parameter', { status: 400, headers: corsHeaders })

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return new Response('Invalid url', { status: 400, headers: corsHeaders })
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateHost(parsed.hostname)) {
    return new Response('Forbidden url', { status: 403, headers: corsHeaders })
  }

  const headers = new Headers({
    'User-Agent': req.headers.get('x-fetch-user-agent') || defaultUserAgent,
    Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/html;q=0.8, */*;q=0.7',
  })
  const cookie = req.headers.get('x-fetch-cookie')
  if (cookie) headers.set('Cookie', cookie)
  const auth = req.headers.get('x-fetch-authorization')
  if (auth) headers.set('Authorization', auth)
  const etag = req.headers.get('x-fetch-if-none-match')
  if (etag) headers.set('If-None-Match', etag)
  const modified = req.headers.get('x-fetch-if-modified-since')
  if (modified) headers.set('If-Modified-Since', modified)

  try {
    const upstream = await fetch(parsed, { headers, redirect: 'follow', signal: AbortSignal.timeout(25000) })
    const body = upstream.status === 304 ? null : await upstream.arrayBuffer()
    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'x-fetch-status': String(upstream.status),
        'x-fetch-url': upstream.url,
        'x-fetch-etag': upstream.headers.get('etag') || '',
        'x-fetch-last-modified': upstream.headers.get('last-modified') || '',
        'x-fetch-content-type': upstream.headers.get('content-type') || '',
      },
    })
  } catch (error) {
    return new Response(String(error instanceof Error ? error.message : error), { status: 502, headers: corsHeaders })
  }
})
