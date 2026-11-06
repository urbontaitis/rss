import type { Enclosure, ParsedFeed, ParsedItem } from './types'
import { absoluteUrl, escapeHtml, stripTags, textToHtml } from './text'

const NS = {
  atom: 'http://www.w3.org/2005/Atom',
  rss1: 'http://purl.org/rss/1.0/',
  content: 'http://purl.org/rss/1.0/modules/content/',
  dc: 'http://purl.org/dc/elements/1.1/',
  media: 'http://search.yahoo.com/mrss/',
  itunes: 'http://www.itunes.com/dtds/podcast-1.0.dtd',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
} as const

type Prefix = keyof typeof NS

export class FeedParseError extends Error {}

function makeQuery(home: string | null) {
  const matches = (el: Element, name: string) => {
    const [prefix, local] = name.includes(':') ? name.split(':') : [null, name]
    if (el.localName !== local) return false
    if (prefix) return el.namespaceURI === NS[prefix as Prefix]
    return (el.namespaceURI || null) === home
  }
  const all = (el: Element | null, name: string): Element[] => (el ? Array.from(el.children).filter((child) => matches(child, name)) : [])
  const one = (el: Element | null, ...names: string[]): Element | null => {
    for (const name of names) {
      const found = all(el, name)[0]
      if (found) return found
    }
    return null
  }
  const text = (el: Element | null, ...names: string[]): string => {
    for (const name of names) {
      const value = one(el, name)?.textContent?.trim()
      if (value) return value
    }
    return ''
  }
  return { all, one, text }
}

function parseDate(value: string): Date | null {
  if (!value) return null
  const cleaned = value.trim().replace(/\s+/g, ' ')
  let time = Date.parse(cleaned)
  if (Number.isNaN(time)) time = Date.parse(cleaned.replace(/^[A-Za-z]+,?\s*/, '').replace(/\s([A-Z]{2,4})$/, ' GMT'))
  if (Number.isNaN(time)) time = Date.parse(cleaned.replace(' ', 'T'))
  return Number.isNaN(time) ? null : new Date(time)
}

function cleanTitle(value: string): string {
  return /<[a-z][\s\S]*>|&[a-z#0-9]+;/i.test(value) ? stripTags(value) : value.replace(/\s+/g, ' ').trim()
}

function pushEnclosure(list: Enclosure[], url: string, type: string, length: string | null, base: string) {
  if (!url) return
  const absolute = absoluteUrl(url, base)
  if (list.some((item) => item.url === absolute)) return
  list.push({ url: absolute, type: type || guessMime(absolute), length: Number(length) || 0 })
}

function guessMime(url: string): string {
  const ext = /\.([a-z0-9]+)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase() || ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/opus', mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf',
  }
  return map[ext] || ''
}

function mediaEnclosures(q: ReturnType<typeof makeQuery>, item: Element, list: Enclosure[], base: string) {
  const groups = [item, ...q.all(item, 'media:group')]
  for (const group of groups) {
    for (const media of q.all(group, 'media:content')) {
      const medium = media.getAttribute('medium') || ''
      const type = media.getAttribute('type') || (medium === 'image' ? 'image/*' : medium ? `${medium}/*` : '')
      pushEnclosure(list, media.getAttribute('url') || '', type, media.getAttribute('fileSize'), base)
    }
    for (const thumb of q.all(group, 'media:thumbnail')) {
      pushEnclosure(list, thumb.getAttribute('url') || '', 'image/*', null, base)
    }
  }
}

function mediaDescription(q: ReturnType<typeof makeQuery>, item: Element): string {
  const description = q.one(item, 'media:description') || q.one(q.one(item, 'media:group'), 'media:description')
  if (!description?.textContent?.trim()) return ''
  const value = description.textContent.trim()
  return description.getAttribute('type') === 'html' ? value : textToHtml(value)
}

function atomText(el: Element | null): string {
  if (!el) return ''
  const type = el.getAttribute('type') || 'text'
  if (type === 'xhtml') {
    const div = Array.from(el.children).find((child) => child.localName === 'div')
    const serializer = new XMLSerializer()
    const source = div ? Array.from(div.childNodes) : Array.from(el.childNodes)
    return source.map((node) => serializer.serializeToString(node)).join('').replace(/ xmlns="[^"]*"/g, '')
  }
  const value = el.textContent?.trim() || ''
  if (type === 'text' || type === 'text/plain') return textToHtml(value)
  return value
}

function atomLink(q: ReturnType<typeof makeQuery>, el: Element, rel: string, type?: string): string {
  for (const link of q.all(el, 'link')) {
    const linkRel = link.getAttribute('rel') || 'alternate'
    if (linkRel !== rel) continue
    if (type && link.getAttribute('type') && !link.getAttribute('type')!.includes(type)) continue
    return link.getAttribute('href') || ''
  }
  return ''
}

function parseAtom(root: Element, feedUrl: string): ParsedFeed {
  const q = makeQuery(NS.atom)
  const siteUrl = absoluteUrl(atomLink(q, root, 'alternate') || q.text(root, 'id'), feedUrl)
  const base = siteUrl || feedUrl
  const feedAuthor = q.text(q.one(root, 'author'), 'name')
  const items: ParsedItem[] = q.all(root, 'entry').map((entry) => {
    const enclosures: Enclosure[] = []
    for (const link of q.all(entry, 'link')) {
      if (link.getAttribute('rel') === 'enclosure') pushEnclosure(enclosures, link.getAttribute('href') || '', link.getAttribute('type') || '', link.getAttribute('length'), base)
    }
    mediaEnclosures(q, entry, enclosures, base)
    const content = atomText(q.one(entry, 'content')) || atomText(q.one(entry, 'summary')) || mediaDescription(q, entry)
    const url = absoluteUrl(atomLink(q, entry, 'alternate'), base)
    const title = cleanTitle(q.text(entry, 'title') || q.text(q.one(entry, 'media:group'), 'media:title'))
    return {
      guid: q.text(entry, 'id') || url,
      title,
      url,
      commentsUrl: absoluteUrl(atomLink(q, entry, 'replies', 'html'), base),
      author: q.all(entry, 'author').map((author) => q.text(author, 'name')).filter(Boolean).join(', ') || feedAuthor,
      content,
      tags: q.all(entry, 'category').map((cat) => cat.getAttribute('label') || cat.getAttribute('term') || '').filter(Boolean),
      enclosures,
      publishedAt: parseDate(q.text(entry, 'published', 'updated', 'dc:date')),
    }
  })
  return {
    title: cleanTitle(q.text(root, 'title')),
    siteUrl,
    iconUrl: absoluteUrl(q.text(root, 'icon', 'logo'), base),
    description: stripTags(q.text(root, 'subtitle')),
    items,
  }
}

function parseRss(root: Element, feedUrl: string, home: string | null): ParsedFeed {
  const q = makeQuery(home)
  const channel = q.one(root, 'channel')
  if (!channel) throw new FeedParseError('Missing channel element')
  const itemParent = home === NS.rss1 ? root : channel
  const siteUrl = absoluteUrl(q.text(channel, 'link'), feedUrl)
  const base = siteUrl || feedUrl
  const image = q.one(channel, 'image') || q.one(root, 'image')
  const feedAuthor = q.text(channel, 'itunes:author', 'dc:creator')
  const items: ParsedItem[] = q.all(itemParent, 'item').map((item) => {
    const enclosures: Enclosure[] = []
    for (const enclosure of q.all(item, 'enclosure')) {
      pushEnclosure(enclosures, enclosure.getAttribute('url') || '', enclosure.getAttribute('type') || '', enclosure.getAttribute('length'), base)
    }
    mediaEnclosures(q, item, enclosures, base)
    const url = absoluteUrl(q.text(item, 'link') || item.getAttributeNS(NS.rdf, 'about') || '', base)
    const guid = q.text(item, 'guid')
    const guidIsLink = q.one(item, 'guid')?.getAttribute('isPermaLink') !== 'false' && /^https?:\/\//.test(guid)
    const content = q.text(item, 'content:encoded') || q.text(item, 'description') || mediaDescription(q, item)
    return {
      guid: guid || url,
      title: cleanTitle(q.text(item, 'title', 'media:title')),
      url: url || (guidIsLink ? guid : ''),
      commentsUrl: absoluteUrl(q.text(item, 'comments'), base),
      author: q.text(item, 'author', 'dc:creator', 'itunes:author') || feedAuthor,
      content,
      tags: [...q.all(item, 'category'), ...q.all(item, 'dc:subject')].map((cat) => cat.textContent?.trim() || '').filter(Boolean),
      enclosures,
      publishedAt: parseDate(q.text(item, 'pubDate', 'dc:date')),
    }
  })
  return {
    title: cleanTitle(q.text(channel, 'title')),
    siteUrl,
    iconUrl: absoluteUrl(q.text(image, 'url') || q.one(channel, 'itunes:image')?.getAttribute('href') || '', base),
    description: stripTags(q.text(channel, 'description')),
    items,
  }
}

interface JsonFeedItem {
  id?: string | number
  url?: string
  external_url?: string
  title?: string
  content_html?: string
  content_text?: string
  summary?: string
  image?: string
  date_published?: string
  date_modified?: string
  author?: { name?: string }
  authors?: { name?: string }[]
  tags?: string[]
  attachments?: { url?: string; mime_type?: string; size_in_bytes?: number }[]
}

function parseJson(body: string, feedUrl: string): ParsedFeed {
  let data: { title?: string; home_page_url?: string; icon?: string; favicon?: string; description?: string; items?: JsonFeedItem[]; author?: { name?: string }; authors?: { name?: string }[] }
  try {
    data = JSON.parse(body)
  } catch {
    throw new FeedParseError('Invalid JSON feed')
  }
  if (!Array.isArray(data.items)) throw new FeedParseError('JSON feed has no items')
  const base = data.home_page_url || feedUrl
  const authorName = (value?: { name?: string }[], single?: { name?: string }) => (value || (single ? [single] : [])).map((a) => a.name || '').filter(Boolean).join(', ')
  const feedAuthor = authorName(data.authors, data.author)
  return {
    title: cleanTitle(data.title || ''),
    siteUrl: absoluteUrl(data.home_page_url || '', feedUrl),
    iconUrl: absoluteUrl(data.favicon || data.icon || '', base),
    description: data.description || '',
    items: data.items.map((item) => {
      const enclosures: Enclosure[] = []
      for (const attachment of item.attachments || []) pushEnclosure(enclosures, attachment.url || '', attachment.mime_type || '', String(attachment.size_in_bytes || 0), base)
      if (item.image) pushEnclosure(enclosures, item.image, 'image/*', null, base)
      const url = absoluteUrl(item.url || item.external_url || '', base)
      return {
        guid: String(item.id ?? url),
        title: cleanTitle(item.title || ''),
        url,
        commentsUrl: '',
        author: authorName(item.authors, item.author) || feedAuthor,
        content: item.content_html || (item.content_text ? textToHtml(item.content_text) : item.summary ? escapeHtml(item.summary) : ''),
        tags: item.tags || [],
        enclosures,
        publishedAt: parseDate(item.date_published || item.date_modified || ''),
      }
    }),
  }
}

export function looksLikeFeed(body: string): boolean {
  const head = body.trimStart().slice(0, 2048)
  if (head.startsWith('{')) return /"version"\s*:\s*"https:\/\/jsonfeed\.org/.test(body.slice(0, 4096)) || /"items"\s*:/.test(body)
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(head)
}

export function parseFeed(body: string, feedUrl: string): ParsedFeed {
  const source = body.replace(/^﻿/, '').trimStart()
  if (source.startsWith('{')) return parseJson(source, feedUrl)
  const sanitized = source.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  const doc = new DOMParser().parseFromString(sanitized, 'application/xml')
  const error = doc.getElementsByTagName('parsererror')[0]
  if (error) throw new FeedParseError(`Invalid XML: ${(error.textContent || '').trim().slice(0, 200)}`)
  const root = doc.documentElement
  if (root.localName === 'feed') return parseAtom(root, feedUrl)
  if (root.localName === 'rss') return parseRss(root, feedUrl, null)
  if (root.localName === 'RDF') return parseRss(root, feedUrl, NS.rss1)
  throw new FeedParseError(`Unsupported feed format: ${root.localName}`)
}

export function discoverFeeds(html: string, pageUrl: string): { url: string; title: string }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const types = ['application/rss+xml', 'application/atom+xml', 'application/feed+json', 'application/json', 'application/rdf+xml']
  const found: { url: string; title: string }[] = []
  doc.querySelectorAll('link[rel~="alternate"][href]').forEach((link) => {
    const type = (link.getAttribute('type') || '').toLowerCase()
    if (!types.includes(type)) return
    const url = absoluteUrl(link.getAttribute('href') || '', pageUrl)
    if (!found.some((item) => item.url === url)) found.push({ url, title: link.getAttribute('title') || url })
  })
  const youtube = /youtube\.com\/(?:channel\/(UC[\w-]+)|@[\w.-]+)/.exec(pageUrl)
  if (youtube && !found.length) {
    const channelId = youtube[1] || doc.querySelector('meta[itemprop="identifier"], meta[itemprop="channelId"]')?.getAttribute('content')
    if (channelId) found.push({ url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, title: 'YouTube channel' })
  }
  return found
}
