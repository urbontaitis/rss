import { absoluteUrl } from '../text'

function absolutize(root: ParentNode, base: string) {
  root.querySelectorAll('[src]').forEach((el) => el.setAttribute('src', absoluteUrl(el.getAttribute('src') as string, base)))
  root.querySelectorAll('[href]').forEach((el) => el.setAttribute('href', absoluteUrl(el.getAttribute('href') as string, base)))
  root.querySelectorAll('[srcset]').forEach((el) => {
    const value = (el.getAttribute('srcset') as string)
      .split(',')
      .map((part) => {
        const [src, ...rest] = part.trim().split(/\s+/)
        return [absoluteUrl(src, base), ...rest].join(' ')
      })
      .join(', ')
    el.setAttribute('srcset', value)
  })
}

function queryAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector))
  } catch {
    return []
  }
}

export async function extractContent(html: string, pageUrl: string, rules: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href')
  const base = baseHref ? absoluteUrl(baseHref, pageUrl) : pageUrl
  if (rules.trim()) {
    const nodes = queryAll(doc, rules)
    if (nodes.length) {
      const container = doc.createElement('div')
      nodes.forEach((node) => container.appendChild(node.cloneNode(true)))
      absolutize(container, base)
      return container.innerHTML
    }
  }
  absolutize(doc, base)
  const { Readability } = await import('@mozilla/readability')
  const article = new Readability(doc, { keepClasses: false }).parse()
  return article?.content || ''
}
