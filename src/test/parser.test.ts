import { describe, expect, it } from 'vitest'
import { discoverFeeds, looksLikeFeed, parseFeed } from '../lib/parser'

const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Example &amp; Co</title>
  <link>https://example.org/</link>
  <atom:link href="https://example.org/feed" rel="self" />
  <description>Desc</description>
  <item>
    <title>First</title>
    <link>/posts/1</link>
    <guid isPermaLink="false">id-1</guid>
    <pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
    <dc:creator>Jane</dc:creator>
    <category>News</category>
    <description>Short</description>
    <content:encoded><![CDATA[<p>Full <b>content</b></p>]]></content:encoded>
    <enclosure url="https://example.org/a.mp3" type="audio/mpeg" length="123" />
    <comments>https://example.org/posts/1#comments</comments>
  </item>
</channel>
</rss>`

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <id>yt:channel:abc</id>
 <title>Channel</title>
 <link rel="alternate" href="https://www.youtube.com/channel/abc"/>
 <entry>
  <id>yt:video:dQw4w9WgXcQ</id>
  <title>Video</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
  <author><name>Someone</name></author>
  <published>2026-11-01T12:00:00+00:00</published>
  <media:group>
   <media:title>Video</media:title>
   <media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" width="480" height="360"/>
   <media:description>Line one
https://example.org/link</media:description>
  </media:group>
 </entry>
</feed>`

describe('parseFeed', () => {
  it('parses RSS 2.0', () => {
    const feed = parseFeed(rss, 'https://example.org/feed')
    expect(feed.title).toBe('Example & Co')
    expect(feed.siteUrl).toBe('https://example.org/')
    const [item] = feed.items
    expect(item.url).toBe('https://example.org/posts/1')
    expect(item.guid).toBe('id-1')
    expect(item.author).toBe('Jane')
    expect(item.content).toContain('<b>content</b>')
    expect(item.tags).toEqual(['News'])
    expect(item.enclosures[0]).toEqual({ url: 'https://example.org/a.mp3', type: 'audio/mpeg', length: 123 })
    expect(item.commentsUrl).toBe('https://example.org/posts/1#comments')
    expect(item.publishedAt?.toISOString()).toBe('2026-11-03T10:00:00.000Z')
  })

  it('parses YouTube Atom feeds', () => {
    const feed = parseFeed(atom, 'https://www.youtube.com/feeds/videos.xml?channel_id=abc')
    const [item] = feed.items
    expect(feed.siteUrl).toBe('https://www.youtube.com/channel/abc')
    expect(item.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(item.author).toBe('Someone')
    expect(item.content).toContain('<br>')
    expect(item.content).toContain('<a href="https://example.org/link">')
    expect(item.enclosures[0].url).toContain('hqdefault.jpg')
  })

  it('parses RSS 1.0', () => {
    const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel rdf:about="https://e.org/"><title>R</title><link>https://e.org/</link></channel>
      <item rdf:about="https://e.org/1"><title>One</title><link>https://e.org/1</link><dc:date>2026-01-02T00:00:00Z</dc:date></item></rdf:RDF>`
    const feed = parseFeed(rdf, 'https://e.org/rss')
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0].publishedAt?.getUTCFullYear()).toBe(2026)
  })

  it('parses JSON Feed', () => {
    const json = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'J', items: [{ id: '1', url: 'https://j.org/1', title: 'T', content_text: 'Hi' }] })
    expect(looksLikeFeed(json)).toBe(true)
    const feed = parseFeed(json, 'https://j.org/feed.json')
    expect(feed.items[0].content).toBe('<p>Hi</p>')
  })

  it('detects feeds and discovers links', () => {
    expect(looksLikeFeed(rss)).toBe(true)
    expect(looksLikeFeed('<html><body></body></html>')).toBe(false)
    const html = '<html><head><link rel="alternate" type="application/rss+xml" title="Main" href="/feed.xml"></head></html>'
    expect(discoverFeeds(html, 'https://site.org/blog')).toEqual([{ url: 'https://site.org/feed.xml', title: 'Main' }])
  })

  it('rejects invalid XML', () => {
    expect(() => parseFeed('<rss><channel>', 'https://x')).toThrow()
  })
})
