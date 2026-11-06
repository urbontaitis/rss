import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeEntry, makeFeed, makeServerSettings, rssFeed, youtubeFeed } from '../fixtures'
import type { Feed } from '../../lib/types'

const db = vi.hoisted(() => ({
  cleanupEntries: vi.fn(),
  deleteSnapshots: vi.fn(),
  existingHashes: vi.fn(),
  getServerSettings: vi.fn(),
  insertEntries: vi.fn(),
  listFeeds: vi.fn(),
  listSnapshots: vi.fn(),
  updateEntryContent: vi.fn(),
  updateFeed: vi.fn(),
}))
const fetchUrl = vi.hoisted(() => vi.fn())

vi.mock('../../lib/db', () => db)
vi.mock('../../lib/fetcher', async (original) => ({ ...(await original<typeof import('../../lib/fetcher')>()), fetchUrl }))

const refresh = await import('../../lib/refresh')
const { saveSettings } = await import('../../lib/settings')
const { dataStore } = await import('../../lib/store')

const ok = (body: string, extra: Record<string, unknown> = {}) => ({ status: 200, url: 'https://example.org/feed', body, etag: 'E2', lastModified: 'L2', contentType: 'application/rss+xml', ...extra })
const inserted = () => db.insertEntries.mock.calls.flatMap((call) => call[0])

beforeEach(() => {
  Object.values(db).forEach((fn) => fn.mockReset())
  fetchUrl.mockReset()
  db.existingHashes.mockResolvedValue(new Set())
  db.insertEntries.mockImplementation(async (rows: unknown[]) => rows.length)
  db.updateFeed.mockImplementation(async (id: number, patch: Partial<Feed>) => makeFeed({ id, ...patch }))
  db.getServerSettings.mockResolvedValue(makeServerSettings())
  db.listSnapshots.mockResolvedValue([])
  db.deleteSnapshots.mockResolvedValue(undefined)
  db.cleanupEntries.mockResolvedValue(0)
  saveSettings({ refreshIntervalMinutes: 30, refreshConcurrency: 2, refreshOnOpen: true, invidiousInstance: 'yewtu.be' })
  refresh.refreshStore.set({ running: false, lastRun: 0 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('refreshFeed', () => {
  it('stores new entries oldest first with cleaned content and updates the feed', async () => {
    fetchUrl.mockResolvedValue(ok(rssFeed.replace('<p>Full <b>content</b></p>', '<p onclick="x">Full</p><script>bad()</script>')))
    const feed = makeFeed({ title: '', site_url: '', icon_url: '', etag: 'E1', last_modified: 'L1' })
    const added = await refresh.refreshFeed(feed, makeServerSettings())
    expect(added).toBe(2)
    expect(fetchUrl).toHaveBeenCalledWith('https://example.org/feed', expect.objectContaining({ etag: 'E1', lastModified: 'L1' }))
    const rows = inserted()
    expect(rows.map((row) => row.title)).toEqual(['Second & bold', 'First'])
    expect(rows[1]).toMatchObject({ feed_id: 1, url: 'https://example.org/posts/1', author: 'Jane', content: '<p>Full</p>', tags: ['News', 'Extra'], published_at: '2026-11-03T10:00:00.000Z', reading_time: 1 })
    expect(rows[1].hash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0].published_at).toEqual(expect.any(String))
    expect(db.updateFeed).toHaveBeenCalledWith(1, expect.objectContaining({
      title: 'Example & Co',
      site_url: 'https://example.org/',
      icon_url: 'https://example.org/logo.png',
      description: 'About things',
      etag: 'E2',
      last_modified: 'L2',
      parsing_error_count: 0,
      parsing_error_msg: '',
    }))
  })

  it('skips known entries and entries removed by filter rules', async () => {
    fetchUrl.mockResolvedValue(ok(rssFeed))
    db.existingHashes.mockImplementation(async (_id: number, hashes: string[]) => new Set([hashes[1]]))
    const added = await refresh.refreshFeed(makeFeed({ block_filter_entry_rules: 'EntryTitle=Second' }), makeServerSettings())
    expect(added).toBe(1)
    expect(inserted().map((row) => row.title)).toEqual(['First'])

    db.insertEntries.mockClear()
    db.existingHashes.mockResolvedValue(new Set())
    await refresh.refreshFeed(makeFeed(), makeServerSettings({ keep_filter_entry_rules: 'EntryAuthor=Jane' }))
    expect(inserted().map((row) => row.title)).toEqual(['First'])
  })

  it('deduplicates items with the same guid and falls back to url or content for hashing', async () => {
    const xml = '<rss><channel><item><guid>same</guid><title>A</title></item><item><guid>same</guid><title>B</title></item><item><title>Only title</title><description>x</description></item><item><link>https://e.org/u</link></item></channel></rss>'
    fetchUrl.mockResolvedValue(ok(xml))
    await refresh.refreshFeed(makeFeed({ title: 'Kept', site_url: 'https://kept.org', icon_url: 'i', description: 'd' }), makeServerSettings())
    const rows = inserted()
    expect(rows.map((row) => row.title)).toEqual(['https://e.org/u', 'Only title', 'A'])
    expect(new Set(rows.map((row) => row.hash)).size).toBe(3)
    expect(db.updateFeed.mock.calls[0][1]).not.toHaveProperty('title')
    expect(db.updateFeed.mock.calls[0][1]).not.toHaveProperty('icon_url')
  })

  it('names entries without title or link and reports a single new entry', async () => {
    fetchUrl.mockResolvedValue(ok('<rss><channel><item><guid>x</guid><description>body</description></item></channel></rss>'))
    db.listFeeds.mockResolvedValue([makeFeed()])
    await refresh.refreshAll()
    expect(inserted()[0].title).toBe('Untitled')
    expect(refresh.refreshStore.get().message).toBe('1 new entry')
  })

  it('falls back to the site favicon and keeps the parsed icon when there is no site', async () => {
    fetchUrl.mockResolvedValue(ok('<rss><channel><title>T</title><link>https://site.org/blog</link></channel></rss>'))
    await refresh.refreshFeed(makeFeed({ site_url: '', icon_url: '' }), makeServerSettings())
    expect(db.updateFeed.mock.calls[0][1].icon_url).toBe('https://site.org/favicon.ico')

    db.updateFeed.mockClear()
    fetchUrl.mockResolvedValue(ok('<rss><channel><title>T</title></channel></rss>'))
    await refresh.refreshFeed(makeFeed({ feed_url: 'not-a-url', site_url: '', icon_url: '' }), makeServerSettings())
    expect(db.updateFeed.mock.calls[0][1].icon_url).toBe('')
  })

  it('embeds YouTube videos automatically', async () => {
    fetchUrl.mockResolvedValue(ok(youtubeFeed))
    await refresh.refreshFeed(makeFeed({ feed_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=abc' }), makeServerSettings())
    expect(inserted().find((row) => row.title === 'Video')?.content).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('applies feed rewrite rules', async () => {
    fetchUrl.mockResolvedValue(ok(rssFeed))
    await refresh.refreshFeed(makeFeed({ rewrite_rules: 'replace_title("First"|"1st"),remove("b")' }), makeServerSettings())
    expect(inserted().find((row) => row.title === '1st')?.content).toBe('<p>Full </p>')
  })

  it('ignores the HTTP cache when asked', async () => {
    fetchUrl.mockResolvedValue({ ...ok(''), status: 304 })
    await refresh.refreshFeed(makeFeed({ etag: 'E', ignore_http_cache: true }), makeServerSettings())
    expect(fetchUrl.mock.calls[0][1]).toMatchObject({ etag: '', lastModified: '' })
  })

  it('records a check without parsing for not modified responses', async () => {
    fetchUrl.mockResolvedValue({ ...ok(''), status: 304 })
    expect(await refresh.refreshFeed(makeFeed({ parsing_error_count: 3 }), makeServerSettings())).toBe(0)
    expect(db.insertEntries).not.toHaveBeenCalled()
    expect(db.updateFeed).toHaveBeenCalledWith(1, expect.objectContaining({ parsing_error_count: 0, parsing_error_msg: '' }))
  })

  it.each([
    [{ ...ok(''), status: 500 }, 'HTTP 500'],
    [ok('<html><body>not a feed</body></html>'), 'The response is not a valid feed'],
  ])('records failures (%#)', async (response, message) => {
    fetchUrl.mockResolvedValue(response)
    await expect(refresh.refreshFeed(makeFeed({ parsing_error_count: 2 }), makeServerSettings())).rejects.toThrow(message)
    expect(db.updateFeed).toHaveBeenCalledWith(1, expect.objectContaining({ parsing_error_count: 3, parsing_error_msg: message }))
  })

  it('still throws when recording the failure fails', async () => {
    fetchUrl.mockRejectedValue('offline')
    db.updateFeed.mockRejectedValue(new Error('db down'))
    await expect(refresh.refreshFeed(makeFeed(), makeServerSettings())).rejects.toBe('offline')
  })
})

describe('crawler', () => {
  const article = `<html><body><div class="post"><p>Scraped body</p></div><div class="ad">ad</div></body></html>`

  it('replaces content with the scraped page using url rewrite and scraper rules', async () => {
    fetchUrl.mockImplementation(async (url: string) => (url.endsWith('/feed') ? ok(rssFeed) : ok(article, { url: '' })))
    const feed = makeFeed({ crawler: true, scraper_rules: '.post', url_rewrite_rules: 'rewrite("posts/(\\d+)"|"print/$1")', user_agent: 'UA' })
    await refresh.refreshFeed(feed, makeServerSettings())
    expect(fetchUrl).toHaveBeenCalledWith('https://example.org/print/1', expect.objectContaining({ userAgent: 'UA', etag: '' }))
    expect(inserted().find((row) => row.title === 'First')?.content).toBe('<div><p>Scraped body</p></div>')
  })

  it('keeps feed content when scraping fails or finds nothing', async () => {
    fetchUrl.mockImplementation(async (url: string) => {
      if (url.endsWith('/feed')) return ok(rssFeed)
      if (url.endsWith('/1')) return { ...ok(''), status: 404 }
      return ok('<html><body></body></html>')
    })
    await refresh.refreshFeed(makeFeed({ crawler: true, scraper_rules: '.post' }), makeServerSettings())
    expect(inserted().find((row) => row.title === 'First')?.content).toBe('<p>Full <b>content</b></p>')
  })

  it('downloads original content for an existing entry', async () => {
    fetchUrl.mockResolvedValue(ok(article))
    const content = await refresh.downloadOriginal(makeEntry(), makeFeed({ scraper_rules: '.post', rewrite_rules: 'add_image_title' }))
    expect(content).toBe('<div><p>Scraped body</p></div>')
    expect(db.updateEntryContent).toHaveBeenCalledWith(10, content, 1)
    fetchUrl.mockResolvedValue(ok('<html></html>'))
    await expect(refresh.downloadOriginal(makeEntry(), makeFeed({ scraper_rules: '.post' }))).rejects.toThrow('No content could be extracted')
  })
})

describe('refreshAll', () => {
  it('refreshes due feeds, skips recent and disabled ones and reports progress', async () => {
    const now = Date.now()
    db.listFeeds.mockResolvedValue([
      makeFeed({ id: 1, checked_at: null }),
      makeFeed({ id: 2, checked_at: new Date(now - 60000).toISOString() }),
      makeFeed({ id: 3, disabled: true }),
      makeFeed({ id: 4, checked_at: new Date(now - 3600000).toISOString() }),
      makeFeed({ id: 5, checked_at: new Date(now - 3600000).toISOString(), parsing_error_count: 3 }),
    ])
    fetchUrl.mockResolvedValue(ok(rssFeed))
    const revision = dataStore.get().revision
    await refresh.refreshAll()
    expect(db.updateFeed.mock.calls.map((call) => call[0]).sort()).toEqual([1, 4])
    expect(refresh.refreshStore.get()).toMatchObject({ running: false, total: 2, done: 2, newEntries: 4, errors: 0, message: '4 new entries' })
    expect(dataStore.get().revision).toBe(revision + 1)
  })

  it('forces all enabled feeds or only the requested ones', async () => {
    const recent = new Date().toISOString()
    db.listFeeds.mockResolvedValue([makeFeed({ id: 1, checked_at: recent }), makeFeed({ id: 2, checked_at: recent, disabled: true })])
    fetchUrl.mockResolvedValue({ ...ok(''), status: 304 })
    await refresh.refreshAll({ force: true })
    expect(db.updateFeed.mock.calls.map((call) => call[0])).toEqual([1])
    db.updateFeed.mockClear()
    await refresh.refreshAll({ feedIds: [2] })
    expect(db.updateFeed.mock.calls.map((call) => call[0])).toEqual([2])
    expect(db.listSnapshots).toHaveBeenCalledTimes(1)
    expect(refresh.refreshStore.get().message).toBe('0 new entries')
  })

  it('counts failing feeds', async () => {
    db.listFeeds.mockResolvedValue([makeFeed({ id: 1 }), makeFeed({ id: 2 })])
    fetchUrl.mockImplementation(async (url: string) => (url ? Promise.reject(new Error('down')) : ok('')))
    await refresh.refreshAll()
    expect(refresh.refreshStore.get()).toMatchObject({ errors: 2, message: '2 feed(s) failed' })
  })

  it('reports when nothing is due', async () => {
    db.listFeeds.mockResolvedValue([])
    const states: string[] = []
    const unsubscribe = refresh.refreshStore.subscribe(() => states.push(refresh.refreshStore.get().message))
    await refresh.refreshAll()
    unsubscribe()
    expect(states).toContain('All feeds are up to date')
  })

  it('reports loading failures', async () => {
    db.getServerSettings.mockRejectedValue(new Error('JWT expired'))
    db.listFeeds.mockResolvedValue([])
    await refresh.refreshAll()
    expect(refresh.refreshStore.get()).toMatchObject({ running: false, errors: 1, message: '1 feed(s) failed' })
    db.getServerSettings.mockRejectedValue('plain')
    await refresh.refreshAll()
    expect(refresh.refreshStore.get().errors).toBe(1)
  })

  it('turns server snapshots into entries and deletes them', async () => {
    db.listFeeds.mockResolvedValue([makeFeed({ id: 1, checked_at: new Date().toISOString(), title: '' }), makeFeed({ id: 2, disabled: true })])
    db.listSnapshots.mockResolvedValue([
      { id: 11, feed_id: 1, body: rssFeed },
      { id: 12, feed_id: 1, body: 'garbage' },
      { id: 13, feed_id: 2, body: rssFeed },
      { id: 14, feed_id: 99, body: rssFeed },
      { id: 15, feed_id: 1, body: rssFeed },
    ])
    db.updateFeed.mockImplementation(async (id: number, patch: Partial<Feed>) => makeFeed({ id, checked_at: new Date().toISOString(), ...patch }))
    await refresh.refreshAll()
    expect(db.deleteSnapshots).toHaveBeenCalledWith([11, 12, 13, 14, 15])
    expect(db.updateFeed).toHaveBeenCalledTimes(1)
    expect(db.updateFeed.mock.calls[0][1]).toMatchObject({ title: 'Example & Co' })
    expect(refresh.refreshStore.get().newEntries).toBe(4)
  })

  it('continues when snapshots cannot be loaded', async () => {
    db.listFeeds.mockResolvedValue([])
    db.listSnapshots.mockRejectedValue(new Error('missing table'))
    await refresh.refreshAll()
    expect(refresh.refreshStore.get().errors).toBe(0)
  })

  it('does not run twice at the same time', async () => {
    let release: () => void = () => undefined
    db.listFeeds.mockReturnValue(new Promise((resolve) => (release = () => resolve([]))))
    const first = refresh.refreshAll()
    await refresh.refreshAll()
    release()
    await first
    expect(db.listFeeds).toHaveBeenCalledTimes(1)
  })

  it('uses web locks so only one tab refreshes', async () => {
    const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => callback(null))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    db.listFeeds.mockResolvedValue([])
    await refresh.refreshAll()
    expect(request).toHaveBeenCalledWith('rss-refresh', { ifAvailable: true }, expect.any(Function))
    expect(db.listFeeds).not.toHaveBeenCalled()
    request.mockImplementation(async (_name, _options, callback) => callback({}))
    await refresh.refreshAll()
    expect(db.listFeeds).toHaveBeenCalledTimes(1)
  })

  it('cleans up old entries at most once a day', async () => {
    db.listFeeds.mockResolvedValue([])
    await refresh.refreshAll()
    await refresh.refreshAll()
    expect(db.cleanupEntries).toHaveBeenCalledTimes(1)
    localStorage.setItem('rss.lastCleanup', String(Date.now() - 2 * 86400000))
    db.cleanupEntries.mockRejectedValue(new Error('no permission'))
    await refresh.refreshAll()
    expect(db.cleanupEntries).toHaveBeenCalledTimes(2)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await refresh.refreshAll()
    expect(db.cleanupEntries).toHaveBeenCalledTimes(2)
  })
})

describe('startScheduler', () => {
  const setVisibility = (state: DocumentVisibilityState) => Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })

  it('refreshes on open, on an interval and when the tab becomes visible', async () => {
    vi.useFakeTimers()
    db.listFeeds.mockResolvedValue([])
    setVisibility('visible')
    saveSettings({ refreshIntervalMinutes: 10 })
    const stop = refresh.startScheduler()
    await vi.waitFor(() => expect(db.listFeeds).toHaveBeenCalledTimes(1))

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(10 * 60000)
    expect(db.listFeeds).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(10 * 60000)
    expect(db.listFeeds).toHaveBeenCalledTimes(2)

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(db.listFeeds).toHaveBeenCalledTimes(2)

    refresh.refreshStore.set({ lastRun: Date.now() - 11 * 60000 })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(db.listFeeds).toHaveBeenCalledTimes(3)

    stop()
    await vi.advanceTimersByTimeAsync(60 * 60000)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(db.listFeeds).toHaveBeenCalledTimes(3)
    stop()
  })

  it('does not refresh on open when disabled and replaces an older timer', async () => {
    vi.useFakeTimers()
    db.listFeeds.mockResolvedValue([])
    saveSettings({ refreshOnOpen: false, refreshIntervalMinutes: 1 })
    const first = refresh.startScheduler()
    const second = refresh.startScheduler()
    await vi.advanceTimersByTimeAsync(0)
    expect(db.listFeeds).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5 * 60000)
    expect(db.listFeeds).toHaveBeenCalledTimes(1)
    first()
    second()
  })
})
