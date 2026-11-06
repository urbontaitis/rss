import { cleanupEntries, deleteSnapshots, existingHashes, getServerSettings, insertEntries, listFeeds, listSnapshots, updateEntryContent, updateFeed } from './db'
import { fetchUrl, type FetchOptions } from './fetcher'
import { looksLikeFeed, parseFeed } from './parser'
import { shouldKeep } from './rules/filter'
import { applyRewriteRules } from './rules/rewrite'
import { extractContent } from './rules/scraper'
import { rewriteUrl } from './rules/urlRewrite'
import { sanitizeHtml } from './sanitize'
import { getSettings } from './settings'
import { bumpRevision, createStore } from './store'
import { readingTime, sha256 } from './text'
import type { Entry, Feed, ParsedItem, ServerSettings } from './types'

export const refreshStore = createStore({
  running: false,
  done: 0,
  total: 0,
  newEntries: 0,
  errors: 0,
  lastRun: 0,
  message: '',
})

function fetchOptions(feed: Feed, conditional: boolean): FetchOptions {
  return {
    userAgent: feed.user_agent,
    cookie: feed.cookie,
    username: feed.username,
    password: feed.password,
    etag: conditional && !feed.ignore_http_cache ? feed.etag : '',
    lastModified: conditional && !feed.ignore_http_cache ? feed.last_modified : '',
  }
}

export async function scrapeOriginal(feed: Feed, url: string): Promise<string> {
  const target = rewriteUrl(url, feed.url_rewrite_rules)
  const result = await fetchUrl(target, fetchOptions(feed, false))
  if (result.status >= 400) throw new Error(`HTTP ${result.status}`)
  return await extractContent(result.body, result.url || target, feed.scraper_rules)
}

async function buildEntry(feed: Feed, item: ParsedItem, hash: string): Promise<Partial<Entry>> {
  const settings = getSettings()
  let content = item.content
  if (feed.crawler && item.url) {
    try {
      const scraped = await scrapeOriginal(feed, item.url)
      if (scraped.trim()) content = scraped
    } catch {
      content = item.content
    }
  }
  const rewritten = await applyRewriteRules(
    { title: item.title, content, url: item.url, commentsUrl: item.commentsUrl, guid: item.guid, enclosures: item.enclosures },
    feed.rewrite_rules,
    { invidiousInstance: settings.invidiousInstance },
  )
  const clean = sanitizeHtml(rewritten.content, { invidiousInstance: settings.invidiousInstance, entryUrl: item.url })
  const published = item.publishedAt && !Number.isNaN(item.publishedAt.getTime()) ? item.publishedAt : new Date()
  return {
    feed_id: feed.id,
    hash,
    title: rewritten.title || item.url || 'Untitled',
    url: item.url,
    comments_url: item.commentsUrl,
    author: item.author.slice(0, 500),
    content: clean,
    tags: Array.from(new Set(item.tags)).slice(0, 50),
    enclosures: item.enclosures,
    reading_time: readingTime(clean),
    published_at: published.toISOString(),
  }
}

export async function ingestBody(feed: Feed, body: string, server: ServerSettings): Promise<{ added: number; patch: Partial<Feed> }> {
  if (!looksLikeFeed(body)) throw new Error('The response is not a valid feed')
  const parsed = parseFeed(body, feed.feed_url)
  const patch: Partial<Feed> = {}
  if (!feed.title && parsed.title) patch.title = parsed.title
  if (!feed.site_url && parsed.siteUrl) patch.site_url = parsed.siteUrl
  if (!feed.description && parsed.description) patch.description = parsed.description.slice(0, 1000)
  if (!feed.icon_url) {
    const site = parsed.siteUrl || feed.site_url || feed.feed_url
    try {
      patch.icon_url = parsed.iconUrl || `${new URL(site).origin}/favicon.ico`
    } catch {
      patch.icon_url = parsed.iconUrl
    }
  }

  const hashed: { item: ParsedItem; hash: string }[] = []
  const seen = new Set<string>()
  for (const item of parsed.items) {
    const hash = await sha256(item.guid || item.url || `${item.title}${item.content}`)
    if (seen.has(hash)) continue
    seen.add(hash)
    hashed.push({ item, hash })
  }
  const existing = await existingHashes(feed.id, hashed.map((entry) => entry.hash))
  const rules = {
    globalBlock: server.block_filter_entry_rules,
    globalKeep: server.keep_filter_entry_rules,
    feedBlock: feed.block_filter_entry_rules,
    feedKeep: feed.keep_filter_entry_rules,
  }
  const fresh = hashed.filter(({ item, hash }) => !existing.has(hash) && shouldKeep(item, rules))
  const rows: Partial<Entry>[] = []
  for (const { item, hash } of fresh.reverse()) rows.push(await buildEntry(feed, item, hash))
  const added = await insertEntries(rows)
  return { added, patch }
}

export async function refreshFeed(feed: Feed, server: ServerSettings): Promise<number> {
  const checkedAt = new Date().toISOString()
  try {
    const result = await fetchUrl(feed.feed_url, fetchOptions(feed, true))
    if (result.status === 304) {
      await updateFeed(feed.id, { checked_at: checkedAt, parsing_error_count: 0, parsing_error_msg: '' })
      return 0
    }
    if (result.status >= 400) throw new Error(`HTTP ${result.status}`)
    const { added, patch } = await ingestBody(feed, result.body, server)
    await updateFeed(feed.id, {
      ...patch,
      checked_at: checkedAt,
      etag: result.etag,
      last_modified: result.lastModified,
      parsing_error_count: 0,
      parsing_error_msg: '',
    })
    return added
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateFeed(feed.id, {
      checked_at: checkedAt,
      parsing_error_count: feed.parsing_error_count + 1,
      parsing_error_msg: message.slice(0, 500),
    }).catch(() => undefined)
    throw error
  }
}

function isDue(feed: Feed, intervalMinutes: number, now: number): boolean {
  if (!feed.checked_at) return true
  const backoff = Math.min(Math.max(feed.parsing_error_count, 1), 12)
  return now - Date.parse(feed.checked_at) >= backoff * intervalMinutes * 60000 * 0.9
}

async function processSnapshots(feeds: Map<number, Feed>, server: ServerSettings): Promise<number> {
  let added = 0
  const snapshots = await listSnapshots()
  const processed: number[] = []
  for (const snapshot of snapshots) {
    const feed = feeds.get(snapshot.feed_id)
    processed.push(snapshot.id)
    if (!feed || feed.disabled) continue
    try {
      const result = await ingestBody(feed, snapshot.body, server)
      added += result.added
      if (Object.keys(result.patch).length) {
        const updated = await updateFeed(feed.id, result.patch)
        feeds.set(feed.id, updated)
      }
    } catch {
      continue
    }
  }
  await deleteSnapshots(processed)
  return added
}

async function maybeCleanup() {
  const key = 'rss.lastCleanup'
  try {
    const last = Number(localStorage.getItem(key) || 0)
    if (Date.now() - last < 86400000) return
    localStorage.setItem(key, String(Date.now()))
  } catch {
    return
  }
  await cleanupEntries().catch(() => undefined)
}

async function runPool<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  let index = 0
  const runners = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (index < items.length) {
      const item = items[index++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

async function withLock(task: () => Promise<void>) {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    await navigator.locks.request('rss-refresh', { ifAvailable: true }, async (lock) => {
      if (lock) await task()
    })
    return
  }
  await task()
}

export async function refreshAll(options: { force?: boolean; feedIds?: number[] } = {}): Promise<void> {
  if (refreshStore.get().running) return
  await withLock(async () => {
    const settings = getSettings()
    refreshStore.set({ running: true, done: 0, total: 0, newEntries: 0, errors: 0, message: 'Loading feeds' })
    let added = 0
    let errors = 0
    try {
      const [server, feeds] = await Promise.all([getServerSettings(), listFeeds()])
      const byId = new Map(feeds.map((feed) => [feed.id, feed]))
      if (!options.feedIds) {
        refreshStore.set({ message: 'Processing server snapshots' })
        const fromSnapshots = await processSnapshots(byId, server).catch(() => 0)
        added += fromSnapshots
      }
      const now = Date.now()
      const due = Array.from(byId.values()).filter((feed) => {
        if (options.feedIds) return options.feedIds.includes(feed.id)
        if (feed.disabled) return false
        return options.force || isDue(feed, settings.refreshIntervalMinutes, now)
      })
      refreshStore.set({ total: due.length, message: due.length ? 'Refreshing feeds' : 'All feeds are up to date' })
      await runPool(due, settings.refreshConcurrency, async (feed) => {
        try {
          const count = await refreshFeed(feed, server)
          added += count
        } catch {
          errors++
        }
        refreshStore.set({ done: refreshStore.get().done + 1, newEntries: added, errors })
      })
      await maybeCleanup()
    } catch (error) {
      refreshStore.set({ message: error instanceof Error ? error.message : String(error) })
      errors++
    } finally {
      refreshStore.set({ running: false, lastRun: Date.now(), newEntries: added, errors, message: errors ? `${errors} feed(s) failed` : `${added} new entr${added === 1 ? 'y' : 'ies'}` })
      bumpRevision()
    }
  })
}

export async function downloadOriginal(entry: Entry, feed: Feed): Promise<string> {
  const settings = getSettings()
  const scraped = await scrapeOriginal(feed, entry.url)
  if (!scraped.trim()) throw new Error('No content could be extracted')
  const rewritten = await applyRewriteRules(
    { title: entry.title, content: scraped, url: entry.url, commentsUrl: entry.comments_url, guid: entry.hash, enclosures: entry.enclosures },
    feed.rewrite_rules,
    { invidiousInstance: settings.invidiousInstance },
  )
  const clean = sanitizeHtml(rewritten.content, { invidiousInstance: settings.invidiousInstance, entryUrl: entry.url })
  await updateEntryContent(entry.id, clean, readingTime(clean))
  return clean
}

let timer: ReturnType<typeof setInterval> | null = null

export function startScheduler(): () => void {
  const settings = getSettings()
  if (settings.refreshOnOpen) void refreshAll()
  const tick = () => {
    if (document.visibilityState === 'visible') void refreshAll()
  }
  if (timer) clearInterval(timer)
  timer = setInterval(tick, Math.max(5, settings.refreshIntervalMinutes) * 60000)
  const onVisible = () => {
    const { lastRun, running } = refreshStore.get()
    if (!running && document.visibilityState === 'visible' && Date.now() - lastRun > getSettings().refreshIntervalMinutes * 60000) void refreshAll()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisible)
  }
}
