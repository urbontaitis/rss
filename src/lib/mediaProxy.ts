import { applyTemplate } from './fetcher'
import type { LocalSettings } from './settings'

export function proxify(url: string, settings: Pick<LocalSettings, 'imageProxyTemplate' | 'imageProxyMode'>): string {
  if (!url || !settings.imageProxyTemplate || settings.imageProxyMode === 'none') return url
  if (!/^https?:\/\//i.test(url)) return url
  if (settings.imageProxyMode === 'http-only' && !url.toLowerCase().startsWith('http://')) return url
  return applyTemplate(settings.imageProxyTemplate, url)
}

function proxifySrcset(value: string, settings: Pick<LocalSettings, 'imageProxyTemplate' | 'imageProxyMode'>): string {
  return value
    .split(/,\s+(?=\S)/)
    .map((candidate) => {
      const [src, ...descriptor] = candidate.trim().split(/\s+/)
      return [proxify(src, settings), ...descriptor].join(' ')
    })
    .join(', ')
}

export function proxifyContent(root: ParentNode, settings: Pick<LocalSettings, 'imageProxyTemplate' | 'imageProxyMode' | 'imageProxyMedia'>): void {
  if (!settings.imageProxyTemplate || settings.imageProxyMode === 'none') return
  root.querySelectorAll('img[src], picture source[src]').forEach((el) => el.setAttribute('src', proxify(el.getAttribute('src') || '', settings)))
  root.querySelectorAll('img[srcset], picture source[srcset]').forEach((el) => el.setAttribute('srcset', proxifySrcset(el.getAttribute('srcset') || '', settings)))
  root.querySelectorAll('video[poster]').forEach((el) => el.setAttribute('poster', proxify(el.getAttribute('poster') || '', settings)))
  if (settings.imageProxyMedia) {
    root.querySelectorAll('audio[src], video[src], audio source[src], video source[src]').forEach((el) => el.setAttribute('src', proxify(el.getAttribute('src') || '', settings)))
  }
}
