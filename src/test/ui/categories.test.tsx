import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCategory, makeFeed } from '../fixtures'
import { db, refresh, resetMocks } from './dbMock'
import { renderRoute } from './render'

vi.mock('../../lib/db', () => db)
vi.mock('../../lib/refresh', async (original) => ({ ...(await original<typeof import('../../lib/refresh')>()), ...refresh }))

const { CategoriesPage } = await import('../../pages/Categories')
const { OpmlPage } = await import('../../pages/Opml')

beforeEach(() => {
  resetMocks()
  db.listCategories.mockResolvedValue([makeCategory({ id: 1, title: 'Dev' }), makeCategory({ id: 2, title: 'Fun', hide_globally: true })])
  db.listCounters.mockResolvedValue([
    { feed_id: 1, category_id: 1, unread: 2, total: 5 },
    { feed_id: 2, category_id: 1, unread: '3', total: 5 },
    { feed_id: 3, category_id: null, unread: 9, total: 9 },
  ])
})

describe('categories page', () => {
  it('lists categories with counts', async () => {
    renderRoute(<CategoriesPage />)
    const dev = (await screen.findByRole('link', { name: 'Dev' })).closest('article') as HTMLElement
    expect(within(dev).getByText('(5)')).toBeInTheDocument()
    expect(within(dev).getByText('2 feed(s)')).toBeInTheDocument()
    const fun = screen.getByRole('link', { name: 'Fun' }).closest('article') as HTMLElement
    expect(within(fun).getByText('Hidden from unread')).toBeInTheDocument()
    expect(within(fun).queryByRole('button', { name: 'Mark all as read' })).toBeNull()
  })

  it('adds categories and reports errors', async () => {
    db.createCategory.mockRejectedValueOnce(new Error('duplicate key')).mockRejectedValueOnce('raw').mockResolvedValue(makeCategory())
    const { user } = renderRoute(<CategoriesPage />)
    const input = await screen.findByPlaceholderText('New category')
    await user.type(input, 'Dev')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('duplicate key')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('raw')).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, ' Ops ')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(db.createCategory).toHaveBeenLastCalledWith('Ops')
  })

  it('edits, marks read and removes categories', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    db.updateCategory.mockResolvedValue(makeCategory())
    db.deleteCategory.mockResolvedValue(undefined)
    const { user } = renderRoute(<CategoriesPage />)
    const dev = (await screen.findByRole('link', { name: 'Dev' })).closest('article') as HTMLElement
    await user.click(within(dev).getByRole('button', { name: 'Mark all as read' }))
    expect(db.markAllRead).toHaveBeenCalledWith({ categoryId: 1 })

    await user.click(within(screen.getByRole('link', { name: 'Dev' }).closest('article') as HTMLElement).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(within(screen.getByRole('link', { name: 'Dev' }).closest('article') as HTMLElement).getByRole('button', { name: 'Edit' }))
    const title = screen.getByDisplayValue('Dev')
    await user.clear(title)
    await user.type(title, ' Development ')
    await user.click(screen.getByLabelText('Hide in global unread list'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(db.updateCategory).toHaveBeenCalledWith(1, { title: 'Development', hide_globally: true })

    const fun = (await screen.findByRole('link', { name: 'Fun' })).closest('article') as HTMLElement
    await user.click(within(fun).getByRole('button', { name: 'Remove' }))
    expect(db.deleteCategory).not.toHaveBeenCalled()
    await user.click(within(fun).getByRole('button', { name: 'Remove' }))
    expect(db.deleteCategory).toHaveBeenCalledWith(2)
  })
})

describe('OPML page', () => {
  const opml = `<?xml version="1.0"?><opml version="2.0"><body>
    <outline text="Dev"><outline text="A" xmlUrl="https://a.org/rss" htmlUrl="https://a.org"/></outline>
    <outline text="Fun"><outline text="B" xmlUrl="https://b.org/rss"/></outline>
    <outline text="C" xmlUrl="https://c.org/rss"/>
  </body></opml>`

  it('imports feeds into categories and refreshes', async () => {
    db.ensureCategory.mockImplementation(async (title: string, cache: Map<string, unknown>) => {
      expect(cache.get('dev')).toEqual(makeCategory({ id: 1, title: 'Dev' }))
      return title === 'Dev' ? makeCategory({ id: 1 }) : makeCategory({ id: 5, title })
    })
    db.importFeeds.mockResolvedValue(2)
    const { user } = renderRoute(<OpmlPage />)
    await user.upload(screen.getByLabelText('OPML file'), new File([opml], 'feeds.opml', { type: 'text/x-opml' }))
    expect(await screen.findByText('3 feed(s) in 2 categories found.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('Imported 2 new feed(s), 1 already existed.')).toBeInTheDocument()
    expect(db.importFeeds).toHaveBeenCalledWith([
      { feed_url: 'https://a.org/rss', title: 'A', site_url: 'https://a.org', category_id: 1 },
      { feed_url: 'https://b.org/rss', title: 'B', site_url: '', category_id: 5 },
      { feed_url: 'https://c.org/rss', title: 'C', site_url: '', category_id: null },
    ])
    expect(refresh.refreshAll).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('reports invalid files, cleared selections and import failures', async () => {
    db.importFeeds.mockRejectedValueOnce(new Error('permission denied')).mockRejectedValueOnce('raw')
    const { user } = renderRoute(<OpmlPage />)
    const input = screen.getByLabelText('OPML file')
    await user.upload(input, new File(['<opml>'], 'bad.opml'))
    expect(await screen.findByText('Invalid OPML file')).toBeInTheDocument()
    await user.upload(input, new File(['<opml><body><outline text="X" xmlUrl="https://x.org"/></body></opml>'], 'one.opml'))
    expect(await screen.findByText('1 feed(s) in 0 categories found.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('raw')).toBeInTheDocument()
    await user.upload(input, [])
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('shows singular category wording and reports raw parse errors', async () => {
    const { user } = renderRoute(<OpmlPage />)
    await user.upload(screen.getByLabelText('OPML file'), new File(['<opml><body><outline text="D"><outline xmlUrl="https://x.org"/></outline></body></opml>'], 'one.opml'))
    expect(await screen.findByText('1 feed(s) in 1 category found.')).toBeInTheDocument()
    const file = new File(['x'], 'x.opml')
    Object.defineProperty(file, 'text', { value: () => Promise.reject('unreadable') })
    await user.upload(screen.getByLabelText('OPML file'), file)
    expect(await screen.findByText('unreadable')).toBeInTheDocument()
  })

  it('exports subscriptions as a download', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    db.listFeeds.mockResolvedValue([makeFeed({ title: 'A', category_id: 1 })])
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:opml')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { user } = renderRoute(<OpmlPage />)
    await user.click(screen.getByRole('button', { name: 'Export OPML' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const blob = createObjectURL.mock.calls[0][0]
    expect(await blob.text()).toContain('xmlUrl="https://example.org/feed"')
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/^feeds-\d{4}-\d{2}-\d{2}\.opml$/)
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:opml')
    vi.useRealTimers()
  })
})
