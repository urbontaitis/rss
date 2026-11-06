import DOMPurify from 'dompurify'
import type { LocalSettings } from './settings'
import { proxifyContent } from './mediaProxy'

const iframeHosts = [
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

let configured = false
let extraIframeHost = ''

function configure() {
  if (configured) return
  configured = true
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'iframe') return
    const el = node as Element
    try {
      const url = new URL(el.getAttribute('src') || '')
      const allowed = url.protocol === 'https:' && (iframeHosts.includes(url.hostname) || url.hostname.endsWith('.bandcamp.com') || (extraIframeHost && url.hostname === extraIframeHost) || url.pathname.includes('/embed'))
      if (!allowed) el.remove()
    } catch {
      el.remove()
    }
  })
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
    if (el.tagName === 'IMG') {
      el.setAttribute('loading', 'lazy')
      el.setAttribute('referrerpolicy', 'no-referrer')
      el.removeAttribute('width')
      el.removeAttribute('height')
    }
    if (el.tagName === 'IFRAME') {
      el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation')
      el.setAttribute('loading', 'lazy')
    }
  })
}

export function sanitizeHtml(html: string, invidiousInstance = ''): string {
  configure()
  extraIframeHost = invidiousInstance.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allowfullscreen', 'frameborder', 'loading', 'referrerpolicy', 'target'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'script', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style', 'class', 'id'],
  })
}

export function renderContent(html: string, settings: LocalSettings): string {
  const clean = sanitizeHtml(html, settings.invidiousInstance)
  if (!settings.imageProxyTemplate || settings.imageProxyMode === 'none') return clean
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')
  proxifyContent(doc.body, settings)
  return doc.body.innerHTML
}
