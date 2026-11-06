import type { ParsedItem } from '../types'
import { stripTags } from '../text'
import { compileRegex } from './regex'

export type FilterField = 'EntryTitle' | 'EntryURL' | 'EntryCommentsURL' | 'EntryContent' | 'EntryAuthor' | 'EntryTag' | 'EntryDate'

export const filterFields: FilterField[] = ['EntryTitle', 'EntryURL', 'EntryCommentsURL', 'EntryContent', 'EntryAuthor', 'EntryTag', 'EntryDate']

interface Rule {
  field: FilterField | 'Legacy'
  value: string
}

function parseRules(text: string): Rule[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=')
      const field = index > 0 ? line.slice(0, index).trim() : ''
      if (filterFields.includes(field as FilterField)) return { field: field as FilterField, value: line.slice(index + 1).trim() }
      return { field: 'Legacy' as const, value: line }
    })
}

const durationUnits: Record<string, number> = { ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }

export function parseDuration(value: string): number | null {
  const re = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h|d)/g
  let total = 0
  let consumed = ''
  let match: RegExpExecArray | null
  while ((match = re.exec(value))) {
    total += Number(match[1]) * durationUnits[match[2]]
    consumed += match[0]
  }
  return consumed && consumed === value.trim() ? total : null
}

function parseDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null
  const time = Date.parse(`${value.trim()}T00:00:00Z`)
  return Number.isNaN(time) ? null : time
}

function matchDate(value: string, date: Date | null, now: number): boolean {
  const time = (date ?? new Date(now)).getTime()
  const [kind, arg = ''] = value.split(/:(.*)/s)
  switch (kind.trim()) {
    case 'future':
      return time > now
    case 'before': {
      const day = parseDay(arg)
      return day !== null && time < day
    }
    case 'after': {
      const day = parseDay(arg)
      return day !== null && time > day
    }
    case 'between': {
      const [start, end] = arg.split(',').map(parseDay)
      return start != null && end != null && time > start && time < end
    }
    case 'max-age': {
      const duration = parseDuration(arg)
      return duration !== null && now - time > duration
    }
    default:
      return false
  }
}

function matchRule(rule: Rule, item: ParsedItem, now: number): boolean {
  if (rule.field === 'EntryDate') return matchDate(rule.value, item.publishedAt, now)
  const regex = compileRegex(rule.value)
  if (!regex) return false
  switch (rule.field) {
    case 'EntryTitle':
      return regex.test(item.title)
    case 'EntryURL':
      return regex.test(item.url)
    case 'EntryCommentsURL':
      return regex.test(item.commentsUrl)
    case 'EntryContent':
      return regex.test(item.content) || regex.test(stripTags(item.content))
    case 'EntryAuthor':
      return regex.test(item.author)
    case 'EntryTag':
      return item.tags.some((tag) => regex.test(tag))
    case 'Legacy':
      return regex.test(item.title) || regex.test(item.url) || regex.test(item.author) || item.tags.some((tag) => regex.test(tag))
  }
}

function anyMatch(rules: Rule[], item: ParsedItem, now: number): boolean {
  return rules.some((rule) => matchRule(rule, item, now))
}

export interface FilterRuleSet {
  globalBlock: string
  feedBlock: string
  globalKeep: string
  feedKeep: string
}

export function shouldKeep(item: ParsedItem, rules: FilterRuleSet, now = Date.now()): boolean {
  if (anyMatch(parseRules(rules.globalBlock), item, now)) return false
  if (anyMatch(parseRules(rules.feedBlock), item, now)) return false
  const globalKeep = parseRules(rules.globalKeep)
  const feedKeep = parseRules(rules.feedKeep)
  if (globalKeep.length && !anyMatch(globalKeep, item, now)) return false
  if (feedKeep.length && !anyMatch(feedKeep, item, now)) return false
  return true
}

export function validateFilterRules(text: string): string[] {
  return parseRules(text)
    .filter((rule) => {
      if (rule.field === 'EntryDate') return !/^(future|before:\d{4}-\d{2}-\d{2}|after:\d{4}-\d{2}-\d{2}|between:\d{4}-\d{2}-\d{2},\d{4}-\d{2}-\d{2}|max-age:.+)$/.test(rule.value) || (rule.value.startsWith('max-age:') && parseDuration(rule.value.slice(8)) === null)
      return compileRegex(rule.value) === null
    })
    .map((rule) => `${rule.field === 'Legacy' ? '' : rule.field + '='}${rule.value}`)
}
