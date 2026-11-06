import { compileRegex, goReplacement, splitQuotedArgs } from './regex'

export function rewriteUrl(url: string, rules: string): string {
  const trimmed = rules.trim()
  if (!trimmed || !trimmed.startsWith('rewrite(')) return url
  const [pattern, replacement] = splitQuotedArgs(trimmed)
  if (pattern === undefined || replacement === undefined) return url
  const regex = compileRegex(pattern)
  if (!regex || !regex.test(url)) return url
  return url.replace(regex, goReplacement(replacement))
}
