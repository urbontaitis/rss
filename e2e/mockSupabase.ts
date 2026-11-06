import type { Page, Route } from '@playwright/test'

export const SUPABASE_URL = 'https://mock-project.supabase.co'

const rss = (host: string, title: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://${host}/</link>
<item><title>${title} first post</title><link>https://${host}/1</link><guid>${host}-1</guid><pubDate>Wed, 04 Nov 2026 10:00:00 GMT</pubDate>
<description><![CDATA[<p>Body text <img src="https://${host}/pic.jpg" onerror="window.hacked=1"></p><script>window.hacked=1</script>]]></description></item>
<item><title>Sponsored ${title}</title><link>https://${host}/2</link><guid>${host}-2</guid></item>
<item><title>${title} second post</title><link>https://${host}/3</link><guid>${host}-3</guid><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate><description>Second</description></item>
</channel></rss>`

interface Row {
  [key: string]: unknown
  id: number
}

export interface MockState {
  feeds: Row[]
  entries: Row[]
  categories: Row[]
  settings: Row
  requests: string[]
  nextId: number
}

const feedDefaults = {
  category_id: null, title: '', site_url: '', icon_url: '', description: '', disabled: false, hide_globally: false, crawler: false,
  ignore_http_cache: false, no_media_player: false, server_fetch: true, user_agent: '', cookie: '', username: '', password: '',
  scraper_rules: '', rewrite_rules: '', url_rewrite_rules: '', block_filter_entry_rules: '', keep_filter_entry_rules: '',
  etag: '', last_modified: '', checked_at: null, parsing_error_count: 0, parsing_error_msg: '', created_at: '2026-11-01T00:00:00Z',
}

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'user-1', role: 'authenticated', email: 'me@example.org', exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`
const user = { id: 'user-1', email: 'me@example.org', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' }
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }

function filterValue(param: string | null): { op: string; value: string } | null {
  if (!param) return null
  const index = param.indexOf('.')
  return { op: param.slice(0, index), value: param.slice(index + 1) }
}

function listParam(value: string): string[] {
  return value.replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, ''))
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue
    const filter = filterValue(raw)
    if (!filter) continue
    const actual = String(row[key])
    if (filter.op === 'eq' && actual !== filter.value) return false
    if (filter.op === 'neq' && actual === filter.value) return false
    if (filter.op === 'in' && !listParam(filter.value).includes(actual)) return false
    if (filter.op === 'ilike' && actual.toLowerCase() !== filter.value.toLowerCase()) return false
    if (filter.op === 'wfts' && !String(row.title).toLowerCase().includes(filter.value.split(':').pop()!.toLowerCase())) return false
  }
  return true
}

export async function mockSupabase(page: Page): Promise<MockState> {
  const state: MockState = {
    feeds: [],
    entries: [],
    categories: [],
    settings: { id: 1, block_filter_entry_rules: 'EntryTitle=(?i)sponsored', keep_filter_entry_rules: '', retention_days: 60, server_fetch_enabled: false, updated_at: '2026-11-01T00:00:00Z' },
    requests: [],
    nextId: 1,
  }

  const entryList = () =>
    state.entries.map((entry): Row => {
      const feed = state.feeds.find((item) => item.id === entry.feed_id) as Row
      const category = state.categories.find((item) => item.id === feed.category_id)
      return { ...entry, feed_title: feed.title, feed_site_url: feed.site_url, feed_icon_url: '', category_id: feed.category_id, category_title: category?.title ?? null, hidden: false }
    })

  await page.route(
    (url) => url.hostname !== 'localhost' && url.origin !== SUPABASE_URL,
    (route) => route.fulfill({ status: 204, headers: cors }),
  )

  await page.route(`${SUPABASE_URL}/**`, async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    state.requests.push(`${request.method()} ${url.pathname}`)
    const respond = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...headers }, body: JSON.stringify(body) })

    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (url.pathname === '/auth/v1/token') {
      const body = request.postDataJSON() as { password?: string }
      if (body.password !== 'correct-password') return respond({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' }, 400)
      return respond({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh', user })
    }
    if (url.pathname === '/auth/v1/user') return respond(user)
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors })
    if (url.pathname === '/functions/v1/fetch') {
      const target = new URL(url.searchParams.get('url') as string)
      const headers = { ...cors, 'x-fetch-status': '200', 'x-fetch-url': target.toString(), 'x-fetch-content-type': 'application/rss+xml' }
      if (target.hostname === 'blog.example' && target.pathname === '/') {
        return route.fulfill({ status: 200, headers: { ...headers, 'x-fetch-content-type': 'text/html' }, body: '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>' })
      }
      return route.fulfill({ status: 200, headers, body: rss(target.hostname, target.hostname.split('.')[0].replace(/^./, (c) => c.toUpperCase())) })
    }

    const table = url.pathname.replace('/rest/v1/', '')
    const single = (request.headers()['accept'] || '').includes('vnd.pgrst.object')
    const reply = (rows: unknown) => respond(single && Array.isArray(rows) ? rows[0] ?? null : rows)
    const body = request.postData() ? request.postDataJSON() : null

    if (table === 'rpc/mark_all_read') {
      let count = 0
      state.entries.forEach((entry) => {
        if (entry.status === 'unread') {
          entry.status = 'read'
          count++
        }
      })
      return respond(count)
    }
    if (table.startsWith('rpc/')) return respond(0)
    if (table === 'settings') return reply(request.method() === 'PATCH' ? Object.assign(state.settings, body) : [state.settings])
    if (table === 'feed_snapshots') return reply([])
    if (table === 'feed_counters') {
      return reply(state.feeds.map((feed) => ({ feed_id: feed.id, category_id: feed.category_id, unread: state.entries.filter((e) => e.feed_id === feed.id && e.status === 'unread').length, total: state.entries.filter((e) => e.feed_id === feed.id).length })))
    }

    const collections: Record<string, Row[]> = { feeds: state.feeds, categories: state.categories, entries: state.entries }
    if (table === 'entry_list') {
      const rows = entryList().filter((row) => matches(row, url.searchParams))
      const order = url.searchParams.get('order') || ''
      rows.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)) * (order.startsWith('published_at.asc') ? -1 : 1))
      const range = request.headers()['range']
      const [from, to] = range ? range.split('-').map(Number) : [0, rows.length - 1]
      const offset = Number(url.searchParams.get('offset') || from)
      const limit = Number(url.searchParams.get('limit') || to - from + 1)
      const pageRows = rows.slice(offset, offset + limit)
      return respond(pageRows, 200, { 'content-range': `${offset}-${offset + pageRows.length - 1}/${rows.length}` })
    }

    const collection = collections[table]
    if (!collection) return respond({ message: `unknown table ${table}` }, 404)
    if (request.method() === 'GET') return reply(collection.filter((row) => matches(row, url.searchParams)))
    if (request.method() === 'POST') {
      const conflict = url.searchParams.get('on_conflict')
      const created: Row[] = []
      for (const input of Array.isArray(body) ? body : [body]) {
        if (conflict && collection.some((row) => conflict.split(',').every((key) => row[key] === input[key]))) continue
        const row: Row = table === 'feeds' ? { ...feedDefaults, ...input, id: state.nextId++ } : table === 'entries' ? { status: 'unread', starred: false, created_at: new Date().toISOString(), changed_at: new Date().toISOString(), ...input, id: state.nextId++ } : { hide_globally: false, ...input, id: state.nextId++ }
        collection.push(row)
        created.push(row)
      }
      return reply(created)
    }
    if (request.method() === 'PATCH') {
      const updated = collection.filter((row) => matches(row, url.searchParams))
      updated.forEach((row) => Object.assign(row, body))
      return reply(updated)
    }
    if (request.method() === 'DELETE') {
      const keep = collection.filter((row) => !matches(row, url.searchParams))
      collection.splice(0, collection.length, ...keep)
      return reply([])
    }
    return respond({ message: 'unsupported' }, 405)
  })
  return state
}

export async function signIn(page: Page) {
  await page.goto('./')
  await page.getByLabel('Project URL').fill(SUPABASE_URL)
  await page.getByLabel('Publishable (anon) key').fill('anon-key')
  await page.getByLabel('Email').fill('me@example.org')
  await page.getByLabel('Password').fill('correct-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('link', { name: 'Settings' }).waitFor()
}
