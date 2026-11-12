import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeListItem } from '../fixtures'
import { db, refresh, resetMocks } from './dbMock'
import { renderRoute } from './render'

vi.mock('../../lib/db', () => db)
vi.mock('../../lib/refresh', async (original) => ({ ...(await original<typeof import('../../lib/refresh')>()), ...refresh }))

const { CategoryEntriesPage, FeedEntriesPage, HistoryPage, SearchPage, StarredPage, UnreadPage } = await import('../../pages/Entries')
const { saveSettings } = await import('../../lib/settings')
const { neighbours } = await import('../../lib/navigation')
const { refreshStore } = await import('../../lib/refresh')
const { dataStore } = await import('../../lib/store')

const items = [
  makeListItem({ id: 1, title: 'First', feed_title: 'Feed A', category_id: 3, category_title: 'Dev', comments_url: 'https://c.org/1', reading_time: 4 }),
  makeListItem({ id: 2, title: 'Second', status: 'read', starred: true, url: '', feed_title: '', feed_site_url: 'https://site.org' }),
  makeListItem({ id: 3, title: 'Third', reading_time: 0 }),
]

beforeEach(() => {
  resetMocks()
  saveSettings({ entriesPerPage: 3, showReadingTime: true })
  db.listEntries.mockResolvedValue({ items, total: 7 })
})

describe('entry lists', () => {
  it('shows entries with metadata and remembers the order for navigation', async () => {
    renderRoute(<UnreadPage />, { at: '/unread' })
    expect(await screen.findByRole('link', { name: 'First' })).toHaveAttribute('href', '/entry/1')
    expect(screen.getByRole('heading', { name: /Unread\s*\(7\)/ })).toBeInTheDocument()
    expect(db.listEntries).toHaveBeenCalledWith({ view: 'unread', page: 0 })
    const first = screen.getByRole('link', { name: 'First' }).closest('article') as HTMLElement
    expect(within(first).getByText('4 min read')).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: 'Dev' })).toHaveAttribute('href', '/category/3')
    expect(within(first).getByRole('link', { name: 'Comments' })).toHaveAttribute('href', 'https://c.org/1')
    const second = screen.getByRole('link', { name: 'Second' }).closest('article') as HTMLElement
    expect(second).toHaveClass('item-read')
    expect(within(second).getByRole('link', { name: 'https://site.org' })).toBeInTheDocument()
    expect(within(second).queryByRole('link', { name: 'Original' })).toBeNull()
    expect(neighbours(2)).toEqual({ prev: 1, next: 3, back: '/unread' })
  })

  it('hides reading time when disabled', async () => {
    saveSettings({ showReadingTime: false })
    renderRoute(<UnreadPage />)
    await screen.findByText('First')
    expect(screen.queryByText(/min read/)).toBeNull()
  })

  it('toggles read and starred state optimistically', async () => {
    const { user } = renderRoute(<UnreadPage />)
    const first = (await screen.findByRole('link', { name: 'First' })).closest('article') as HTMLElement
    const counters = dataStore.get().counters
    await user.click(within(first).getByRole('button', { name: 'Mark as read' }))
    expect(db.setEntryStatus).toHaveBeenCalledWith([1], 'read')
    expect(within(first).getByRole('button', { name: 'Mark as unread' })).toBeInTheDocument()
    expect(dataStore.get().counters).toBe(counters + 1)
    await user.click(within(first).getByRole('button', { name: 'Mark as unread' }))
    expect(db.setEntryStatus).toHaveBeenLastCalledWith([1], 'unread')
    await user.click(within(first).getByRole('button', { name: '☆ Star' }))
    expect(db.setEntryStarred).toHaveBeenCalledWith(1, true)
    expect(within(first).getByRole('button', { name: '★ Unstar' })).toBeInTheDocument()
  })

  it('marks the page or everything as read', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { user } = renderRoute(<UnreadPage />)
    await user.click(await screen.findByRole('button', { name: 'Mark this page as read' }))
    expect(db.setEntryStatus).toHaveBeenCalledWith([1, 3], 'read')
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(db.markAllRead).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(db.markAllRead).toHaveBeenCalledWith({ feedId: undefined, categoryId: undefined })
  })

  it('marks the page as read from the bottom and shows the next entries', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const { user } = renderRoute(<UnreadPage />, { at: '/unread?page=2' })
    await user.click(await screen.findByRole('button', { name: 'Mark page as read and show next ›' }))
    expect(db.setEntryStatus).toHaveBeenCalledWith([1, 3], 'read')
    // 7 unread - 2 marked leaves 5, which fit on pages 0 and 1.
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/unread?page=1'))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('moves to the next page after marking a page as read where read entries stay listed', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const { user } = renderRoute(<StarredPage />, { at: '/starred' })
    await user.click(await screen.findByRole('button', { name: 'Mark page as read and show next ›' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/starred?page=1'))
  })

  it('offers no next page when the last unread entries are on screen', async () => {
    db.listEntries.mockResolvedValue({ items, total: 2 })
    renderRoute(<UnreadPage />, { at: '/unread' })
    expect(await screen.findByRole('button', { name: 'Mark page as read' })).toBeInTheDocument()
  })

  it('explains unread entries hidden from the global list', async () => {
    db.listEntries.mockResolvedValue({ items: [], total: 0 })
    db.countUnread.mockResolvedValue({ visible: 0, hidden: 1317 })
    renderRoute(<UnreadPage />, { at: '/unread' })
    expect(await screen.findByText(/1317 unread entries are in feeds hidden from this list/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute('href', '/categories')
  })

  it('paginates', async () => {
    const { user } = renderRoute(<UnreadPage />, { at: '/unread' })
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Next ›' }))
    await waitFor(() => expect(db.listEntries).toHaveBeenLastCalledWith({ view: 'unread', page: 1 }))
    expect(screen.getByTestId('location')).toHaveTextContent('/unread?page=1')
    await user.click(await screen.findByRole('link', { name: '‹ Previous' }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/unread$/)
  })

  it('supports keyboard navigation', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { user } = renderRoute(<UnreadPage />, { at: '/unread' })
    await screen.findByText('First')
    const selected = () => document.querySelector('.item.selected')?.querySelector('.item-title a')?.textContent
    expect(selected()).toBe('First')
    await user.keyboard('jj')
    expect(selected()).toBe('Third')
    await user.keyboard('j')
    expect(selected()).toBe('Third')
    await user.keyboard('{ArrowUp}k')
    expect(selected()).toBe('First')
    await user.keyboard('k{ArrowDown}')
    expect(selected()).toBe('Second')
    await user.keyboard('m')
    expect(db.setEntryStatus).toHaveBeenLastCalledWith([2], 'unread')
    await user.keyboard('s')
    expect(db.setEntryStarred).toHaveBeenLastCalledWith(2, false)
    await user.keyboard('v')
    expect(open).not.toHaveBeenCalled()
    await user.keyboard('k')
    await user.keyboard('v')
    expect(open).toHaveBeenCalledWith('https://example.org/post', '_blank', 'noopener,noreferrer')
    await user.keyboard('A')
    expect(db.setEntryStatus).toHaveBeenLastCalledWith([1, 2, 3], 'read')
    await user.keyboard('p')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/unread$/)
    await user.keyboard('n')
    expect(screen.getByTestId('location')).toHaveTextContent('/unread?page=1')
    await user.keyboard('p')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/unread$/)
    await screen.findByText('First')
    await user.click(screen.getByText('Feed A'))
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent('/feed/1')
  })

  it('opens the selected entry with o and ignores keys without entries', async () => {
    const { user } = renderRoute(<UnreadPage />, { at: '/unread' })
    await screen.findByText('First')
    await user.keyboard('o')
    expect(screen.getByTestId('location')).toHaveTextContent('/entry/1')
  })

  it('ignores entry shortcuts on an empty list', async () => {
    db.listEntries.mockResolvedValue({ items: [], total: 0 })
    const { user } = renderRoute(<UnreadPage />, { at: '/unread' })
    expect(await screen.findByText('There are no unread entries.')).toBeInTheDocument()
    await user.keyboard('omsvn{Enter}')
    expect(db.setEntryStatus).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent('/unread')
    expect(screen.queryByRole('button', { name: 'Mark this page as read' })).toBeNull()
  })

  it('shows errors with retry', async () => {
    db.listEntries.mockRejectedValueOnce(new Error('JWT expired'))
    const { user } = renderRoute(<UnreadPage />)
    expect(await screen.findByText(/JWT expired/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('First')).toBeInTheDocument()
  })

  it('renders the starred, history and search views', async () => {
    renderRoute(<StarredPage />)
    await screen.findByRole('heading', { name: /Starred/ })
    expect(db.listEntries).toHaveBeenLastCalledWith({ view: 'starred', page: 0 })
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull()

    renderRoute(<HistoryPage />)
    await screen.findByRole('heading', { name: /History/ })
    expect(db.listEntries).toHaveBeenLastCalledWith({ view: 'history', page: 0 })

    renderRoute(<SearchPage />, { at: '/search?q=bike' })
    expect(await screen.findByRole('heading', { name: /Search: bike/ })).toBeInTheDocument()
    expect(db.listEntries).toHaveBeenLastCalledWith({ view: 'search', search: 'bike', page: 0 })
  })

  it('searches for nothing without a query', async () => {
    renderRoute(<SearchPage />, { at: '/search' })
    expect(await screen.findByRole('heading', { name: /Search:/ })).toBeInTheDocument()
    expect(db.listEntries).toHaveBeenLastCalledWith({ view: 'search', search: '', page: 0 })
  })
})

describe('feed and category entry lists', () => {
  it('shows feed errors and toggles between unread and all entries', async () => {
    db.getFeed.mockResolvedValue({ id: 4, title: 'Bikes', parsing_error_msg: 'HTTP 500', parsing_error_count: 2 })
    const { user } = renderRoute(<FeedEntriesPage />, { path: '/feed/:id', at: '/feed/4' })
    expect(await screen.findByText('Last refresh failed (2×): HTTP 500')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /Bikes/ })).toBeInTheDocument()
    expect(db.listEntries).toHaveBeenLastCalledWith({ view: 'unread', feedId: 4, status: 'any', page: 0 })
    await user.click(screen.getByRole('link', { name: 'Show all entries' }))
    await waitFor(() => expect(db.listEntries).toHaveBeenLastCalledWith({ view: 'all', feedId: 4, status: 'any', page: 0 }))
    expect(screen.getByRole('link', { name: 'Show only unread' })).toHaveAttribute('href', '/feed/4')
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/feed/4/edit')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refresh.refreshAll).toHaveBeenCalledWith({ feedIds: [4] })
    refreshStore.set({ running: true })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled())
    refreshStore.set({ running: false })
  })

  it('uses a generic title before the feed loads and marks a feed as read', async () => {
    db.getFeed.mockReturnValue(new Promise(() => undefined))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = renderRoute(<FeedEntriesPage />, { path: '/feed/:id', at: '/feed/4' })
    expect(await screen.findByRole('heading', { name: /^Feed/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(db.markAllRead).toHaveBeenCalledWith({ feedId: 4, categoryId: undefined })
  })

  it('lists category entries', async () => {
    db.listCategories.mockResolvedValue([{ id: 3, title: 'Dev' }])
    const { user } = renderRoute(<CategoryEntriesPage />, { path: '/category/:id', at: '/category/3' })
    expect(await screen.findByRole('heading', { name: /Dev/ })).toBeInTheDocument()
    expect(db.listEntries).toHaveBeenLastCalledWith({ view: 'unread', categoryId: 3, status: 'any', page: 0 })
    await user.click(screen.getByRole('link', { name: 'Show all entries' }))
    await waitFor(() => expect(db.listEntries).toHaveBeenLastCalledWith({ view: 'all', categoryId: 3, status: 'any', page: 0 }))
    expect(screen.getByRole('link', { name: 'Show only unread' })).toBeInTheDocument()
  })

  it('uses a generic title for unknown categories', async () => {
    renderRoute(<CategoryEntriesPage />, { path: '/category/:id', at: '/category/9' })
    expect(await screen.findByRole('heading', { name: /Category/ })).toBeInTheDocument()
  })
})
