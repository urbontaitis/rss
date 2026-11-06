import { Readability } from '@mozilla/readability'
import { absoluteUrl } from '../text'

function absolutize(root: ParentNode, base: string) {
  root.querySelectorAll('[src]').forEach((el) => el.setAttribute('src', absoluteUrl(el.getAttribute('src') || '', base)))
  root.querySelectorAll('[href]').forEach((el) => el.setAttribute('href', absoluteUrl(el.getAttribute('href') || '', base)))
  root.querySelectorAll('[srcset]').forEach((el) => {
    const value = (el.getAttribute('srcset') || '')
      .split(',')
      .map((part) => {
        const [src, ...rest] = part.trim().split(/\s+/)
        return [absoluteUrl(src, base), ...rest].join(' ')
      })
      .join(', ')
    el.setAttribute('srcset', value)
  })
}

export function extractContent(html: string, pageUrl: string, rules: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href')
  const base = baseHref ? absoluteUrl(baseHref, pageUrl) : pageUrl
  if (rules.trim()) {
    let nodes: Element[] = []
    try {
      nodes = Array.from(doc.querySelectorAll(rules))
    } catch {
      nodes = []
    }
    if (nodes.length) {
      const container = doc.createElement('div')
      nodes.forEach((node) => container.appendChild(node.cloneNode(true)))
      absolutize(container, base)
      return container.innerHTML
    }
  }
  absolutize(doc, base)
  const article = new Readability(doc, { keepClasses: false }).parse()
  return article?.content || ''
}
