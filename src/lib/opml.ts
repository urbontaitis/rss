import { escapeHtml } from './text'
import type { Category, Feed } from './types'

export interface OpmlFeed {
  title: string
  feedUrl: string
  siteUrl: string
  category: string
}

export function parseOpml(xml: string): OpmlFeed[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror')[0]) throw new Error('Invalid OPML file')
  const body = doc.getElementsByTagName('body')[0]
  if (!body) throw new Error('OPML file has no body')
  const feeds: OpmlFeed[] = []
  const walk = (node: Element, category: string) => {
    for (const child of Array.from(node.children)) {
      if (child.localName !== 'outline') continue
      const xmlUrl = child.getAttribute('xmlUrl') || child.getAttribute('xmlurl')
      const label = (child.getAttribute('title') || child.getAttribute('text') || '').trim()
      if (xmlUrl) {
        feeds.push({ title: label, feedUrl: xmlUrl.trim(), siteUrl: (child.getAttribute('htmlUrl') || '').trim(), category: category || child.getAttribute('category')?.split(',')[0]?.replace(/^\//, '') || '' })
      } else {
        walk(child, label || category)
      }
    }
  }
  walk(body, '')
  return feeds
}

function attr(value: string): string {
  return escapeHtml(value)
}

export function buildOpml(feeds: Feed[], categories: Category[]): string {
  const byCategory = new Map<number | null, Feed[]>()
  for (const feed of feeds) {
    const list = byCategory.get(feed.category_id) || []
    list.push(feed)
    byCategory.set(feed.category_id, list)
  }
  const line = (feed: Feed, indent: string) =>
    `${indent}<outline title="${attr(feed.title)}" text="${attr(feed.title)}" xmlUrl="${attr(feed.feed_url)}" htmlUrl="${attr(feed.site_url)}" type="rss"></outline>`
  const parts: string[] = []
  for (const category of [...categories].sort((a, b) => a.title.localeCompare(b.title))) {
    const list = byCategory.get(category.id)
    if (!list?.length) continue
    parts.push(`        <outline text="${attr(category.title)}">`)
    list.forEach((feed) => parts.push(line(feed, '            ')))
    parts.push('        </outline>')
  }
  ;(byCategory.get(null) || []).forEach((feed) => parts.push(line(feed, '        ')))
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
    <head>
        <title>RSS</title>
        <dateCreated>${new Date().toUTCString()}</dateCreated>
    </head>
    <body>
${parts.join('\n')}
    </body>
</opml>
`
}
