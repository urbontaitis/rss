import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeEntry, makeFeed } from '../fixtures'
import { createSupabaseMock } from '../supabaseMock'
import { db, refresh, resetMocks } from './dbMock'

const supabase = createSupabaseMock()
vi.mock('../../lib/db', () => db)
vi.mock('../../lib/refresh', async (original) => ({ ...(await original<typeof import('../../lib/refresh')>()), ...refresh }))
vi.mock('../../lib/supabase', () => ({ getClient: () => supabase.client, resetClient: vi.fn(), accessToken: vi.fn() }))

const { App } = await import('../../App')
const { saveSettings, clearSettings } = await import('../../lib/settings')

type AuthCallback = (event: string, session: unknown) => void

beforeEach(() => {
  resetMocks()
  clearSettings()
  window.location.hash = ''
  supabase.client.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } } } as never)
})

describe('app', () => {
  it('shows setup without a connection', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(refresh.startScheduler).not.toHaveBeenCalled()
  })

  it('shows setup when there is no session', async () => {
    saveSettings({ supabaseUrl: 'https://p.supabase.co', supabaseKey: 'k' })
    supabase.client.auth.getSession.mockResolvedValue({ data: { session: null } } as never)
    render(<App />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('opens the reader, starts the scheduler and routes between lazy pages', async () => {
    saveSettings({ supabaseUrl: 'https://p.supabase.co', supabaseKey: 'k', theme: 'dark' })
    const stop = vi.fn()
    refresh.startScheduler.mockReturnValue(stop)
    db.getServerSettings.mockResolvedValue({ block_filter_entry_rules: '', keep_filter_entry_rules: '', retention_days: 60, server_fetch_enabled: false })
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    expect(await screen.findByRole('heading', { name: /Unread/ })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(refresh.startScheduler).toHaveBeenCalledTimes(1)

    for (const [link, heading] of [['Starred', /Starred/], ['History', /History/], ['Feeds', /Feeds/], ['Categories', /Categories/], ['Settings', /Settings/]] as const) {
      await user.click(screen.getByRole('link', { name: link }))
      expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument()
    }
    db.getEntry.mockResolvedValue(makeEntry({ title: 'Lazy entry' }))
    db.getFeed.mockResolvedValue(makeFeed({ title: 'Lazy feed' }))
    for (const [hash, heading] of [['#/entry/10', 'Lazy entry'], ['#/feed/1/edit', 'Edit feed: Lazy feed'], ['#/feeds/add', 'New subscription'], ['#/opml', 'Import / Export'], ['#/shortcuts', 'Keyboard shortcuts'], ['#/nowhere', /Unread/]] as const) {
      act(() => {
        window.location.hash = hash
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })
      expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument()
    }
    act(() => saveSettings({ theme: 'system' }))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('returns to setup when signed out', async () => {
    saveSettings({ supabaseUrl: 'https://p.supabase.co', supabaseKey: 'k' })
    render(<App />)
    await screen.findByRole('heading', { name: /Unread/ })
    const callback = supabase.client.auth.onAuthStateChange.mock.calls.at(-1)?.[0] as unknown as AuthCallback
    act(() => callback('SIGNED_OUT', null))
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('ignores a late session after unmount', async () => {
    saveSettings({ supabaseUrl: 'https://p.supabase.co', supabaseKey: 'k' })
    let resolve: (value: unknown) => void = () => undefined
    supabase.client.auth.getSession.mockReturnValue(new Promise((res) => (resolve = res)) as never)
    const { unmount } = render(<App />)
    unmount()
    await act(async () => resolve({ data: { session: { access_token: 't' } } }))
    await waitFor(() => expect(supabase.client.auth.onAuthStateChange).toHaveBeenCalled())
  })
})
