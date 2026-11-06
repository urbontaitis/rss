import { describe, expect, it } from 'vitest'
import { parseDuration, shouldKeep, validateFilterRules } from '../../lib/rules/filter'
import { compileRegex, goReplacement, splitQuotedArgs } from '../../lib/rules/regex'
import type { ParsedItem } from '../../lib/types'

const item = (patch: Partial<ParsedItem> = {}): ParsedItem => ({
  guid: '1',
  title: 'Weekly Sponsored post',
  url: 'https://example.org/a',
  commentsUrl: 'https://news.example/item?id=1',
  author: 'Bob',
  content: '<p>Hello <b>world</b></p>',
  tags: ['News', 'Ads'],
  enclosures: [],
  publishedAt: new Date('2026-11-01T00:00:00Z'),
  ...patch,
})

const none = { globalBlock: '', feedBlock: '', globalKeep: '', feedKeep: '' }
const now = Date.parse('2026-11-06T00:00:00Z')
const blocked = (rule: string, patch: Partial<ParsedItem> = {}) => !shouldKeep(item(patch), { ...none, feedBlock: rule }, now)

describe('block rules', () => {
  it.each([
    ['EntryTitle=(?i)sponsored', true],
    ['EntryTitle=sponsored', false],
    ['EntryURL=example\\.org/a$', true],
    ['EntryCommentsURL=news\\.example', true],
    ['EntryAuthor=^Bob$', true],
    ['EntryAuthor=Alice', false],
    ['EntryTag=^Ads$', true],
    ['EntryContent=Hello world', true],
    ['EntryContent=<b>world', true],
    ['EntryTitle=(', false],
    ['Sponsored', true],
    ['https://example', true],
    ['^Ads$', true],
    ['^Bob$', true],
  ])('%s blocks: %s', (rule, expected) => {
    expect(blocked(rule)).toBe(expected)
  })

  it('applies global block rules before keep rules', () => {
    expect(shouldKeep(item(), { ...none, globalBlock: 'EntryTag=Ads', feedKeep: 'EntryTag=Ads' }, now)).toBe(false)
  })

  it('ignores blank lines and accepts several rules', () => {
    expect(blocked('\n\nEntryAuthor=Alice\r\nEntryTag=News\n')).toBe(true)
  })
})

describe('date rules', () => {
  it.each([
    ['EntryDate=future', { publishedAt: new Date('2027-01-01') }, true],
    ['EntryDate=future', {}, false],
    ['EntryDate=before:2026-11-02', {}, true],
    ['EntryDate=before:2026-10-02', {}, false],
    ['EntryDate=after:2026-10-30', {}, true],
    ['EntryDate=after:2026-11-30', {}, false],
    ['EntryDate=between:2026-10-01,2026-11-02', {}, true],
    ['EntryDate=between:2026-10-01,2026-10-31', {}, false],
    ['EntryDate=between:2026-10-01', {}, false],
    ['EntryDate=max-age:2d', {}, true],
    ['EntryDate=max-age:7d', {}, false],
    ['EntryDate=max-age:soon', {}, false],
    ['EntryDate=before:yesterday', {}, false],
    ['EntryDate=before:2026-13-45', {}, false],
    ['EntryDate=sometime', {}, false],
    ['EntryDate=max-age:1h', { publishedAt: null }, false],
  ])('%s with %o blocks: %s', (rule, patch, expected) => {
    expect(blocked(rule, patch as Partial<ParsedItem>)).toBe(expected)
  })

  it('parses durations', () => {
    expect(parseDuration('1h30m')).toBe(5400000)
    expect(parseDuration('1500ms')).toBe(1500)
    expect(parseDuration('2us')).toBe(0.002)
    expect(parseDuration('1d2h')).toBe(93600000)
    expect(parseDuration('1x')).toBeNull()
    expect(parseDuration('')).toBeNull()
  })
})

describe('keep rules', () => {
  it('keeps only matching entries', () => {
    expect(shouldKeep(item(), { ...none, feedKeep: 'EntryURL=example\\.org' }, now)).toBe(true)
    expect(shouldKeep(item(), { ...none, feedKeep: 'EntryURL=other\\.org' }, now)).toBe(false)
    expect(shouldKeep(item(), { ...none, globalKeep: 'EntryTag=Missing' }, now)).toBe(false)
  })

  it('requires both global and feed keep rules to match', () => {
    expect(shouldKeep(item(), { ...none, globalKeep: 'EntryTag=News', feedKeep: 'EntryAuthor=Alice' }, now)).toBe(false)
    expect(shouldKeep(item(), { ...none, globalKeep: 'EntryTag=News', feedKeep: 'EntryAuthor=Bob' }, now)).toBe(true)
  })

  it('uses the current time by default', () => {
    expect(shouldKeep(item({ publishedAt: new Date(Date.now() + 86400000) }), { ...none, feedBlock: 'EntryDate=future' })).toBe(false)
  })
})

describe('validateFilterRules', () => {
  it('reports invalid regexes and dates', () => {
    expect(validateFilterRules('EntryTitle=(\nEntryDate=sometime\nEntryDate=max-age:7x\nEntryDate=max-age:7d\nEntryTitle=ok\n[')).toEqual([
      'EntryTitle=(',
      'EntryDate=sometime',
      'EntryDate=max-age:7x',
      '[',
    ])
  })
})

describe('regex helpers', () => {
  it('translates RE2 syntax', () => {
    expect(compileRegex('(?i)abc')?.flags).toBe('i')
    expect(compileRegex('(?is)a.b', 'g')?.flags).toBe('gis')
    expect(compileRegex('(?iU)a', 'i')?.flags).toBe('i')
    expect(compileRegex('\\Aabc\\z')?.test('abc')).toBe(true)
    expect(compileRegex('(?P<year>\\d{4})')?.exec('2026')?.groups?.year).toBe('2026')
    expect(compileRegex('(')).toBeNull()
  })

  it('converts replacement groups and splits quoted arguments', () => {
    expect(goReplacement('${1}-$2')).toBe('$1-$2')
    expect(splitQuotedArgs('"a\\"b"|"c,d"')).toEqual(['a"b', 'c,d'])
    expect(splitQuotedArgs('no quotes')).toEqual([])
  })
})
