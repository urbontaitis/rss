import DOMPurify from 'dompurify'
import type { LocalSettings } from './settings'
import { proxifyContent } from './mediaProxy'

export const iframeHosts = [
  'www.youtube-nocookie.com',
  'www.youtube.com',
  'youtube.com',
  'player.vimeo.com',
  'www.dailymotion.com',
  'player.twitch.tv',
  'bandcamp.com',
  'w.soundcloud.com',
  'open.spotify.com',
  'embed.podcasts.apple.com',
]

export interface SanitizeOptions {
  invidiousInstance?: string
  entryUrl?: string
}

let configured = false
let extraHosts: string[] = []

function hostOf(value: string): string {
  try {
    return new URL(/^https?:\/\//.test(value) ? value : `https://${value}`).hostname
  } catch {
    return ''
  }
}

export function isAllowedIframe(src: string, extra: string[] = []): boolean {
  try {
    const url = new URL(src)
    if (url.protocol !== 'https:') return false
    return iframeHosts.includes(url.hostname) || url.hostname.endsWith('.bandcamp.com') || extra.includes(url.hostname)
  } catch {
    return false
  }
}

function configure() {
  if (configured) return
  configured = true
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'iframe') return
    const el = node as Element
    if (!isAllowedIframe(el.getAttribute('src') || '', extraHosts)) el.remove()
  })
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
    if (el.tagName === 'IMG') {
      el.setAttribute('loading', 'lazy')
      el.setAttribute('decoding', 'async')
      el.setAttribute('referrerpolicy', 'no-referrer')
      el.removeAttribute('width')
      el.removeAttribute('height')
    }
    if (el.tagName === 'IFRAME') {
      el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation')
      el.setAttribute('loading', 'lazy')
      el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    }
  })
}

export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  configure()
  extraHosts = [options.invidiousInstance, options.entryUrl].map((value) => (value ? hostOf(value) : '')).filter(Boolean)
  try {
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['iframe'],
      ADD_ATTR: ['allowfullscreen', 'frameborder', 'loading', 'referrerpolicy', 'target'],
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'script', 'object', 'embed', 'link', 'meta', 'base'],
      FORBID_ATTR: ['style', 'class', 'id'],
    })
  } finally {
    extraHosts = []
  }
}

export function renderContent(html: string, settings: LocalSettings, entryUrl = ''): string {
  const clean = sanitizeHtml(html, { invidiousInstance: settings.invidiousInstance, entryUrl })
  if (!settings.imageProxyTemplate || settings.imageProxyMode === 'none') return clean
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')
  proxifyContent(doc.body, settings)
  return doc.body.innerHTML
}
