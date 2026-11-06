import { getClient } from './supabase'
import { getSettings } from './settings'
import type { Category, Entry, EntryListItem, EntryStatus, Feed, FeedCounter, FeedSnapshot, ServerSettings } from './types'

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}

export type EntryView = 'unread' | 'starred' | 'history' | 'all' | 'search'

export interface EntryQuery {
  view: EntryView
  feedId?: number
  categoryId?: number
  search?: string
  page: number
  status?: EntryStatus | 'any'
}

export async function listEntries(query: EntryQuery): Promise<{ items: EntryListItem[]; total: number }> {
  const settings = getSettings()
  const perPage = settings.entriesPerPage
  const from = query.page * perPage
  let request = getClient()
    .from('entry_list')
    .select('id, feed_id, title, url, comments_url, author, tags, reading_time, status, starred, published_at, created_at, changed_at, feed_title, feed_site_url, feed_icon_url, category_id, category_title, hidden', { count: 'exact' })
    .neq('status', 'removed')

  if (query.feedId) request = request.eq('feed_id', query.feedId)
  if (query.categoryId) request = request.eq('category_id', query.categoryId)

  const ascending = settings.sortDirection === 'asc'
  switch (query.view) {
    case 'unread':
      request = request.eq('status', 'unread')
      if (!query.feedId && !query.categoryId) request = request.eq('hidden', false)
      request = request.order('published_at', { ascending }).order('id', { ascending })
      break
    case 'starred':
      request = request.eq('starred', true).order('published_at', { ascending }).order('id', { ascending })
      break
    case 'history':
      request = request.eq('status', 'read').order('changed_at', { ascending: false }).order('id', { ascending: false })
      break
    case 'search':
      if (query.search) request = request.textSearch('search', query.search, { type: 'websearch', config: 'simple' })
      request = request.order('published_at', { ascending: false })
      break
    case 'all':
      if (query.status && query.status !== 'any') request = request.eq('status', query.status)
      request = request.order('published_at', { ascending }).order('id', { ascending })
      break
  }

  const result = await request.range(from, from + perPage - 1)
  if (result.error) throw new Error(result.error.message)
  return { items: (result.data || []) as EntryListItem[], total: result.count || 0 }
}

export async function getEntry(id: number): Promise<Entry> {
  return check(await getClient().from('entries').select('*').eq('id', id).single())
}

export async function setEntryStatus(ids: number[], status: EntryStatus): Promise<void> {
  if (!ids.length) return
  check(await getClient().from('entries').update({ status }).in('id', ids))
}

export async function setEntryStarred(id: number, starred: boolean): Promise<void> {
  check(await getClient().from('entries').update({ starred }).eq('id', id))
}

export async function updateEntryContent(id: number, content: string, readingTime: number): Promise<void> {
  check(await getClient().from('entries').update({ content, reading_time: readingTime }).eq('id', id))
}

export async function markAllRead(scope: { feedId?: number; categoryId?: number }): Promise<number> {
  return check(await getClient().rpc('mark_all_read', { p_feed_id: scope.feedId ?? null, p_category_id: scope.categoryId ?? null }))
}

export async function listFeeds(): Promise<Feed[]> {
  return check(await getClient().from('feeds').select('*').order('title'))
}

export async function getFeed(id: number): Promise<Feed> {
  return check(await getClient().from('feeds').select('*').eq('id', id).single())
}

export async function createFeed(feed: Partial<Feed>): Promise<Feed> {
  return check(await getClient().from('feeds').insert(feed).select().single())
}

export async function updateFeed(id: number, patch: Partial<Feed>): Promise<Feed> {
  return check(await getClient().from('feeds').update(patch).eq('id', id).select().single())
}

export async function deleteFeed(id: number): Promise<void> {
  check(await getClient().from('feeds').delete().eq('id', id))
}

export async function listCategories(): Promise<Category[]> {
  return check(await getClient().from('categories').select('*').order('title'))
}

export async function createCategory(title: string): Promise<Category> {
  return check(await getClient().from('categories').insert({ title }).select().single())
}

export async function ensureCategory(title: string, cache: Map<string, Category>): Promise<Category> {
  const key = title.trim().toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached
  const existing = check<Category[]>(await getClient().from('categories').select('*').ilike('title', title.trim()).limit(1))
  const category = existing[0] || (await createCategory(title.trim()))
  cache.set(key, category)
  return category
}

export async function updateCategory(id: number, patch: Partial<Category>): Promise<Category> {
  return check(await getClient().from('categories').update(patch).eq('id', id).select().single())
}

export async function deleteCategory(id: number): Promise<void> {
  check(await getClient().from('categories').delete().eq('id', id))
}

export async function listCounters(): Promise<FeedCounter[]> {
  return check(await getClient().from('feed_counters').select('*'))
}

export async function getServerSettings(): Promise<ServerSettings> {
  return check(await getClient().from('settings').select('*').eq('id', 1).single())
}

export async function updateServerSettings(patch: Partial<ServerSettings>): Promise<ServerSettings> {
  return check(await getClient().from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select().single())
}

export async function existingHashes(feedId: number, hashes: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (let i = 0; i < hashes.length; i += 200) {
    const chunk = hashes.slice(i, i + 200)
    const rows = check<{ hash: string }[]>(await getClient().from('entries').select('hash').eq('feed_id', feedId).in('hash', chunk))
    rows.forEach((row) => found.add(row.hash))
  }
  return found
}

export async function insertEntries(rows: Partial<Entry>[]): Promise<number> {
  if (!rows.length) return 0
  const data = check<{ id: number }[]>(
    await getClient().from('entries').upsert(rows, { onConflict: 'feed_id,hash', ignoreDuplicates: true }).select('id'),
  )
  return data.length
}

export async function listSnapshots(): Promise<FeedSnapshot[]> {
  return check(await getClient().from('feed_snapshots').select('*').order('fetched_at', { ascending: true }).limit(200))
}

export async function deleteSnapshots(ids: number[]): Promise<void> {
  if (!ids.length) return
  check(await getClient().from('feed_snapshots').delete().in('id', ids))
}

export async function cleanupEntries(): Promise<number> {
  return check(await getClient().rpc('cleanup_entries'))
}

export async function importFeeds(rows: Partial<Feed>[]): Promise<number> {
  let added = 0
  for (let i = 0; i < rows.length; i += 100) {
    const data = check<{ id: number }[]>(
      await getClient().from('feeds').upsert(rows.slice(i, i + 100), { onConflict: 'feed_url', ignoreDuplicates: true }).select('id'),
    )
    added += data.length
  }
  return added
}
