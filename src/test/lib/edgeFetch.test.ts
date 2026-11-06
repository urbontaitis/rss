import { describe, expect, it, vi } from 'vitest'
import { createHandler, isForbiddenHost, isPrivateAddress } from '../../../supabase/functions/fetch/handler'

const request = (url: string, init: RequestInit = {}) => new Request(`https://fn.example/functions/v1/fetch?url=${encodeURIComponent(url)}`, init)

describe('address checks', () => {
  it.each([
    ['10.0.0.1', true],
    ['127.0.0.1', true],
    ['0.0.0.0', true],
    ['100.64.0.1', true],
    ['169.254.169.254', true],
    ['172.16.0.1', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['198.18.0.1', true],
    ['224.0.0.1', true],
    ['8.8.8.8', false],
    ['::1', true],
    ['::', true],
    ['[::1]', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['fd00::1', true],
    ['fe80::1', true],
    ['2001:4860::8888', false],
    ['example.org', false],
    ['1.2.3', false],
  ])('%s private: %s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected)
  })

  it('forbids local host names', () => {
    expect(isForbiddenHost('localhost')).toBe(true)
    expect(isForbiddenHost('LOCALHOST.')).toBe(true)
    expect(isForbiddenHost('db.internal')).toBe(true)
    expect(isForbiddenHost('printer.local')).toBe(true)
    expect(isForbiddenHost('router.home.arpa')).toBe(true)
    expect(isForbiddenHost('metadata.google.internal')).toBe(true)
    expect(isForbiddenHost('fcbarcelona.com')).toBe(false)
  })
})

describe('fetch handler', () => {
  it('answers preflight and rejects bad requests', async () => {
    const handler = createHandler({ fetch: vi.fn() })
    const preflight = await handler(new Request('https://fn.example/', { method: 'OPTIONS' }))
    expect(preflight.status).toBe(200)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    expect((await handler(new Request('https://fn.example/', { method: 'POST' }))).status).toBe(405)
    expect((await handler(new Request('https://fn.example/'))).status).toBe(400)
    expect((await handler(request('not a url'))).status).toBe(400)
    expect((await handler(request('file:///etc/passwd'))).status).toBe(403)
    expect((await handler(request('http://169.254.169.254/latest'))).status).toBe(403)
  })

  it('restricts origins when configured', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    const handler = createHandler({ fetch: fetchMock, allowedOrigins: ['https://app.example'] })
    expect((await handler(request('https://a.org/', { headers: { origin: 'https://evil.example' } }))).status).toBe(403)
    const allowed = await handler(request('https://a.org/', { headers: { origin: 'https://app.example' } }))
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example')
  })

  it('forwards feed headers and returns upstream metadata', async () => {
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => new Response('<rss/>', { status: 200, headers: { 'content-type': 'application/rss+xml', etag: '"e"', 'last-modified': 'LM' } }))
    const handler = createHandler({ fetch: fetchMock as typeof fetch })
    const response = await handler(
      request('https://a.org/feed', {
        headers: { 'x-fetch-user-agent': 'UA', 'x-fetch-cookie': 'c=1', 'x-fetch-authorization': 'Basic x', 'x-fetch-if-none-match': '"old"', 'x-fetch-if-modified-since': 'date' },
      }),
    )
    const sent = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(sent.get('user-agent')).toBe('UA')
    expect(sent.get('cookie')).toBe('c=1')
    expect(sent.get('authorization')).toBe('Basic x')
    expect(sent.get('if-none-match')).toBe('"old"')
    expect(sent.get('if-modified-since')).toBe('date')
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual')
    expect(await response.text()).toBe('<rss/>')
    expect(response.headers.get('x-fetch-status')).toBe('200')
    expect(response.headers.get('x-fetch-url')).toBe('https://a.org/feed')
    expect(response.headers.get('x-fetch-etag')).toBe('"e"')
    expect(response.headers.get('x-fetch-last-modified')).toBe('LM')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('passes through not modified and error statuses', async () => {
    const handler = createHandler({ fetch: vi.fn(async () => new Response(null, { status: 304 })) })
    const notModified = await handler(request('https://a.org/feed'))
    expect(notModified.headers.get('x-fetch-status')).toBe('304')
    expect(notModified.headers.get('content-type')).toBe('application/octet-stream')
    const missing = await createHandler({ fetch: vi.fn(async () => new Response('nope', { status: 404 })) })(request('https://a.org/feed'))
    expect(missing.status).toBe(200)
    expect(missing.headers.get('x-fetch-status')).toBe('404')
  })

  it('follows redirects, rechecking each hop and dropping credentials across origins', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/moved' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://b.org/final' } }))
      .mockResolvedValueOnce(new Response('done'))
    const handler = createHandler({ fetch: fetchMock })
    const response = await handler(request('https://a.org/feed', { headers: { 'x-fetch-cookie': 'secret' } }))
    expect(await response.text()).toBe('done')
    expect(response.headers.get('x-fetch-url')).toBe('https://b.org/final')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://a.org/moved')
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('cookie')).toBe('secret')
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('cookie')).toBeNull()
  })

  it('blocks redirects to private networks and redirect loops', async () => {
    const toPrivate = createHandler({ fetch: vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })) })
    expect((await toPrivate(request('https://a.org/'))).status).toBe(403)
    const loop = createHandler({ fetch: vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://a.org/again' } })), maxRedirects: 2 })
    expect((await loop(request('https://a.org/'))).status).toBe(508)
    const noLocation = createHandler({ fetch: vi.fn(async () => new Response('moved', { status: 302 })) })
    expect((await noLocation(request('https://a.org/'))).headers.get('x-fetch-status')).toBe('302')
  })

  it('rejects hosts that resolve to private addresses', async () => {
    const resolveDns = vi.fn(async (_host: string, type: 'A' | 'AAAA') => (type === 'A' ? ['10.0.0.5'] : []))
    const fetchMock = vi.fn()
    const handler = createHandler({ fetch: fetchMock, resolveDns })
    expect((await handler(request('https://rebind.example/'))).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()

    const failing = createHandler({ fetch: vi.fn(async () => new Response('ok')), resolveDns: vi.fn(async () => Promise.reject(new Error('NXDOMAIN'))) })
    expect((await failing(request('https://public.example/'))).status).toBe(200)

    const literal = vi.fn()
    await createHandler({ fetch: vi.fn(async () => new Response('ok')), resolveDns: literal })(request('https://8.8.8.8/'))
    expect(literal).not.toHaveBeenCalled()
  })

  it('limits response size and reports upstream failures', async () => {
    const big = createHandler({ fetch: vi.fn(async () => new Response('x'.repeat(100))), maxBytes: 10 })
    const tooBig = await big(request('https://a.org/'))
    expect(tooBig.status).toBe(502)
    expect(await tooBig.text()).toBe('Response too large')
    const chunked = createHandler({ fetch: vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('abc')); controller.enqueue(new TextEncoder().encode('def')); controller.close() } }))) })
    expect(await (await chunked(request('https://a.org/'))).text()).toBe('abcdef')
    const empty = createHandler({ fetch: vi.fn(async () => new Response(null, { status: 204 })) })
    const emptyResponse = await empty(request('https://a.org/'))
    expect(emptyResponse.headers.get('x-fetch-status')).toBe('204')
    expect(await emptyResponse.text()).toBe('')
    const broken = createHandler({ fetch: vi.fn(async () => Promise.reject('offline')) })
    const failed = await broken(request('https://a.org/'))
    expect(failed.status).toBe(502)
    expect(await failed.text()).toBe('offline')
    const thrown = createHandler({ fetch: vi.fn(async () => Promise.reject(new Error('reset'))) })
    expect(await (await thrown(request('https://a.org/'))).text()).toBe('reset')
  })
})
