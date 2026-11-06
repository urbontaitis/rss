import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeEntry, makeFeed } from '../fixtures'
import { db, refresh, resetMocks } from './dbMock'
import { renderRoute } from './render'

vi.mock('../../lib/db', () => db)
vi.mock('../../lib/refresh', async (original) => ({ ...(await original<typeof import('../../lib/refresh')>()), ...refresh }))

const { EntryPage } = await import('../../pages/Entry')
const { saveSettings } = await import('../../lib/settings')
const { rememberList } = await import('../../lib/navigation')

const open = (id = 10) => renderRoute(<EntryPage />, { path: '/entry/:id', at: `/entry/${id}` })

beforeEach(() => {
  resetMocks()
  saveSettings({ markReadOnView: true, showReadingTime: true, imageProxyMode: 'all', imageProxyTemplate: 'https://proxy.example/?u={encoded}', imageProxyMedia: true })
  db.getEntry.mockResolvedValue(makeEntry({ tags: ['bikes'], comments_url: 'https://c.org/1' }))
  db.getFeed.mockResolvedValue(makeFeed({ title: 'Cycling', icon_url: 'https://example.org/icon.png' }))
  rememberList([9, 10, 11], '/unread?page=1')
})

describe('entry page', () => {
  it('renders sanitized proxied content and metadata, and marks the entry read', async () => {
    open()
    expect(await screen.findByRole('heading', { name: 'Entry title' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entry title' })).toHaveAttribute('href', 'https://example.org/post')
    expect(screen.getByRole('link', { name: 'Cycling' })).toHaveAttribute('href', '/feed/1')
    expect(screen.getByText(/Jane/)).toBeInTheDocument()
    expect(screen.getByText('bikes')).toBeInTheDocument()
    expect(screen.getByText(/2 min read/)).toBeInTheDocument()
    expect(document.querySelector('.entry-content img')).toHaveAttribute('src', 'https://proxy.example/?u=https%3A%2F%2Fimg.example%2Fa.jpg')
    expect(document.querySelector('.entry-meta img')).toHaveAttribute('src', 'https://proxy.example/?u=https%3A%2F%2Fexample.org%2Ficon.png')
    await waitFor(() => expect(db.setEntryStatus).toHaveBeenCalledWith([10], 'read'))
    expect(await screen.findByRole('button', { name: 'Mark as unread' })).toBeInTheDocument()
  })

  it('does not mark read when disabled and supports titles without links', async () => {
    saveSettings({ markReadOnView: false, showReadingTime: false })
    db.getEntry.mockResolvedValue(makeEntry({ url: '', author: '' }))
    open()
    expect(await screen.findByRole('heading', { name: 'Entry title' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Entry title' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fetch original content' })).toBeNull()
    expect(screen.queryByText(/min read/)).toBeNull()
    expect(db.setEntryStatus).not.toHaveBeenCalled()
  })

  it('does not mark already read entries again', async () => {
    db.getEntry.mockResolvedValue(makeEntry({ status: 'read', starred: true }))
    open()
    expect(await screen.findByRole('button', { name: '★ Unstar' })).toBeInTheDocument()
    expect(db.setEntryStatus).not.toHaveBeenCalled()
  })

  it('toggles read and star', async () => {
    saveSettings({ markReadOnView: false })
    const { user } = open()
    await user.click(await screen.findByRole('button', { name: 'Mark as read' }))
    expect(db.setEntryStatus).toHaveBeenCalledWith([10], 'read')
    await user.click(screen.getByRole('button', { name: 'Mark as unread' }))
    expect(db.setEntryStatus).toHaveBeenLastCalledWith([10], 'unread')
    await user.click(screen.getByRole('button', { name: '☆ Star' }))
    expect(db.setEntryStarred).toHaveBeenCalledWith(10, true)
  })

  it('fetches original content and reports failures', async () => {
    refresh.downloadOriginal.mockResolvedValueOnce('<p>Full article</p>').mockRejectedValueOnce(new Error('Blocked')).mockRejectedValueOnce('raw')
    const { user } = open()
    await user.click(await screen.findByRole('button', { name: 'Fetch original content' }))
    expect(await screen.findByText('Full article')).toBeInTheDocument()
    await user.keyboard('d')
    expect(await screen.findByText('Blocked')).toBeInTheDocument()
    await user.keyboard('d')
    expect(await screen.findByText('raw')).toBeInTheDocument()
  })

  it('shows attachments with players unless disabled', async () => {
    db.getEntry.mockResolvedValue(
      makeEntry({
        content: '<p>Body <img src="https://img.example/in-content.jpg"></p>',
        enclosures: [
          { url: 'https://cdn.example/episode%201.mp3?token=1', type: 'audio/mpeg', length: 1 },
          { url: 'https://cdn.example/clip.mp4', type: 'video/mp4', length: 1 },
          { url: 'https://img.example/in-content.jpg', type: 'image/jpeg', length: 0 },
          { url: 'https://img.example/extra.jpg', type: 'image/jpeg', length: 0 },
          { url: 'https://cdn.example/', type: '', length: 0 },
        ],
      }),
    )
    open()
    expect(await screen.findByText('Attachments (5)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'episode 1.mp3' })).toHaveAttribute('href', 'https://cdn.example/episode%201.mp3?token=1')
    expect(document.querySelector('audio')).toHaveAttribute('src', 'https://proxy.example/?u=https%3A%2F%2Fcdn.example%2Fepisode%25201.mp3%3Ftoken%3D1')
    expect(document.querySelector('video')).toBeInTheDocument()
    expect(document.querySelectorAll('.enclosure img')).toHaveLength(1)
    expect(document.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByRole('link', { name: 'https://cdn.example/' })).toBeInTheDocument()
  })

  it('hides media players for feeds that disable them and skips the proxy for media when asked', async () => {
    saveSettings({ imageProxyMedia: false })
    db.getEntry.mockResolvedValue(makeEntry({ enclosures: [{ url: 'https://cdn.example/a.mp3', type: 'audio/mpeg', length: 1 }] }))
    db.getFeed.mockResolvedValue(makeFeed({ no_media_player: true }))
    open()
    expect(await screen.findByText('Attachments (1)')).toBeInTheDocument()
    expect(document.querySelector('audio')).toBeNull()

    db.getFeed.mockResolvedValue(makeFeed())
    open()
    await waitFor(() => expect(document.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example/a.mp3'))
  })

  it('navigates between entries with links and keys', async () => {
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
    const { user } = open()
    await screen.findByRole('heading', { name: 'Entry title' })
    expect(screen.getByRole('link', { name: '‹ Previous' })).toHaveAttribute('href', '/entry/9')
    expect(screen.getByRole('link', { name: 'Back to list' })).toHaveAttribute('href', '/unread?page=1')
    await user.keyboard('v')
    expect(windowOpen).toHaveBeenCalledWith('https://example.org/post', '_blank', 'noopener,noreferrer')
    await user.keyboard('ms')
    expect(db.setEntryStarred).toHaveBeenCalledWith(10, true)
    for (const [key, target] of [['j', '/entry/11'], ['k', '/entry/10'], ['n', '/entry/11'], ['p', '/entry/10'], ['{ArrowRight}', '/entry/11'], ['{ArrowLeft}', '/entry/10'], ['u', '/unread?page=1']]) {
      await user.keyboard(key)
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(target))
      if (target !== '/unread?page=1') await screen.findByRole('heading', { name: 'Entry title' })
    }
  })

  it('stays put at the ends of the list', async () => {
    rememberList([10], '/starred')
    const { user } = open()
    await screen.findByRole('heading', { name: 'Entry title' })
    expect(screen.getByText('‹ Previous').tagName).toBe('SPAN')
    expect(screen.getByText('Next ›').tagName).toBe('SPAN')
    await user.keyboard('jknp{ArrowRight}{ArrowLeft}')
    expect(screen.getByTestId('location')).toHaveTextContent('/entry/10')
    await user.keyboard('{Backspace}')
    expect(screen.getByTestId('location')).toHaveTextContent('/starred')
  })

  it('ignores action keys while loading and shows load errors', async () => {
    db.getEntry.mockRejectedValue(new Error('Not found'))
    const { user } = open()
    await user.keyboard('msdv')
    expect(await screen.findByText('Not found')).toBeInTheDocument()
    expect(db.setEntryStatus).not.toHaveBeenCalled()
    expect(refresh.downloadOriginal).not.toHaveBeenCalled()
  })

  it('shares entries when supported', async () => {
    const share = vi.fn().mockRejectedValue(new Error('cancelled'))
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    const { user } = open()
    await user.click(await screen.findByRole('button', { name: 'Share' }))
    expect(share).toHaveBeenCalledWith({ title: 'Entry title', url: 'https://example.org/post' })
    delete (navigator as { share?: unknown }).share
  })
})
