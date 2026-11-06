import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.fn((url: string, key: string, options: unknown) => ({
  url,
  key,
  options,
  auth: { getSession: vi.fn(async () => ({ data: { session: url.includes('nosession') ? null : { access_token: 'jwt' } } })) },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

const { fetchUrl } = await import('../../lib/fetcher')
const { getClient, resetClient, accessToken } = await import('../../lib/supabase')
const { saveSettings } = await import('../../lib/settings')

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  resetClient()
  saveSettings({ supabaseUrl: 'https://p.supabase.co/', supabaseKey: 'anon', fetchMode: 'edge', fetchProxyTemplate: '', defaultUserAgent: '' })
})

afterEach(() => vi.unstubAllGlobals())

describe('supabase client', () => {
  it('creates one client per connection', async () => {
    const first = getClient()
    expect(getClient()).toBe(first)
    expect(createClient).toHaveBeenLastCalledWith('https://p.supabase.co/', 'anon', { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rss.auth' } })
    saveSettings({ supabaseKey: 'other' })
    expect(getClient()).not.toBe(first)
    expect(await accessToken()).toBe('jwt')
    saveSettings({ supabaseUrl: 'https://nosession.supabase.co' })
    expect(await accessToken()).toBe('')
  })
})

describe('fetchUrl through the edge function', () => {
  it('sends auth and feed options and reads the upstream metadata', async () => {
    fetchMock.mockResolvedValue(
      new Response('<rss/>', {
        headers: { 'x-fetch-status': '200', 'x-fetch-url': 'https://final.org/feed', 'x-fetch-etag': 'E', 'x-fetch-last-modified': 'LM', 'x-fetch-content-type': 'application/rss+xml' },
      }),
    )
    const result = await fetchUrl('https://a.org/feed?x=1', { userAgent: 'UA', cookie: 'c=1', username: 'ūser', password: 'p', etag: 'old', lastModified: 'then' })
    const [endpoint, init] = fetchMock.mock.calls[0]
    expect(endpoint).toBe('https://p.supabase.co/functions/v1/fetch?url=https%3A%2F%2Fa.org%2Ffeed%3Fx%3D1')
    expect(init.headers).toEqual({
      Authorization: 'Bearer jwt',
      apikey: 'anon',
      'x-fetch-user-agent': 'UA',
      'x-fetch-cookie': 'c=1',
      'x-fetch-authorization': 'Basic xatzZXI6cA==',
      'x-fetch-if-none-match': 'old',
      'x-fetch-if-modified-since': 'then',
    })
    expect(result).toEqual({ status: 200, url: 'https://final.org/feed', body: '<rss/>', etag: 'E', lastModified: 'LM', contentType: 'application/rss+xml' })
  })

  it('uses the default user agent and handles not modified responses', async () => {
    saveSettings({ defaultUserAgent: 'Default' })
    fetchMock.mockResolvedValue(new Response(null, { headers: { 'x-fetch-status': '304' } }))
    const result = await fetchUrl('https://a.org/feed', { username: 'u' })
    expect(fetchMock.mock.calls[0][1].headers['x-fetch-user-agent']).toBe('Default')
    expect(fetchMock.mock.calls[0][1].headers['x-fetch-authorization']).toBe('Basic dTo=')
    expect(result).toMatchObject({ status: 304, body: '', url: 'https://a.org/feed', etag: '', contentType: '' })
  })

  it('falls back to the response content type and status', async () => {
    fetchMock.mockResolvedValue(new Response('x', { headers: { 'content-type': 'text/plain' } }))
    expect(await fetchUrl('https://a.org/')).toMatchObject({ status: 200, contentType: 'text/plain' })
  })

  it('throws when the function fails', async () => {
    fetchMock.mockResolvedValue(new Response('Forbidden url', { status: 403 }))
    await expect(fetchUrl('http://127.0.0.1/')).rejects.toThrow('Fetch function error 403: Forbidden url')
  })
})

describe('fetchUrl without the edge function', () => {
  it('uses a custom proxy template', async () => {
    saveSettings({ fetchMode: 'custom', fetchProxyTemplate: 'https://cors.example/?u={encoded}' })
    fetchMock.mockResolvedValue(new Response('body', { status: 200, headers: { etag: 'E', 'last-modified': 'L', 'content-type': 'text/xml' } }))
    const result = await fetchUrl('https://a.org/feed')
    expect(fetchMock.mock.calls[0][0]).toBe('https://cors.example/?u=https%3A%2F%2Fa.org%2Ffeed')
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: 'no-store', credentials: 'omit' })
    expect(result).toEqual({ status: 200, url: 'https://a.org/feed', body: 'body', etag: 'E', lastModified: 'L', contentType: 'text/xml' })
  })

  it('fetches directly and decodes legacy charsets', async () => {
    saveSettings({ fetchMode: 'direct' })
    const latin = new Uint8Array([0x3c, 0x61, 0x3e, 0xe9, 0x3c, 0x2f, 0x61, 0x3e])
    fetchMock.mockResolvedValueOnce(new Response(latin, { headers: { 'content-type': 'text/html; charset=iso-8859-1' } }))
    expect((await fetchUrl('https://a.org/')).body).toBe('<a>é</a>')

    const xmlDecl = new TextEncoder().encode('<?xml version="1.0" encoding="windows-1257"?><a>x</a>')
    fetchMock.mockResolvedValueOnce(new Response(xmlDecl))
    expect((await fetchUrl('https://a.org/')).body).toContain('<a>x</a>')

    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x22, 0x77, 0x69, 0x6e, 0x64, 0x6f, 0x77, 0x73, 0x2d, 0x31, 0x32, 0x35, 0x37, 0x22, 0x3e, 0xe0])))
    expect((await fetchUrl('https://a.org/')).body).toBe('<meta charset="windows-1257">ą')

    fetchMock.mockResolvedValueOnce(new Response('ok', { headers: { 'content-type': 'text/plain; charset=bogus' } }))
    expect((await fetchUrl('https://a.org/')).body).toBe('ok')

    const response = new Response('r')
    Object.defineProperty(response, 'url', { value: 'https://redirected.org/' })
    fetchMock.mockResolvedValueOnce(response)
    expect((await fetchUrl('https://a.org/')).url).toBe('https://redirected.org/')
  })

  it('fetches directly when custom mode has no template', async () => {
    saveSettings({ fetchMode: 'custom', fetchProxyTemplate: '' })
    fetchMock.mockResolvedValue(new Response('x'))
    await fetchUrl('https://a.org/feed')
    expect(fetchMock.mock.calls[0][0]).toBe('https://a.org/feed')
  })
})
