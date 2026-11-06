import type { Enclosure } from '../types'
import { escapeHtml, fromBase64, hostname } from '../text'
import { compileRegex, goReplacement, splitQuotedArgs } from './regex'

export interface RewriteTarget {
  title: string
  content: string
  url: string
  commentsUrl: string
  guid: string
  enclosures: Enclosure[]
}

export interface RewriteOptions {
  invidiousInstance?: string
}

export const rewriteRuleNames = [
  'add_dynamic_image',
  'add_dynamic_iframe',
  'add_enclosure_links',
  'add_image_title',
  'add_youtube_video',
  'add_youtube_video_from_id',
  'add_invidious_video',
  'add_youtube_video_using_invidious_player',
  'add_castopod_episode',
  'add_mailto_subject',
  'base64_decode',
  'nl2br',
  'convert_text_links',
  'fix_medium_images',
  'use_noscript_figure_images',
  'replace',
  'remove',
  'parse_markdown',
  'remove_tables',
  'remove_clickbait',
  'replace_title',
  'add_hn_links_using_hack',
  'add_hn_links_using_opener',
  'fix_ghost_cards',
  'remove_img_blur_params',
]

interface ParsedRule {
  name: string
  args: string
}

export function parseRewriteRules(text: string): ParsedRule[] {
  const rules: ParsedRule[] = []
  let depth = 0
  let quoted = false
  let current = ''
  const flush = () => {
    const value = current.trim()
    current = ''
    if (!value) return
    const open = value.indexOf('(')
    if (open > 0 && value.endsWith(')')) rules.push({ name: value.slice(0, open).trim(), args: value.slice(open + 1, -1) })
    else rules.push({ name: value, args: '' })
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\\' && quoted) {
      current += char + (text[i + 1] ?? '')
      i++
      continue
    }
    if (char === '"') quoted = !quoted
    if (!quoted && char === '(') depth++
    if (!quoted && char === ')') depth--
    if (!quoted && depth === 0 && (char === ',' || char === '\n')) {
      flush()
      continue
    }
    current += char
  }
  flush()
  return rules
}

function youtubeId(target: RewriteTarget): string {
  const fromGuid = /^yt:video:([\w-]{11})$/.exec(target.guid)?.[1]
  if (fromGuid) return fromGuid
  try {
    const url = new URL(target.url)
    if (url.hostname.endsWith('youtu.be')) return url.pathname.slice(1, 12)
    if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] || ''
    return url.searchParams.get('v') || ''
  } catch {
    return ''
  }
}

function isYoutube(url: string): boolean {
  const host = hostname(url)
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be'
}

function iframe(src: string): string {
  return `<iframe width="650" height="350" src="${escapeHtml(src)}" frameborder="0" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`
}

function linkifyText(doc: Document) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.parentElement?.closest('a, code, pre, script, style')) continue
    if (/https?:\/\/\S/.test(node.data)) nodes.push(node)
  }
  for (const node of nodes) {
    const fragment = doc.createDocumentFragment()
    let last = 0
    const re = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g
    let match: RegExpExecArray | null
    while ((match = re.exec(node.data))) {
      fragment.appendChild(doc.createTextNode(node.data.slice(last, match.index)))
      const link = doc.createElement('a')
      link.href = match[0]
      link.textContent = match[0]
      fragment.appendChild(link)
      last = match.index + match[0].length
    }
    fragment.appendChild(doc.createTextNode(node.data.slice(last)))
    node.replaceWith(fragment)
  }
}

function nl2br(doc: Document) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.parentElement?.closest('pre, code, script, style')) continue
    if (node.data.includes('\n') && node.data.trim()) nodes.push(node)
  }
  for (const node of nodes) {
    const fragment = doc.createDocumentFragment()
    node.data.split('\n').forEach((part, index) => {
      if (index > 0) fragment.appendChild(doc.createElement('br'))
      fragment.appendChild(doc.createTextNode(part))
    })
    node.replaceWith(fragment)
  }
}

function applyNoscriptImages(doc: Document, selector: string) {
  doc.querySelectorAll(selector).forEach((container) => {
    const noscript = container.querySelector('noscript')
    if (!noscript) return
    const inner = new DOMParser().parseFromString(noscript.innerHTML || noscript.textContent || '', 'text/html')
    const img = inner.querySelector('img')
    if (!img) return
    container.querySelectorAll('img').forEach((existing) => existing.remove())
    noscript.replaceWith(doc.importNode(img, true))
  })
}

function decodeBase64Nodes(doc: Document, selector: string) {
  const roots = selector ? Array.from(doc.querySelectorAll(selector)) : [doc.body]
  for (const root of roots) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    for (const node of nodes) {
      const value = node.data.trim()
      if (!value || !/^[A-Za-z0-9+/=_\-\s]+$/.test(value)) continue
      try {
        const decoded = fromBase64(value)
        const fragment = new DOMParser().parseFromString(decoded, 'text/html').body
        node.replaceWith(...Array.from(fragment.childNodes).map((child) => doc.importNode(child, true)))
      } catch {
        continue
      }
    }
  }
}

function removeClickbait(title: string): string {
  const letters = title.replace(/[^\p{L}]/gu, '')
  if (!letters) return title
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length
  if (upper / letters.length < 0.5) return title.replace(/!+/g, '!').replace(/\?+/g, '?')
  const lower = title.toLocaleLowerCase()
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1)
}

async function applyRule(rule: ParsedRule, target: RewriteTarget, doc: Document, options: RewriteOptions): Promise<void> {
  const body = doc.body
  const prepend = (html: string) => body.insertAdjacentHTML('afterbegin', html)
  switch (rule.name) {
    case 'add_dynamic_image':
      body.querySelectorAll('img').forEach((img) => {
        for (const attr of ['data-src', 'data-original', 'data-orig', 'data-url', 'data-lazy-src', 'data-lazy', 'data-full-src', 'data-hi-res-src']) {
          const value = img.getAttribute(attr)
          if (value) {
            img.setAttribute('src', value)
            break
          }
        }
        for (const attr of ['data-srcset', 'data-lazy-srcset']) {
          const value = img.getAttribute(attr)
          if (value) {
            img.setAttribute('srcset', value)
            break
          }
        }
      })
      applyNoscriptImages(doc, 'picture, figure, div, span, p')
      break
    case 'add_dynamic_iframe':
      body.querySelectorAll('iframe').forEach((frame) => {
        for (const attr of ['data-src', 'data-original', 'data-orig', 'data-url', 'data-lazy-src']) {
          const value = frame.getAttribute(attr)
          if (value) {
            frame.setAttribute('src', value)
            break
          }
        }
      })
      break
    case 'add_enclosure_links':
      if (target.enclosures.length) {
        body.insertAdjacentHTML('beforeend', `<ul>${target.enclosures.map((e) => `<li><a href="${escapeHtml(e.url)}">${escapeHtml(e.url)}</a> (${escapeHtml(e.type)})</li>`).join('')}</ul>`)
      }
      break
    case 'add_image_title':
      body.querySelectorAll('img[title]').forEach((img) => {
        const title = img.getAttribute('title') || ''
        if (!title) return
        const figure = doc.createElement('figure')
        const caption = doc.createElement('figcaption')
        caption.textContent = title
        img.replaceWith(figure)
        figure.append(img, caption)
      })
      break
    case 'add_youtube_video':
    case 'add_youtube_video_from_id': {
      const id = youtubeId(target)
      if (id && !body.querySelector(`iframe[src*="${id}"]`)) prepend(iframe(`https://www.youtube-nocookie.com/embed/${id}`))
      break
    }
    case 'add_youtube_video_using_invidious_player': {
      const id = youtubeId(target)
      const instance = (options.invidiousInstance || 'yewtu.be').replace(/^https?:\/\//, '').replace(/\/$/, '')
      if (id) prepend(iframe(`https://${instance}/embed/${id}`))
      break
    }
    case 'add_invidious_video': {
      try {
        const url = new URL(target.url)
        const id = url.searchParams.get('v')
        if (id) prepend(iframe(`${url.origin}/embed/${id}`))
      } catch {
        break
      }
      break
    }
    case 'add_castopod_episode':
      if (target.url) prepend(iframe(`${target.url.replace(/\/$/, '')}/embed/light`))
      break
    case 'add_mailto_subject':
      body.querySelectorAll('a[href^="mailto:"]').forEach((link) => {
        try {
          const subject = new URL(link.getAttribute('href') || '').searchParams.get('subject')
          if (subject) link.textContent = `${link.textContent} [${subject}]`
        } catch {
          return
        }
      })
      break
    case 'base64_decode':
      decodeBase64Nodes(doc, splitQuotedArgs(rule.args)[0] || '')
      break
    case 'nl2br':
      nl2br(doc)
      break
    case 'convert_text_link':
    case 'convert_text_links':
      linkifyText(doc)
      break
    case 'fix_medium_images':
      applyNoscriptImages(doc, 'figure')
      body.querySelectorAll('img[data-src]').forEach((img) => img.setAttribute('src', img.getAttribute('data-src') || ''))
      break
    case 'use_noscript_figure_images':
      applyNoscriptImages(doc, 'figure')
      break
    case 'replace': {
      const [search, replacement] = splitQuotedArgs(rule.args)
      const regex = search !== undefined ? compileRegex(search, 'g') : null
      if (regex && replacement !== undefined) body.innerHTML = body.innerHTML.replace(regex, goReplacement(replacement))
      break
    }
    case 'remove': {
      const selector = splitQuotedArgs(rule.args)[0]
      if (!selector) break
      try {
        body.querySelectorAll(selector).forEach((el) => el.remove())
      } catch {
        break
      }
      break
    }
    case 'parse_markdown': {
      const { marked } = await import('marked')
      body.innerHTML = await marked.parse(body.textContent || '')
      break
    }
    case 'remove_tables':
      body.querySelectorAll('table').forEach((table) => {
        const fragment = doc.createDocumentFragment()
        table.querySelectorAll('td, th, caption').forEach((cell) => {
          const div = doc.createElement('div')
          div.append(...Array.from(cell.childNodes))
          fragment.appendChild(div)
        })
        table.replaceWith(fragment)
      })
      break
    case 'remove_clickbait':
      target.title = removeClickbait(target.title)
      break
    case 'replace_title': {
      const [search, replacement] = splitQuotedArgs(rule.args)
      const regex = search !== undefined ? compileRegex(search, 'g') : null
      if (regex && replacement !== undefined) target.title = target.title.replace(regex, goReplacement(replacement))
      break
    }
    case 'add_hn_links_using_hack':
    case 'add_hn_links_using_opener': {
      const source = [target.commentsUrl, target.url].find((value) => /news\.ycombinator\.com\/item\?id=\d+/.test(value))
      const id = source ? /id=(\d+)/.exec(source)?.[1] : null
      if (!id) break
      const href = rule.name === 'add_hn_links_using_hack'
        ? `hack://item?id=${id}`
        : `opener://x-callback-url/show-options?url=${encodeURIComponent(`https://news.ycombinator.com/item?id=${id}`)}`
      body.querySelectorAll(`a[href*="news.ycombinator.com/item?id=${id}"]`).forEach((link) => link.setAttribute('href', href))
      if (!body.querySelector(`a[href="${href}"]`)) body.insertAdjacentHTML('beforeend', `<p><a href="${escapeHtml(href)}">Open in app</a></p>`)
      break
    }
    case 'fix_ghost_cards':
      body.querySelectorAll('figure.kg-bookmark-card, figure.kg-card.kg-bookmark-card').forEach((card) => {
        const link = card.querySelector('a.kg-bookmark-container, a')
        if (!link) return
        const title = card.querySelector('.kg-bookmark-title')?.textContent?.trim() || link.getAttribute('href') || ''
        const anchor = doc.createElement('a')
        anchor.href = link.getAttribute('href') || ''
        anchor.textContent = title
        card.replaceWith(anchor)
      })
      break
    case 'remove_img_blur_params':
      body.querySelectorAll('img[src]').forEach((img) => {
        try {
          const url = new URL(img.getAttribute('src') || '')
          if (!url.searchParams.has('blur')) return
          url.searchParams.delete('blur')
          img.setAttribute('src', url.toString())
        } catch {
          return
        }
      })
      break
  }
}

export function defaultRewriteRules(url: string): string {
  if (isYoutube(url)) return 'add_youtube_video'
  const host = hostname(url)
  if (host.endsWith('medium.com')) return 'fix_medium_images'
  return ''
}

export async function applyRewriteRules(target: RewriteTarget, rules: string, options: RewriteOptions = {}): Promise<RewriteTarget> {
  const result = { ...target }
  const effective = [defaultRewriteRules(target.url), rules].filter(Boolean).join(',')
  const parsed = parseRewriteRules(effective)
  if (!parsed.length) return result
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${result.content}</body></html>`, 'text/html')
  for (const rule of parsed) await applyRule(rule, result, doc, options)
  result.content = doc.body.innerHTML
  return result
}
