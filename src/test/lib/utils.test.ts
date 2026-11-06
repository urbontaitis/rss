import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTemplate } from '../../lib/fetcher'
import { proxify, proxifyContent } from '../../lib/mediaProxy'
import { neighbours, rememberList } from '../../lib/navigation'
import { buildOpml, parseOpml } from '../../lib/opml'
import { isAllowedIframe, renderContent, sanitizeHtml } from '../../lib/sanitize'
import { defaultSettings } from '../../lib/settings'
import { bumpCounters, bumpRevision, createStore, dataStore } from '../../lib/store'
import { absoluteUrl, escapeHtml, fromBase64, hostname, readingTime, sha256, stripTags, textToHtml, toBase64 } from '../../lib/text'
import { fullDate, timeAgo } from '../../lib/time'
import { makeCategory, makeFeed } from '../fixtures'

describe('text helpers', () => {
  it('escapes and strips html', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    expect(stripTags('<p>Hello <b>big</b>\n world</p>')).toBe('Hello big world')
    expect(stripTags('')).toBe('')
  })

  it('round trips unicode base64', () => {
    expect(fromBase64(toBase64('Ąžuolas ✓'))).toBe('Ąžuolas ✓')
    expect(fromBase64('aGk_')).toBe('hi?')
    expect(() => fromBase64(btoa('\xff\xfe'))).toThrow()
  })

  it('estimates reading time', () => {
    expect(readingTime('')).toBe(0)
    expect(readingTime('<p>short</p>')).toBe(1)
    expect(readingTime(`<p>${'word '.repeat(530)}</p>`)).toBe(2)
    expect(readingTime(`<p>${'漢'.repeat(1500)}</p>`)).toBe(3)
  })

  it('hashes with sha256', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('resolves urls', () => {
    expect(absoluteUrl('/a', 'https://x.org/b/c')).toBe('https://x.org/a')
    expect(absoluteUrl(' https://y.org ', '')).toBe('https://y.org/')
    expect(absoluteUrl('', 'https://x.org')).toBe('')
    expect(absoluteUrl('relative', '')).toBe('relative')
  })

  it('converts text to paragraphs with links', () => {
    expect(textToHtml('a <b>\nhttps://x.org/p?q=1\n\nnext')).toBe('<p>a &lt;b&gt;<br><a href="https://x.org/p?q=1">https://x.org/p?q=1</a></p><p>next</p>')
  })

  it('extracts hostnames', () => {
    expect(hostname('https://www.example.org/x')).toBe('example.org')
    expect(hostname('nope')).toBe('')
  })
})

describe('time helpers', () => {
  afterEach(() => vi.useRealTimers())

  it('formats relative times', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
    expect(timeAgo(null)).toBe('never')
    expect(timeAgo('2026-11-06T11:59:30Z')).toBe('just now')
    expect(timeAgo('2026-11-06T11:00:00Z')).toBe('1 hour ago')
    expect(timeAgo('2026-11-04T12:00:00Z')).toBe('2 days ago')
    expect(timeAgo('2025-11-01T12:00:00Z')).toBe('last year')
    expect(fullDate('2026-11-06T12:00:00Z')).toBe(new Date('2026-11-06T12:00:00Z').toLocaleString())
  })
})

describe('opml', () => {
  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Export</title></head><body>
  <outline text="Dev">
    <outline title="A &amp; B" text="A &amp; B" xmlUrl="https://a.org/feed?x=1&amp;y=2" htmlUrl="https://a.org/" type="rss"></outline>
    <outline text="Nested">
      <outline text="Deep" xmlurl="https://deep.org/rss"/>
    </outline>
  </outline>
  <outline text="It&#39;s" xmlUrl="https://b.org/rss" category="/Tagged,Other"/>
  <outline xmlUrl=" https://c.org/rss "/>
  <!-- note -->
</body></opml>`

  it('parses nested categories and attribute variants', () => {
    expect(parseOpml(opml)).toEqual([
      { title: 'A & B', feedUrl: 'https://a.org/feed?x=1&y=2', siteUrl: 'https://a.org/', category: 'Dev' },
      { title: 'Deep', feedUrl: 'https://deep.org/rss', siteUrl: '', category: 'Nested' },
      { title: "It's", feedUrl: 'https://b.org/rss', siteUrl: '', category: 'Tagged' },
      { title: '', feedUrl: 'https://c.org/rss', siteUrl: '', category: '' },
    ])
  })

  it('rejects invalid documents', () => {
    expect(() => parseOpml('<opml>')).toThrow('Invalid OPML file')
    expect(() => parseOpml('<opml><head/></opml>')).toThrow('OPML file has no body')
  })

  it('exports and re-imports feeds', () => {
    const categories = [makeCategory({ id: 2, title: 'Zed' }), makeCategory({ id: 1, title: 'Dev' }), makeCategory({ id: 3, title: 'Empty' })]
    const feeds = [
      makeFeed({ id: 1, title: 'A & "B"', feed_url: 'https://a.org/feed?x=1&y=2', site_url: 'https://a.org/', category_id: 1 }),
      makeFeed({ id: 2, title: 'Z', feed_url: 'https://z.org/rss', category_id: 2 }),
      makeFeed({ id: 3, title: "It's", feed_url: 'https://b.org/rss', site_url: 'https://b.org', category_id: null }),
    ]
    const xml = buildOpml(feeds, categories)
    expect(xml).not.toContain('Empty')
    expect(xml.indexOf('Dev')).toBeLessThan(xml.indexOf('Zed'))
    expect(parseOpml(xml).map((feed) => [feed.title, feed.feedUrl, feed.category])).toEqual([
      ['A & "B"', 'https://a.org/feed?x=1&y=2', 'Dev'],
      ['Z', 'https://z.org/rss', 'Zed'],
      ["It's", 'https://b.org/rss', ''],
    ])
  })
})

describe('media proxy', () => {
  const settings = { ...defaultSettings, imageProxyTemplate: 'https://proxy.org/?u={encoded}', imageProxyMode: 'all' as const }

  it('fills templates', () => {
    expect(applyTemplate('https://p.org/{base64url}', 'https://a.org/?')).toBe('https://p.org/aHR0cHM6Ly9hLm9yZy8_')
    expect(applyTemplate('https://p.org/{base64}', 'https://a.org/?')).toBe('https://p.org/aHR0cHM6Ly9hLm9yZy8/')
    expect(applyTemplate('https://p.org/{url}', 'https://a.org/x')).toBe('https://p.org/https://a.org/x')
    expect(applyTemplate('https://p.org/?url=', 'https://a.org/x y')).toBe('https://p.org/?url=https%3A%2F%2Fa.org%2Fx%20y')
  })

  it('respects the mode', () => {
    expect(proxify('https://a.org/i.png', settings)).toBe('https://proxy.org/?u=https%3A%2F%2Fa.org%2Fi.png')
    expect(proxify('https://a.org/i.png', { ...settings, imageProxyMode: 'http-only' })).toBe('https://a.org/i.png')
    expect(proxify('HTTP://a.org/i.png', { ...settings, imageProxyMode: 'http-only' })).toContain('proxy.org')
    expect(proxify('https://a.org/i.png', { ...settings, imageProxyMode: 'none' })).toBe('https://a.org/i.png')
    expect(proxify('https://a.org/i.png', { ...settings, imageProxyTemplate: '' })).toBe('https://a.org/i.png')
    expect(proxify('data:image/png;base64,xx', settings)).toBe('data:image/png;base64,xx')
    expect(proxify('', settings)).toBe('')
  })

  it('rewrites images, sources, posters and optionally media', () => {
    const doc = new DOMParser().parseFromString('<img src="https://a.org/i.png" srcset="https://a.org/i.png 1x, https://a.org/j.png 2x"><picture><source srcset="https://a.org/k.webp"></picture><video poster="https://a.org/p.jpg" src="https://a.org/v.mp4"><source src="https://a.org/v.webm"></video><audio src="https://a.org/a.mp3"></audio>', 'text/html')
    proxifyContent(doc.body, settings)
    const html = doc.body.innerHTML
    expect(html).toContain('src="https://proxy.org/?u=https%3A%2F%2Fa.org%2Fi.png"')
    expect(html).toContain('https://proxy.org/?u=https%3A%2F%2Fa.org%2Fj.png 2x')
    expect(html).toContain('srcset="https://proxy.org/?u=https%3A%2F%2Fa.org%2Fk.webp"')
    expect(html).toContain('poster="https://proxy.org/?u=https%3A%2F%2Fa.org%2Fp.jpg"')
    expect(html).toContain('src="https://proxy.org/?u=https%3A%2F%2Fa.org%2Fv.mp4"')
    expect(html).toContain('src="https://proxy.org/?u=https%3A%2F%2Fa.org%2Fv.webm"')
    expect(html).toContain('src="https://proxy.org/?u=https%3A%2F%2Fa.org%2Fa.mp3"')

    const noMedia = new DOMParser().parseFromString('<audio src="https://a.org/a.mp3"></audio><img src="https://a.org/i.png">', 'text/html')
    proxifyContent(noMedia.body, { ...settings, imageProxyMedia: false })
    expect(noMedia.body.innerHTML).toContain('src="https://a.org/a.mp3"')
    expect(noMedia.body.innerHTML).toContain('proxy.org')

    const disabled = new DOMParser().parseFromString('<img src="https://a.org/i.png">', 'text/html')
    proxifyContent(disabled.body, { ...settings, imageProxyMode: 'none' })
    expect(disabled.body.innerHTML).toBe('<img src="https://a.org/i.png">')
  })
})

describe('sanitizer', () => {
  it('removes scripts, handlers, styles and dangerous urls', () => {
    const clean = sanitizeHtml('<p onclick="x()" style="color:red" class="c" id="i">a</p><script>alert(1)</script><style>p{}</style><form><input></form><a href="javascript:alert(1)">l</a><object data="x"></object>')
    expect(clean).toBe('<p>a</p><a target="_blank" rel="noopener noreferrer">l</a>')
  })

  it('only allows iframes from trusted hosts and sandboxes them', () => {
    const clean = sanitizeHtml('<iframe src="https://evil.org/embed/x"></iframe><iframe src="http://www.youtube.com/embed/a"></iframe><iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe><iframe></iframe>')
    expect(clean).toBe('<iframe src="https://www.youtube-nocookie.com/embed/abc" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>')
  })

  it('allows the invidious instance and the entry host', () => {
    const html = '<iframe src="https://inv.example/embed/a"></iframe><iframe src="https://pod.example/embed"></iframe>'
    expect(sanitizeHtml(html, { invidiousInstance: 'inv.example', entryUrl: 'https://pod.example/ep/1' }).match(/<iframe/g)).toHaveLength(2)
    expect(sanitizeHtml(html)).toBe('')
    expect(sanitizeHtml(html, { invidiousInstance: 'https://inv.example/', entryUrl: '%%' }).match(/<iframe/g)).toHaveLength(1)
  })

  it('checks iframe hosts', () => {
    expect(isAllowedIframe('https://artist.bandcamp.com/x')).toBe(true)
    expect(isAllowedIframe('not a url')).toBe(false)
  })

  it('makes images lazy and private', () => {
    expect(sanitizeHtml('<img src="https://a.org/i.png" width="10" height="20">')).toBe('<img src="https://a.org/i.png" loading="lazy" decoding="async" referrerpolicy="no-referrer">')
  })

  it('renders with and without an image proxy', () => {
    const html = '<img src="https://a.org/i.png">'
    expect(renderContent(html, defaultSettings)).toBe(sanitizeHtml(html))
    expect(renderContent(html, { ...defaultSettings, imageProxyMode: 'all', imageProxyTemplate: 'https://p.org/?u=' })).toContain('src="https://p.org/?u=https%3A%2F%2Fa.org%2Fi.png"')
  })
})

describe('stores', () => {
  it('notifies subscribers', () => {
    const store = createStore({ a: 1, b: 2 })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.set({ a: 5 })
    expect(store.get()).toEqual({ a: 5, b: 2 })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.set({ a: 6 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('bumps data revisions', () => {
    const { revision, counters } = dataStore.get()
    bumpRevision()
    bumpCounters()
    expect(dataStore.get()).toEqual({ revision: revision + 1, counters: counters + 1 })
  })
})

describe('navigation', () => {
  it('remembers list order for next and previous', () => {
    rememberList([1, 2, 3], '/feed/1?page=2')
    expect(neighbours(2)).toEqual({ prev: 1, next: 3, back: '/feed/1?page=2' })
    expect(neighbours(1)).toEqual({ prev: null, next: 2, back: '/feed/1?page=2' })
    expect(neighbours(3)).toEqual({ prev: 2, next: null, back: '/feed/1?page=2' })
    expect(neighbours(9)).toEqual({ prev: null, next: null, back: '/feed/1?page=2' })
  })
})
