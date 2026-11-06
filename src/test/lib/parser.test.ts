import { describe, expect, it } from 'vitest'
import { discoverFeeds, FeedParseError, looksLikeFeed, parseFeed, stripControlCharacters } from '../../lib/parser'
import { atomFeed, rdfFeed, rssFeed, youtubeFeed } from '../fixtures'

describe('RSS 2.0', () => {
  const feed = parseFeed(rssFeed, 'https://example.org/feed')

  it('reads channel metadata', () => {
    expect(feed.title).toBe('Example & Co')
    expect(feed.siteUrl).toBe('https://example.org/')
    expect(feed.iconUrl).toBe('https://example.org/logo.png')
    expect(feed.description).toBe('About things')
  })

  it('does not confuse atom:link with the channel link', () => {
    expect(feed.siteUrl).not.toBe('https://example.org/feed')
  })

  it('reads item fields and resolves relative links', () => {
    const [item] = feed.items
    expect(item).toMatchObject({
      guid: 'id-1',
      title: 'First',
      url: 'https://example.org/posts/1',
      commentsUrl: 'https://example.org/posts/1#comments',
      author: 'Jane',
      tags: ['News', 'Extra'],
    })
    expect(item.content).toBe('<p>Full <b>content</b></p>')
    expect(item.publishedAt?.toISOString()).toBe('2026-11-03T10:00:00.000Z')
  })

  it('collects enclosures from enclosure and media elements', () => {
    expect(feed.items[0].enclosures).toEqual([
      { url: 'https://example.org/a.mp3', type: 'audio/mpeg', length: 123 },
      { url: 'https://example.org/v.mp4', type: 'video/*', length: 5 },
      { url: 'https://example.org/p.jpg', type: 'image/*', length: 0 },
      { url: 'https://example.org/x.bin', type: '', length: 0 },
    ])
  })

  it('falls back to permalink guid, media description, channel author and strips html from titles', () => {
    const item = feed.items[1]
    expect(item.url).toBe('https://example.org/posts/2')
    expect(item.title).toBe('Second & bold')
    expect(item.author).toBe('Channel Author')
    expect(item.content).toBe('<p>Plain text<br>with newline</p>')
    expect(item.publishedAt).toBeNull()
    expect(item.enclosures).toEqual([{ url: 'https://example.org/t.jpg', type: 'image/*', length: 0 }])
  })

  it('does not use a non permalink guid as url', () => {
    const xml = '<rss><channel><item><guid isPermaLink="false">https://x.org/1</guid></item></channel></rss>'
    expect(parseFeed(xml, 'https://x.org/feed').items[0].url).toBe('')
  })

  it('requires a channel', () => {
    expect(() => parseFeed('<rss version="2.0"></rss>', 'https://x')).toThrow(FeedParseError)
  })

  it('parses dates with timezone abbreviations and SQL style dates', () => {
    const xml = (date: string) => `<rss><channel><item><title>t</title><pubDate>${date}</pubDate></item></channel></rss>`
    expect(parseFeed(xml('Mon, 02 Nov 2026 10:00:00 EST'), 'https://x').items[0].publishedAt?.toISOString()).toBe('2026-11-02T15:00:00.000Z')
    expect(parseFeed(xml('Monday, 02 Nov 2026 10:00:00 CEST'), 'https://x').items[0].publishedAt).not.toBeNull()
    expect(parseFeed(xml('2026-11-02 10:00:00Z'), 'https://x').items[0].publishedAt?.toISOString()).toBe('2026-11-02T10:00:00.000Z')
  })

  it('guesses enclosure types from extensions', () => {
    const xml = '<rss><channel><item><enclosure url="https://x.org/a.MP3?x=1"/><enclosure url="https://x.org/a.mp3?x=1"/><enclosure url="https://x.org/file"/></item></channel></rss>'
    expect(parseFeed(xml, 'https://x').items[0].enclosures.map((e) => e.type)).toEqual(['audio/mpeg', 'audio/mpeg', ''])
  })

  it('removes control characters and byte order marks before parsing', () => {
    const xml = '﻿<rss><channel><title>A\u0001B</title></channel></rss>'
    expect(parseFeed(xml, 'https://x').title).toBe('AB')
  })
})

describe('Atom', () => {
  const feed = parseFeed(atomFeed, 'https://atom.example/feed')

  it('reads feed metadata', () => {
    expect(feed).toMatchObject({ title: 'Atom & Feed', siteUrl: 'https://atom.example/', iconUrl: 'https://atom.example/icon.png', description: 'Sub' })
  })

  it('reads html content, links, categories and enclosures', () => {
    const [item] = feed.items
    expect(item).toMatchObject({
      guid: 'urn:1',
      url: 'https://atom.example/one',
      commentsUrl: 'https://atom.example/one#comments',
      author: 'Feed Author',
      tags: ['Label one', 't2'],
      content: '<p>Escaped <i>html</i></p>',
    })
    expect(item.enclosures).toEqual([{ url: 'https://atom.example/one.mp3', type: 'audio/mpeg', length: 10 }])
    expect(item.publishedAt?.toISOString()).toBe('2026-11-02T08:00:00.000Z')
  })

  it('serializes xhtml content without namespaces and joins authors', () => {
    const item = feed.items[1]
    expect(item.content).toBe('<p>Inline <b>xhtml</b></p>')
    expect(item.author).toBe('A, B')
  })

  it('escapes plain text summaries', () => {
    expect(feed.items[2].content).toBe('<p>Line &lt;one&gt;</p>')
    expect(feed.items[3].content).toBe('plain')
  })

  it('handles YouTube media groups', () => {
    const yt = parseFeed(youtubeFeed, 'https://www.youtube.com/feeds/videos.xml?channel_id=abc')
    const [first, second] = yt.items
    expect(first.content).toBe('<p>Line one<br><a href="https://example.org/link">https://example.org/link</a></p>')
    expect(first.enclosures.map((e) => e.type)).toEqual(['application/x-shockwave-flash', 'image/*'])
    expect(second.title).toBe('Group title')
    expect(second.content).toBe('<b>html</b>')
  })

  it('uses the feed url when there is no alternate link', () => {
    const xml = '<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title></feed>'
    expect(parseFeed(xml, 'https://x.org/feed')).toMatchObject({ siteUrl: '', items: [] })
  })
})

describe('RSS 1.0', () => {
  it('reads items next to the channel', () => {
    const feed = parseFeed(rdfFeed, 'https://rdf.example/rss')
    expect(feed.title).toBe('RDF')
    expect(feed.iconUrl).toBe('https://rdf.example/i.png')
    expect(feed.items[0]).toMatchObject({ title: 'One', url: 'https://rdf.example/1' })
    expect(feed.items[0].publishedAt?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
  })
})

describe('JSON Feed', () => {
  it('parses items, authors and attachments', () => {
    const json = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'J',
      home_page_url: 'https://j.org/',
      favicon: '/fav.png',
      authors: [{ name: 'Feed' }],
      items: [
        { id: 1, url: '/1', title: 'Html', content_html: '<p>x</p>', date_published: '2026-11-01T00:00:00Z', authors: [{ name: 'A' }], tags: ['t'], attachments: [{ url: '/a.mp3', mime_type: 'audio/mpeg', size_in_bytes: 9 }], image: '/i.png' },
        { id: '2', external_url: 'https://e.org/2', content_text: 'Text', date_modified: '2026-11-02T00:00:00Z', author: { name: 'Solo' } },
        { url: 'https://j.org/3', summary: '<sum>' },
        { attachments: [{}] },
      ],
    })
    const feed = parseFeed(json, 'https://j.org/feed.json')
    expect(feed).toMatchObject({ title: 'J', siteUrl: 'https://j.org/', iconUrl: 'https://j.org/fav.png' })
    expect(feed.items[0]).toMatchObject({ guid: '1', url: 'https://j.org/1', author: 'A', tags: ['t'], content: '<p>x</p>' })
    expect(feed.items[0].enclosures).toEqual([
      { url: 'https://j.org/a.mp3', type: 'audio/mpeg', length: 9 },
      { url: 'https://j.org/i.png', type: 'image/*', length: 0 },
    ])
    expect(feed.items[1]).toMatchObject({ guid: '2', url: 'https://e.org/2', author: 'Solo', content: '<p>Text</p>' })
    expect(feed.items[2]).toMatchObject({ guid: 'https://j.org/3', author: 'Feed', content: '&lt;sum&gt;', publishedAt: null })
    expect(feed.items[3]).toMatchObject({ guid: '', content: '', enclosures: [] })
  })

  it('handles a minimal feed', () => {
    const feed = parseFeed('{"items":[{"id":"x"}]}', 'https://j.org/feed.json')
    expect(feed).toMatchObject({ title: '', siteUrl: '', iconUrl: '', description: '' })
    expect(feed.items[0].author).toBe('')
  })

  it('rejects invalid JSON and missing items', () => {
    expect(() => parseFeed('{nope', 'https://x')).toThrow('Invalid JSON feed')
    expect(() => parseFeed('{"title":"x"}', 'https://x')).toThrow('JSON feed has no items')
  })
})

describe('format detection', () => {
  it('detects feeds', () => {
    expect(looksLikeFeed(rssFeed)).toBe(true)
    expect(looksLikeFeed(atomFeed)).toBe(true)
    expect(looksLikeFeed(rdfFeed)).toBe(true)
    expect(looksLikeFeed('{"version":"https://jsonfeed.org/version/1","items":[]}')).toBe(true)
    expect(looksLikeFeed('{"items": []}')).toBe(true)
    expect(looksLikeFeed('{"data": []}')).toBe(false)
    expect(looksLikeFeed('<!doctype html><html></html>')).toBe(false)
  })

  it('rejects invalid XML and unknown roots', () => {
    expect(() => parseFeed('<rss><channel>', 'https://x')).toThrow(/Invalid XML/)
    expect(() => parseFeed('<html><body/></html>', 'https://x')).toThrow('Unsupported feed format: html')
  })

  it('strips only control characters', () => {
    expect(stripControlCharacters('a\tb\nc\r')).toBe('a\tb\nc\r')
    expect(stripControlCharacters('a\u0000b\u001fc')).toBe('abc')
  })
})

describe('discoverFeeds', () => {
  it('finds alternate links and removes duplicates', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" title="Main" href="/feed.xml">
      <link rel="alternate" type="application/atom+xml" href="https://site.org/atom">
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="alternate" type="text/html" href="/other">
      <link rel="stylesheet" href="/s.css">
    </head></html>`
    expect(discoverFeeds(html, 'https://site.org/blog')).toEqual([
      { url: 'https://site.org/feed.xml', title: 'Main' },
      { url: 'https://site.org/atom', title: 'https://site.org/atom' },
    ])
  })

  it('builds YouTube channel feeds', () => {
    expect(discoverFeeds('<html></html>', 'https://www.youtube.com/channel/UCabc')).toEqual([
      { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc', title: 'YouTube channel' },
    ])
    const handlePage = '<html><head><meta itemprop="identifier" content="UCxyz"></head></html>'
    expect(discoverFeeds(handlePage, 'https://www.youtube.com/@someone')[0].url).toContain('UCxyz')
    expect(discoverFeeds('<html></html>', 'https://www.youtube.com/@someone')).toEqual([])
  })
})
