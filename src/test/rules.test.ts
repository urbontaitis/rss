import { describe, expect, it } from 'vitest'
import { parseDuration, shouldKeep, validateFilterRules } from '../lib/rules/filter'
import { applyRewriteRules, parseRewriteRules } from '../lib/rules/rewrite'
import { extractContent } from '../lib/rules/scraper'
import { rewriteUrl } from '../lib/rules/urlRewrite'
import type { ParsedItem } from '../lib/types'

const item = (patch: Partial<ParsedItem> = {}): ParsedItem => ({
  guid: '1',
  title: 'Weekly Sponsored post',
  url: 'https://example.org/a',
  commentsUrl: '',
  author: 'Bob',
  content: '<p>Hello world</p>',
  tags: ['News', 'Ads'],
  enclosures: [],
  publishedAt: new Date('2026-11-01T00:00:00Z'),
  ...patch,
})

const none = { globalBlock: '', feedBlock: '', globalKeep: '', feedKeep: '' }

describe('filter rules', () => {
  it('blocks by field', () => {
    expect(shouldKeep(item(), { ...none, feedBlock: 'EntryTitle=(?i)sponsored' })).toBe(false)
    expect(shouldKeep(item(), { ...none, feedBlock: 'EntryTag=^Ads$' })).toBe(false)
    expect(shouldKeep(item(), { ...none, globalBlock: 'EntryAuthor=Alice' })).toBe(true)
    expect(shouldKeep(item(), { ...none, feedBlock: 'EntryContent=world' })).toBe(false)
  })

  it('keeps only matching entries', () => {
    expect(shouldKeep(item(), { ...none, feedKeep: 'EntryURL=example\\.org' })).toBe(true)
    expect(shouldKeep(item(), { ...none, feedKeep: 'EntryURL=other\\.org' })).toBe(false)
  })

  it('supports date rules', () => {
    const now = Date.parse('2026-11-06T00:00:00Z')
    expect(shouldKeep(item(), { ...none, feedBlock: 'EntryDate=max-age:2d' }, now)).toBe(false)
    expect(shouldKeep(item(), { ...none, feedBlock: 'EntryDate=max-age:7d' }, now)).toBe(true)
    expect(shouldKeep(item(), { ...none, feedBlock: 'EntryDate=before:2026-11-02' }, now)).toBe(false)
    expect(shouldKeep(item(), { ...none, feedBlock: 'EntryDate=between:2026-10-01,2026-10-31' }, now)).toBe(true)
    expect(shouldKeep(item({ publishedAt: new Date('2027-01-01') }), { ...none, feedBlock: 'EntryDate=future' }, now)).toBe(false)
    expect(parseDuration('1h30m')).toBe(5400000)
  })

  it('supports legacy regex lines and reports invalid rules', () => {
    expect(shouldKeep(item(), { ...none, feedBlock: 'Sponsored' })).toBe(false)
    expect(validateFilterRules('EntryTitle=(\nEntryDate=sometime\nEntryTitle=ok')).toEqual(['EntryTitle=(', 'EntryDate=sometime'])
  })
})

describe('rewrite rules', () => {
  const target = { title: 'BREAKING NEWS TODAY', content: '<p>Hello\nworld https://a.org/x <img src="https://i.org/a.jpg" title="Cap"></p><div class="ad">ad</div><table><tr><td>cell</td></tr></table>', url: 'https://example.org/p', commentsUrl: '', guid: 'g', enclosures: [] }

  it('parses rule lists with arguments', () => {
    expect(parseRewriteRules('nl2br,replace("a,b"|"c"),remove(".x, .y")').map((rule) => rule.name)).toEqual(['nl2br', 'replace', 'remove'])
  })

  it('applies content rules', () => {
    const result = applyRewriteRules(target, 'nl2br,convert_text_links,add_image_title,remove(".ad"),remove_tables,replace("Hello"|"Hi"),remove_clickbait')
    expect(result.content).toContain('Hi<br>world')
    expect(result.content).toContain('<a href="https://a.org/x">')
    expect(result.content).toContain('<figcaption>Cap</figcaption>')
    expect(result.content).not.toContain('class="ad"')
    expect(result.content).not.toContain('<table')
    expect(result.title).toBe('Breaking news today')
  })

  it('embeds youtube automatically', () => {
    const result = applyRewriteRules({ ...target, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', content: '<p>x</p>' }, '')
    expect(result.content).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('replaces titles and decodes base64', () => {
    const encoded = btoa('<b>secret</b>')
    const result = applyRewriteRules({ ...target, title: '[Ad] Title', content: `<div class="b">${encoded}</div>` }, 'replace_title("^\\[Ad\\] "|""),base64_decode(".b")')
    expect(result.title).toBe('Title')
    expect(result.content).toContain('<b>secret</b>')
  })
})

describe('url rewrite and scraper', () => {
  it('rewrites urls', () => {
    expect(rewriteUrl('https://www.npr.org/2026/01/02/12345/story', 'rewrite("^https:\\/\\/www\\.npr\\.org\\/\\d{4}\\/\\d{2}\\/\\d{2}\\/(\\d+)\\/.*$"|"https://text.npr.org/$1")')).toBe('https://text.npr.org/12345')
    expect(rewriteUrl('https://x.org/a.html', 'rewrite("(.*?\\.html)"|"$1?seite=all")')).toBe('https://x.org/a.html?seite=all')
  })

  it('extracts content with selectors', () => {
    const html = '<html><body><nav>menu</nav><div id="article"><p>Body <img src="/i.png"></p></div></body></html>'
    const content = extractContent(html, 'https://site.org/post', 'div#article')
    expect(content).toContain('Body')
    expect(content).toContain('https://site.org/i.png')
    expect(content).not.toContain('menu')
  })
})
