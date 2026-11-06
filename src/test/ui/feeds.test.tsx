import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCategory, makeFeed, rssFeed } from '../fixtures'
import { db, refresh, resetMocks } from './dbMock'
import { renderRoute } from './render'

const fetchUrl = vi.hoisted(() => vi.fn())
vi.mock('../../lib/db', () => db)
vi.mock('../../lib/refresh', async (original) => ({ ...(await original<typeof import('../../lib/refresh')>()), ...refresh }))
vi.mock('../../lib/fetcher', async (original) => ({ ...(await original<typeof import('../../lib/fetcher')>()), fetchUrl }))

const { FeedsPage } = await import('../../pages/Feeds')
const { AddFeedPage } = await import('../../pages/AddFeed')
const { FeedEditPage } = await import('../../pages/FeedEdit')
const { refreshStore } = await import('../../lib/refresh')

const response = (body: string, extra = {}) => ({ status: 200, url: 'https://site.org/feed', body, etag: '', lastModified: '', contentType: '', ...extra })

beforeEach(() => {
  resetMocks()
  fetchUrl.mockReset()
  refreshStore.set({ running: false })
})

describe('feeds page', () => {
  beforeEach(() => {
    db.listFeeds.mockResolvedValue([
      makeFeed({ id: 1, title: 'Bikes', category_id: 2, checked_at: null }),
      makeFeed({ id: 2, title: '', feed_url: 'https://broken.org/rss', site_url: '', parsing_error_count: 2, parsing_error_msg: 'HTTP 500', disabled: true }),
    ])
    db.listCounters.mockResolvedValue([{ feed_id: 1, category_id: 2, unread: 3, total: 10 }])
    db.listCategories.mockResolvedValue([makeCategory({ id: 2, title: 'Cycling' })])
  })

  it('lists feeds with counters, categories and errors', async () => {
    renderRoute(<FeedsPage />)
    const bikes = (await screen.findByRole('link', { name: 'Bikes' })).closest('article') as HTMLElement
    expect(within(bikes).getByText('(3/10)')).toBeInTheDocument()
    expect(within(bikes).getByRole('link', { name: 'Cycling' })).toHaveAttribute('href', '/category/2')
    expect(within(bikes).getByText('Checked never')).toBeInTheDocument()
    const broken = screen.getByRole('link', { name: 'https://broken.org/rss' }).closest('article') as HTMLElement
    expect(broken).toHaveClass('item-error')
    expect(within(broken).getByText('HTTP 500')).toBeInTheDocument()
    expect(within(broken).getByText('Disabled')).toBeInTheDocument()
    expect(screen.getByText('1 feed(s) have refresh errors.')).toBeInTheDocument()
  })

  it('refreshes and removes feeds', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    db.deleteFeed.mockResolvedValue(undefined)
    const { user } = renderRoute(<FeedsPage />)
    const bikes = (await screen.findByRole('link', { name: 'Bikes' })).closest('article') as HTMLElement
    await user.click(within(bikes).getByRole('button', { name: 'Refresh' }))
    expect(refresh.refreshAll).toHaveBeenCalledWith({ feedIds: [1] })
    await user.click(screen.getByRole('button', { name: 'Refresh all feeds' }))
    expect(refresh.refreshAll).toHaveBeenLastCalledWith({ force: true })
    await user.click(within(bikes).getByRole('button', { name: 'Remove' }))
    expect(db.deleteFeed).not.toHaveBeenCalled()
    await user.click(within(bikes).getByRole('button', { name: 'Remove' }))
    expect(confirm).toHaveBeenLastCalledWith('Remove "Bikes" and all its entries?')
    expect(db.deleteFeed).toHaveBeenCalledWith(1)
  })

  it('invites to subscribe when empty and shows errors', async () => {
    db.listFeeds.mockResolvedValue([])
    renderRoute(<FeedsPage />)
    expect(await screen.findByText(/You don't have any subscriptions/)).toBeInTheDocument()
    db.listFeeds.mockRejectedValue(new Error('offline'))
    renderRoute(<FeedsPage />)
    expect(await screen.findByText('offline')).toBeInTheDocument()
  })
})

describe('add feed page', () => {
  beforeEach(() => {
    db.listCategories.mockResolvedValue([makeCategory({ id: 2, title: 'Cycling' })])
    db.createFeed.mockImplementation(async (feed) => ({ id: 7, ...feed }))
  })

  it('subscribes to a feed url directly with options', async () => {
    fetchUrl.mockResolvedValue(response(rssFeed, { url: 'https://site.org/final-feed' }))
    const { user } = renderRoute(<AddFeedPage />, { at: '/feeds/add' })
    await user.type(screen.getByLabelText('URL'), 'site.org/feed')
    await user.selectOptions(await screen.findByLabelText('Category'), 'Cycling')
    await user.click(screen.getByLabelText('Fetch original content'))
    await user.click(screen.getByLabelText('Advanced options'))
    await user.type(screen.getByLabelText('User agent'), 'UA')
    await user.type(screen.getByLabelText('Feed username'), 'u')
    await user.type(screen.getByLabelText('Feed password'), 'p')
    await user.click(screen.getByRole('button', { name: 'Find a subscription' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/feed/7?all=1'))
    expect(fetchUrl).toHaveBeenCalledWith('https://site.org/feed', { userAgent: 'UA', username: 'u', password: 'p' })
    expect(db.createFeed).toHaveBeenCalledWith({ feed_url: 'https://site.org/final-feed', category_id: 2, crawler: true, user_agent: 'UA', username: 'u', password: 'p' })
    expect(refresh.refreshAll).toHaveBeenCalledWith({ feedIds: [7] })
  })

  it('discovers a single feed from a page', async () => {
    fetchUrl.mockResolvedValue(response('<html><head><link rel="alternate" type="application/rss+xml" href="/rss"></head></html>', { url: '' }))
    const { user } = renderRoute(<AddFeedPage />, { at: '/feeds/add' })
    await user.type(screen.getByLabelText('URL'), 'https://site.org/')
    await user.click(screen.getByRole('button', { name: 'Find a subscription' }))
    await waitFor(() => expect(db.createFeed).toHaveBeenCalledWith(expect.objectContaining({ feed_url: 'https://site.org/rss', category_id: null })))
  })

  it('lets the user choose between several feeds', async () => {
    fetchUrl.mockResolvedValue(response('<html><head><link rel="alternate" type="application/rss+xml" title="Posts" href="/posts.xml"><link rel="alternate" type="application/atom+xml" title="Comments" href="/comments.xml"></head></html>', { url: 'https://site.org/' }))
    db.createFeed.mockRejectedValueOnce(new Error('duplicate key')).mockImplementation(async (feed) => ({ id: 8, ...feed }))
    const { user } = renderRoute(<AddFeedPage />, { at: '/feeds/add' })
    await user.type(screen.getByLabelText('URL'), 'https://site.org/')
    await user.click(screen.getByRole('button', { name: 'Find a subscription' }))
    await user.click(await screen.findByRole('button', { name: 'Comments' }))
    expect(await screen.findByText('Error: duplicate key')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Posts' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/feed/8?all=1'))
  })

  it.each([
    [response('', { status: 404 }), 'HTTP 404'],
    [response('<html></html>'), 'No feed found at this address.'],
  ])('reports problems (%#)', async (result, message) => {
    fetchUrl.mockResolvedValue(result)
    const { user } = renderRoute(<AddFeedPage />, { at: '/feeds/add' })
    await user.type(screen.getByLabelText('URL'), 'https://site.org/')
    await user.click(screen.getByRole('button', { name: 'Find a subscription' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('reports non error rejections', async () => {
    fetchUrl.mockRejectedValue('offline')
    const { user } = renderRoute(<AddFeedPage />, { at: '/feeds/add' })
    await user.type(screen.getByLabelText('URL'), 'https://site.org/')
    await user.click(screen.getByRole('button', { name: 'Find a subscription' }))
    expect(await screen.findByText('offline')).toBeInTheDocument()
  })
})

describe('feed edit page', () => {
  const feed = makeFeed({ id: 4, title: 'Bikes', category_id: 2, parsing_error_msg: 'Last error', block_filter_entry_rules: 'EntryTitle=Second' })
  const edit = () => renderRoute(<FeedEditPage />, { path: '/feed/:id/edit', at: '/feed/4/edit' })

  beforeEach(() => {
    db.getFeed.mockResolvedValue(feed)
    db.listCategories.mockResolvedValue([makeCategory({ id: 2, title: 'Cycling' })])
    db.updateFeed.mockResolvedValue(feed)
    db.getServerSettings.mockResolvedValue({ block_filter_entry_rules: '', keep_filter_entry_rules: '' })
  })

  it('saves changes without read only columns', async () => {
    const { user } = edit()
    const title = await screen.findByLabelText('Title')
    expect(screen.getByText('Last error')).toBeInTheDocument()
    await user.clear(title)
    await user.type(title, 'Bicycles')
    await user.selectOptions(screen.getByLabelText('Category'), 'None')
    await user.click(screen.getByLabelText('Fetch original content'))
    await user.type(screen.getByLabelText('Rewrite rules'), 'nl2br')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/feed/4'))
    const patch = db.updateFeed.mock.calls[0][1]
    expect(db.updateFeed.mock.calls[0][0]).toBe(4)
    expect(patch).toMatchObject({ title: 'Bicycles', category_id: null, crawler: true, rewrite_rules: 'nl2br' })
    expect(patch).not.toHaveProperty('id')
    expect(patch).not.toHaveProperty('created_at')
  })

  it('reports save errors and invalid rules', async () => {
    db.updateFeed.mockRejectedValueOnce(new Error('violates check constraint')).mockRejectedValueOnce('raw')
    const { user } = edit()
    await user.type(await screen.findByLabelText('Keep rules'), 'EntryTitle=(')
    expect(screen.getByText('Invalid rules (ignored): EntryTitle=(')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Category'), 'Cycling')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(await screen.findByText('violates check constraint')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(await screen.findByText('raw')).toBeInTheDocument()
  })

  it('removes the feed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    db.deleteFeed.mockResolvedValue(undefined)
    const { user } = edit()
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(db.deleteFeed).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/feeds'))
    expect(db.deleteFeed).toHaveBeenCalledWith(4)
  })

  it('previews filter and scraper rules', async () => {
    fetchUrl.mockResolvedValueOnce(response(rssFeed))
    refresh.scrapeOriginal.mockResolvedValueOnce('<p>Scraped <img src="https://i.org/x.jpg" title="cap"></p>').mockRejectedValueOnce(new Error('HTTP 403')).mockRejectedValueOnce('raw')
    const { user } = edit()
    await user.type(await screen.findByLabelText('Rewrite rules'), 'add_image_title')
    await user.click(screen.getByRole('button', { name: 'Preview scraper' }))
    expect(screen.getByText('Run the filter preview first to pick an entry.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview filters' }))
    expect(await screen.findByText('✓ First')).toBeInTheDocument()
    expect(screen.getByText('✗ Second & bold')).toHaveClass('blocked')
    await user.click(screen.getByRole('button', { name: 'Preview scraper' }))
    expect(await screen.findByText('cap')).toBeInTheDocument()
    expect(refresh.scrapeOriginal).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }), 'https://example.org/posts/1')
    await user.click(screen.getByRole('button', { name: 'Preview scraper' }))
    expect(await screen.findByText('HTTP 403')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview scraper' }))
    expect(await screen.findByText('raw')).toBeInTheDocument()
  })

  it('reports preview failures', async () => {
    fetchUrl.mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce('raw')
    const { user } = edit()
    await user.click(await screen.findByRole('button', { name: 'Preview filters' }))
    expect(await screen.findByText('timeout')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview filters' }))
    expect(await screen.findByText('raw')).toBeInTheDocument()
  })

  it('shows load errors', async () => {
    db.getFeed.mockRejectedValue(new Error('Not found'))
    edit()
    expect(await screen.findByText('Not found')).toBeInTheDocument()
  })
})
