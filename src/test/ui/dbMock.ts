import { vi } from 'vitest'

export const db = {
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  setEntryStatus: vi.fn(),
  setEntryStarred: vi.fn(),
  updateEntryContent: vi.fn(),
  markAllRead: vi.fn(),
  listFeeds: vi.fn(),
  getFeed: vi.fn(),
  createFeed: vi.fn(),
  updateFeed: vi.fn(),
  deleteFeed: vi.fn(),
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  ensureCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  listCounters: vi.fn(),
  getServerSettings: vi.fn(),
  updateServerSettings: vi.fn(),
  existingHashes: vi.fn(),
  insertEntries: vi.fn(),
  listSnapshots: vi.fn(),
  deleteSnapshots: vi.fn(),
  cleanupEntries: vi.fn(),
  importFeeds: vi.fn(),
}

export const refresh = {
  refreshAll: vi.fn(),
  downloadOriginal: vi.fn(),
  scrapeOriginal: vi.fn(),
  startScheduler: vi.fn(() => () => undefined),
  refreshFeed: vi.fn(),
  ingestBody: vi.fn(),
}

export function resetMocks() {
  Object.values(db).forEach((fn) => fn.mockReset())
  Object.values(refresh).forEach((fn) => fn.mockReset())
  refresh.startScheduler.mockReturnValue(() => undefined)
  refresh.refreshAll.mockResolvedValue(undefined)
  db.listEntries.mockResolvedValue({ items: [], total: 0 })
  db.listCounters.mockResolvedValue([])
  db.listCategories.mockResolvedValue([])
  db.listFeeds.mockResolvedValue([])
  db.setEntryStatus.mockResolvedValue(undefined)
  db.setEntryStarred.mockResolvedValue(undefined)
  db.markAllRead.mockResolvedValue(0)
}
