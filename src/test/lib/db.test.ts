import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock, methods } from '../supabaseMock'

const mock = createSupabaseMock()
vi.mock('../../lib/supabase', () => ({ getClient: () => mock.client }))

const db = await import('../../lib/db')
const { saveSettings } = await import('../../lib/settings')

beforeEach(() => {
  mock.queries.length = 0
  mock.rpcs.length = 0
  mock.setResponder(() => ({ data: [], error: null, count: 0 }))
  saveSettings({ entriesPerPage: 20, sortDirection: 'desc' })
})

describe('listEntries', () => {
  it('lists global unread entries without hidden feeds', async () => {
    mock.setResponder(() => ({ data: [{ id: 1 }], error: null, count: 41 }))
    const result = await db.listEntries({ view: 'unread', page: 2 })
    expect(result).toEqual({ items: [{ id: 1 }], total: 41 })
    const calls = methods(mock.callsFor('entry_list')[0])
    expect(calls).toContain('neq("status","removed")')
    expect(calls).toContain('eq("status","unread")')
    expect(calls).toContain('eq("hidden",false)')
    expect(calls).toContain('order("published_at",{"ascending":false})')
    expect(calls).toContain('range(40,59)')
    expect(mock.callsFor('entry_list')[0].calls[0].args[1]).toEqual({ count: 'exact' })
  })

  it('shows hidden feeds when listing a feed or category', async () => {
    await db.listEntries({ view: 'unread', page: 0, feedId: 3 })
    await db.listEntries({ view: 'unread', page: 0, categoryId: 4 })
    const [feed, category] = mock.callsFor('entry_list').map(methods)
    expect(feed).toContain('eq("feed_id",3)')
    expect(feed).not.toContain('eq("hidden",false)')
    expect(category).toContain('eq("category_id",4)')
    expect(category).not.toContain('eq("hidden",false)')
  })

  it('builds starred, history, search and all views', async () => {
    saveSettings({ sortDirection: 'asc' })
    await db.listEntries({ view: 'starred', page: 0 })
    await db.listEntries({ view: 'history', page: 0 })
    await db.listEntries({ view: 'search', page: 0, search: 'bike tour' })
    await db.listEntries({ view: 'search', page: 0 })
    await db.listEntries({ view: 'all', page: 0, status: 'read' })
    await db.listEntries({ view: 'all', page: 0, status: 'any' })
    const [starred, history, search, emptySearch, read, any] = mock.callsFor('entry_list').map(methods)
    expect(starred).toContain('eq("starred",true)')
    expect(starred).toContain('order("published_at",{"ascending":true})')
    expect(history).toContain('eq("status","read")')
    expect(history).toContain('order("changed_at",{"ascending":false})')
    expect(search).toContain('textSearch("search","bike tour",{"type":"websearch","config":"simple"})')
    expect(emptySearch.some((call) => call.startsWith('textSearch'))).toBe(false)
    expect(read).toContain('eq("status","read")')
    expect(any.filter((call) => call.startsWith('eq("status"'))).toEqual([])
  })

  it('throws query errors and handles empty results', async () => {
    mock.setResponder(() => ({ data: null, error: { message: 'boom' } }))
    await expect(db.listEntries({ view: 'unread', page: 0 })).rejects.toThrow('boom')
    mock.setResponder(() => ({ data: null, error: null, count: null }))
    expect(await db.listEntries({ view: 'unread', page: 0 })).toEqual({ items: [], total: 0 })
  })
})

describe('entries', () => {
  it('reads and updates entries', async () => {
    mock.setResponder(() => ({ data: { id: 5 }, error: null }))
    expect(await db.getEntry(5)).toEqual({ id: 5 })
    await db.setEntryStatus([1, 2], 'read')
    await db.setEntryStatus([], 'read')
    await db.setEntryStarred(3, true)
    await db.updateEntryContent(4, '<p>x</p>', 2)
    const calls = mock.callsFor('entries').map(methods)
    expect(calls[0]).toEqual(['select("*")', 'eq("id",5)', 'single()'])
    expect(calls[1]).toEqual(['update({"status":"read"})', 'in("id",[1,2])'])
    expect(calls).toHaveLength(4)
    expect(calls[2]).toEqual(['update({"starred":true})', 'eq("id",3)'])
    expect(calls[3]).toEqual(['update({"content":"<p>x</p>","reading_time":2})', 'eq("id",4)'])
  })

  it('marks everything read through rpc', async () => {
    mock.setResponder(() => ({ data: 7, error: null }))
    expect(await db.markAllRead({ feedId: 2 })).toBe(7)
    await db.markAllRead({})
    expect(mock.rpcs).toEqual([
      { name: 'mark_all_read', args: { p_feed_id: 2, p_category_id: null } },
      { name: 'mark_all_read', args: { p_feed_id: null, p_category_id: null } },
    ])
  })

  it('looks up existing hashes in chunks', async () => {
    mock.setResponder((query) => ({ data: (query.calls.find((call) => call.method === 'in')?.args[1] as string[]).slice(0, 1).map((hash) => ({ hash })), error: null }))
    const hashes = Array.from({ length: 450 }, (_, index) => `h${index}`)
    const found = await db.existingHashes(9, hashes)
    expect(mock.callsFor('entries')).toHaveLength(3)
    expect([...found]).toEqual(['h0', 'h200', 'h400'])
  })

  it('inserts entries ignoring duplicates', async () => {
    expect(await db.insertEntries([])).toBe(0)
    mock.setResponder(() => ({ data: [{ id: 1 }, { id: 2 }], error: null }))
    expect(await db.insertEntries([{ hash: 'a' }, { hash: 'b' }, { hash: 'c' }])).toBe(2)
    expect(methods(mock.callsFor('entries')[0])[0]).toBe('upsert([{"hash":"a"},{"hash":"b"},{"hash":"c"}],{"onConflict":"feed_id,hash","ignoreDuplicates":true})')
  })
})

describe('feeds, categories and settings', () => {
  it('performs CRUD calls', async () => {
    mock.setResponder(() => ({ data: { id: 1 }, error: null }))
    await db.listFeeds()
    await db.getFeed(1)
    await db.createFeed({ feed_url: 'https://x' })
    await db.updateFeed(1, { title: 'T' })
    await db.deleteFeed(1)
    await db.listCategories()
    await db.createCategory('Dev')
    await db.updateCategory(1, { title: 'Ops' })
    await db.deleteCategory(1)
    await db.listCounters()
    await db.getServerSettings()
    await db.updateServerSettings({ retention_days: 5 })
    await db.listSnapshots()
    await db.deleteSnapshots([1, 2])
    await db.deleteSnapshots([])
    const feeds = mock.callsFor('feeds').map(methods)
    expect(feeds[0]).toEqual(['select("*")', 'order("title")'])
    expect(feeds[3]).toEqual(['update({"title":"T"})', 'eq("id",1)', 'select()', 'single()'])
    expect(feeds[4]).toEqual(['delete()', 'eq("id",1)'])
    expect(methods(mock.callsFor('categories')[1])).toEqual(['insert({"title":"Dev"})', 'select()', 'single()'])
    const settingsUpdate = mock.callsFor('settings')[1].calls[0].args[0] as Record<string, unknown>
    expect(settingsUpdate.retention_days).toBe(5)
    expect(typeof settingsUpdate.updated_at).toBe('string')
    expect(mock.callsFor('feed_snapshots')).toHaveLength(2)
  })

  it('reuses or creates categories by case insensitive title', async () => {
    const cache = new Map()
    mock.setResponder((query) => (query.calls[0].method === 'select' ? { data: [], error: null } : { data: { id: 8, title: 'New' }, error: null }))
    expect((await db.ensureCategory(' New ', cache)).id).toBe(8)
    expect((await db.ensureCategory('new', cache)).id).toBe(8)
    expect(mock.callsFor('categories')).toHaveLength(2)
    mock.setResponder(() => ({ data: [{ id: 3, title: 'Old' }], error: null }))
    expect((await db.ensureCategory('OLD', cache)).id).toBe(3)
  })

  it('imports feeds in batches and counts new rows', async () => {
    mock.setResponder((query) => ({ data: (query.calls[0].args[0] as unknown[]).slice(0, 10).map((_, id) => ({ id })), error: null }))
    const rows = Array.from({ length: 150 }, (_, index) => ({ feed_url: `https://x/${index}` }))
    expect(await db.importFeeds(rows)).toBe(20)
    expect(mock.callsFor('feeds')[0].calls[0].args[1]).toEqual({ onConflict: 'feed_url', ignoreDuplicates: true })
  })

  it('runs cleanup', async () => {
    mock.setResponder(() => ({ data: 4, error: null }))
    expect(await db.cleanupEntries()).toBe(4)
  })
})
