import { describe, expect, it } from 'vitest'
import { applyTemplate } from '../lib/fetcher'
import { proxify } from '../lib/mediaProxy'
import { buildOpml, parseOpml } from '../lib/opml'
import { renderContent, sanitizeHtml } from '../lib/sanitize'
import { defaultSettings } from '../lib/settings'
import type { Category, Feed } from '../lib/types'

const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Export</title></head><body>
  <outline text="Dev">
    <outline title="A &amp; B" text="A &amp; B" xmlUrl="https://a.org/feed?x=1&amp;y=2" htmlUrl="https://a.org/" type="rss"></outline>
  </outline>
  <outline text="It&#39;s" title="It&#39;s" xmlUrl="https://b.org/rss" htmlUrl="https://b.org" type="rss"></outline>
</body></opml>`

describe('opml', () => {
  it('parses nested categories', () => {
    expect(parseOpml(opml)).toEqual([
      { title: 'A & B', feedUrl: 'https://a.org/feed?x=1&y=2', siteUrl: 'https://a.org/', category: 'Dev' },
      { title: "It's", feedUrl: 'https://b.org/rss', siteUrl: 'https://b.org', category: '' },
    ])
  })

  it('round trips', () => {
    const categories = [{ id: 1, title: 'Dev' }] as Category[]
    const feeds = [
      { id: 1, title: 'A & B', feed_url: 'https://a.org/feed?x=1&y=2', site_url: 'https://a.org/', category_id: 1 },
      { id: 2, title: "It's", feed_url: 'https://b.org/rss', site_url: 'https://b.org', category_id: null },
    ] as Feed[]
    expect(parseOpml(buildOpml(feeds, categories))).toEqual(parseOpml(opml))
  })
})

describe('proxy', () => {
  const settings = { ...defaultSettings, imageProxyTemplate: 'https://proxy.org/?u={encoded}', imageProxyMode: 'all' as const }

  it('applies templates', () => {
    expect(applyTemplate('https://p.org/{base64url}', 'https://a.org/?')).toBe('https://p.org/aHR0cHM6Ly9hLm9yZy8_')
    expect(applyTemplate('https://p.org/?url=', 'https://a.org/x y')).toBe('https://p.org/?url=https%3A%2F%2Fa.org%2Fx%20y')
  })

  it('respects mode', () => {
    expect(proxify('https://a.org/i.png', settings)).toBe('https://proxy.org/?u=https%3A%2F%2Fa.org%2Fi.png')
    expect(proxify('https://a.org/i.png', { ...settings, imageProxyMode: 'http-only' })).toBe('https://a.org/i.png')
    expect(proxify('http://a.org/i.png', { ...settings, imageProxyMode: 'http-only' })).toContain('proxy.org')
    expect(proxify('data:image/png;base64,xx', settings)).toBe('data:image/png;base64,xx')
  })

  it('rewrites images in content', () => {
    const html = renderContent('<p><img src="https://a.org/i.png" srcset="https://a.org/i.png 1x, https://a.org/j.png 2x"></p>', settings)
    expect(html).toContain('src="https://proxy.org/?u=https%3A%2F%2Fa.org%2Fi.png"')
    expect(html).toContain('https://proxy.org/?u=https%3A%2F%2Fa.org%2Fj.png 2x')
  })
})

describe('sanitize', () => {
  it('removes scripts and foreign iframes', () => {
    const clean = sanitizeHtml('<p onclick="x()">a</p><script>alert(1)</script><iframe src="https://evil.org/x"></iframe><iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe><a href="javascript:alert(1)">l</a>')
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('evil.org')
    expect(clean).toContain('youtube-nocookie.com/embed/abc')
    expect(clean).not.toContain('javascript:')
  })
})
