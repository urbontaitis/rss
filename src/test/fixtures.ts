import type { Category, Entry, EntryListItem, Feed, ServerSettings } from '../lib/types'

export function makeFeed(patch: Partial<Feed> = {}): Feed {
  return {
    id: 1,
    category_id: null,
    title: 'Example',
    feed_url: 'https://example.org/feed',
    site_url: 'https://example.org/',
    icon_url: '',
    description: '',
    disabled: false,
    hide_globally: false,
    crawler: false,
    ignore_http_cache: false,
    no_media_player: false,
    server_fetch: true,
    user_agent: '',
    cookie: '',
    username: '',
    password: '',
    scraper_rules: '',
    rewrite_rules: '',
    url_rewrite_rules: '',
    block_filter_entry_rules: '',
    keep_filter_entry_rules: '',
    etag: '',
    last_modified: '',
    checked_at: null,
    parsing_error_count: 0,
    parsing_error_msg: '',
    created_at: '2026-11-01T00:00:00Z',
    ...patch,
  }
}

export function makeEntry(patch: Partial<Entry> = {}): Entry {
  return {
    id: 10,
    feed_id: 1,
    hash: 'h',
    title: 'Entry title',
    url: 'https://example.org/post',
    comments_url: '',
    author: 'Jane',
    content: '<p>Hello <img src="https://img.example/a.jpg"></p>',
    tags: [],
    enclosures: [],
    reading_time: 2,
    status: 'unread',
    starred: false,
    published_at: '2026-11-05T10:00:00Z',
    created_at: '2026-11-05T10:00:00Z',
    changed_at: '2026-11-05T10:00:00Z',
    ...patch,
  }
}

export function makeListItem(patch: Partial<EntryListItem> = {}): EntryListItem {
  return {
    id: 10,
    feed_id: 1,
    title: 'Entry title',
    url: 'https://example.org/post',
    comments_url: '',
    author: 'Jane',
    tags: [],
    reading_time: 2,
    status: 'unread',
    starred: false,
    published_at: '2026-11-05T10:00:00Z',
    created_at: '2026-11-05T10:00:00Z',
    changed_at: '2026-11-05T10:00:00Z',
    feed_title: 'Example',
    feed_site_url: 'https://example.org/',
    feed_icon_url: '',
    category_id: null,
    category_title: null,
    hidden: false,
    ...patch,
  }
}

export function makeCategory(patch: Partial<Category> = {}): Category {
  return { id: 1, title: 'Dev', hide_globally: false, created_at: '2026-11-01T00:00:00Z', ...patch }
}

export function makeServerSettings(patch: Partial<ServerSettings> = {}): ServerSettings {
  return {
    id: 1,
    block_filter_entry_rules: '',
    keep_filter_entry_rules: '',
    retention_days: 60,
    server_fetch_enabled: false,
    updated_at: '2026-11-01T00:00:00Z',
    ...patch,
  }
}

export const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Example &amp; Co</title>
  <link>https://example.org/</link>
  <atom:link href="https://example.org/feed" rel="self" />
  <description>About &lt;b&gt;things&lt;/b&gt;</description>
  <image><url>/logo.png</url></image>
  <itunes:author>Channel Author</itunes:author>
  <item>
    <title>First</title>
    <link>/posts/1</link>
    <guid isPermaLink="false">id-1</guid>
    <pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
    <dc:creator>Jane</dc:creator>
    <category>News</category>
    <dc:subject>Extra</dc:subject>
    <description>Short</description>
    <content:encoded><![CDATA[<p>Full <b>content</b></p>]]></content:encoded>
    <enclosure url="https://example.org/a.mp3" type="audio/mpeg" length="123" />
    <media:content url="https://example.org/v.mp4" medium="video" fileSize="5" />
    <media:content url="https://example.org/p.jpg" medium="image" />
    <media:content url="https://example.org/x.bin" />
    <comments>https://example.org/posts/1#comments</comments>
  </item>
  <item>
    <title><![CDATA[Second &amp; <em>bold</em>]]></title>
    <guid>https://example.org/posts/2</guid>
    <pubDate>not a date</pubDate>
    <media:description>Plain text
with newline</media:description>
    <media:thumbnail url="https://example.org/t.jpg" />
  </item>
</channel>
</rss>`

export const atomFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title type="html">Atom &amp;amp; Feed</title>
  <subtitle>Sub</subtitle>
  <id>urn:feed</id>
  <link href="https://atom.example/feed" rel="self"/>
  <link href="https://atom.example/"/>
  <icon>/icon.png</icon>
  <author><name>Feed Author</name></author>
  <entry>
    <id>urn:1</id>
    <title>HTML entry</title>
    <link rel="alternate" type="text/html" href="/one"/>
    <link rel="replies" type="text/html" href="/one#comments"/>
    <link rel="replies" type="application/atom+xml" href="/one/comments.xml"/>
    <link rel="enclosure" type="audio/mpeg" length="10" href="/one.mp3"/>
    <updated>2026-11-02T08:00:00Z</updated>
    <category term="t1" label="Label one"/>
    <category term="t2"/>
    <content type="html">&lt;p&gt;Escaped &lt;i&gt;html&lt;/i&gt;&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>urn:2</id>
    <title>XHTML entry</title>
    <link href="https://atom.example/two"/>
    <author><name>A</name></author>
    <author><name>B</name></author>
    <published>2026-11-03T08:00:00Z</published>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Inline <b>xhtml</b></p></div></content>
  </entry>
  <entry>
    <id>urn:3</id>
    <title>Text entry</title>
    <summary>Line &lt;one&gt;</summary>
  </entry>
  <entry>
    <id>urn:4</id>
    <title>Bare xhtml</title>
    <content type="xhtml">plain</content>
  </entry>
</feed>`

export const youtubeFeed = `<?xml version="1.0" encoding="UTF-8"?>
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
   <media:content url="https://www.youtube.com/v/dQw4w9WgXcQ" type="application/x-shockwave-flash"/>
   <media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" width="480" height="360"/>
   <media:description>Line one
https://example.org/link</media:description>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:other</id>
  <link rel="alternate" href="https://www.youtube.com/watch?v=other"/>
  <media:group>
   <media:title>Group title</media:title>
   <media:description type="html">&lt;b&gt;html&lt;/b&gt;</media:description>
  </media:group>
 </entry>
</feed>`

export const rdfFeed = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://rdf.example/"><title>RDF</title><link>https://rdf.example/</link><description>D</description></channel>
  <image rdf:about="https://rdf.example/i.png"><url>https://rdf.example/i.png</url></image>
  <item rdf:about="https://rdf.example/1"><title>One</title><dc:date>2026-01-02T00:00:00Z</dc:date></item>
</rdf:RDF>`
