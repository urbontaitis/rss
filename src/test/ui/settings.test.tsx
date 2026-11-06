import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeServerSettings } from '../fixtures'
import { createSupabaseMock } from '../supabaseMock'
import { db, refresh, resetMocks } from './dbMock'
import { renderRoute } from './render'

const supabase = createSupabaseMock()
vi.mock('../../lib/db', () => db)
vi.mock('../../lib/refresh', async (original) => ({ ...(await original<typeof import('../../lib/refresh')>()), ...refresh }))
vi.mock('../../lib/supabase', () => ({ getClient: () => supabase.client, resetClient: vi.fn(), accessToken: vi.fn() }))

const { SettingsPage } = await import('../../pages/Settings')
const { SetupPage } = await import('../../pages/Setup')
const { getSettings, saveSettings } = await import('../../lib/settings')

beforeEach(() => {
  resetMocks()
  Object.values(supabase.client.auth).forEach((fn) => fn.mockClear())
  saveSettings({ supabaseUrl: 'https://p.supabase.co', supabaseKey: 'anon', fetchMode: 'edge', imageProxyTemplate: '', entriesPerPage: 50, refreshIntervalMinutes: 30 })
  db.getServerSettings.mockResolvedValue(makeServerSettings({ block_filter_entry_rules: 'EntryTitle=ad' }))
  db.updateServerSettings.mockImplementation(async (patch) => makeServerSettings(patch))
})

describe('settings page', () => {
  it('shows the connection and signs out', async () => {
    const { user } = renderRoute(<SettingsPage />)
    expect(await screen.findByText('me@example.org')).toBeInTheDocument()
    expect(screen.getByText('https://p.supabase.co')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(supabase.client.auth.signOut).toHaveBeenCalled()
  })

  it('forgets the connection after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    supabase.client.auth.signOut.mockRejectedValueOnce(new Error('offline'))
    supabase.client.auth.getUser.mockResolvedValueOnce({ data: { user: null } } as never)
    const { user } = renderRoute(<SettingsPage />)
    await user.click(screen.getByRole('button', { name: 'Forget connection' }))
    expect(getSettings().supabaseUrl).toBe('https://p.supabase.co')
    await user.click(screen.getByRole('button', { name: 'Forget connection' }))
    await waitFor(() => expect(getSettings().supabaseUrl).toBe(''))
  })

  it('saves browser settings', async () => {
    const { user } = renderRoute(<SettingsPage />)
    const perPage = screen.getByLabelText('Entries per page')
    await user.clear(perPage)
    await user.type(perPage, '200')
    const interval = screen.getByLabelText('Refresh interval while open (minutes)')
    await user.clear(interval)
    await user.type(interval, '15')
    await user.clear(screen.getByLabelText('Parallel requests'))
    await user.type(screen.getByLabelText('Parallel requests'), '3')
    await user.selectOptions(screen.getByLabelText('Entry sorting'), 'asc')
    await user.selectOptions(screen.getByLabelText('Theme'), 'dark')
    await user.click(screen.getByLabelText('Mark entries as read when opened'))
    await user.click(screen.getByLabelText('Show reading time'))
    await user.clear(screen.getByLabelText('Invidious instance'))
    await user.type(screen.getByLabelText('Invidious instance'), 'inv.example')
    await user.click(screen.getByLabelText('Refresh feeds when the app is opened'))
    await user.type(screen.getByLabelText('Default user agent'), 'UA')
    await user.selectOptions(screen.getByLabelText('Fetch method'), 'custom')
    await user.type(screen.getByLabelText('CORS proxy URL template'), 'https://cors.example/?u={{encoded}')
    await user.selectOptions(screen.getByLabelText('Proxy images'), 'all')
    await user.type(screen.getByLabelText('Proxy URL template'), 'https://img.example/{{encoded}')
    expect(screen.getByText('https://img.example/https%3A%2F%2Fexample.org%2Fimage.jpg')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Also proxy audio and video'))
    const [save] = screen.getAllByRole('button', { name: 'Save' })
    await user.click(save)
    expect(screen.getByText('Saved.')).toBeInTheDocument()
    expect(getSettings()).toMatchObject({
      entriesPerPage: 200,
      refreshIntervalMinutes: 15,
      refreshConcurrency: 3,
      sortDirection: 'asc',
      theme: 'dark',
      markReadOnView: false,
      showReadingTime: false,
      invidiousInstance: 'inv.example',
      refreshOnOpen: false,
      defaultUserAgent: 'UA',
      fetchMode: 'custom',
      fetchProxyTemplate: 'https://cors.example/?u={encoded}',
      imageProxyMode: 'all',
      imageProxyTemplate: 'https://img.example/{encoded}',
      imageProxyMedia: false,
    })
    await user.clear(perPage)
    await user.type(perPage, '1')
    expect(screen.queryByText('Saved.')).toBeNull()
    await user.click(save)
    expect(getSettings().entriesPerPage).toBe(200)
  })

  it('saves database settings, validates rules and runs cleanup', async () => {
    db.cleanupEntries.mockResolvedValueOnce(1).mockResolvedValueOnce(3)
    const { user } = renderRoute(<SettingsPage />)
    const block = await screen.findByLabelText('Block rules')
    expect(block).toHaveValue('EntryTitle=ad')
    await user.type(block, 's')
    await user.type(screen.getByLabelText('Keep rules'), 'EntryTag=(')
    expect(screen.getByText('Invalid rules (ignored): EntryTag=(')).toBeInTheDocument()
    const days = screen.getByLabelText('Remove read entries after (days)')
    await user.clear(days)
    await user.type(days, '7')
    await user.click(screen.getByLabelText(/Fetch feeds in the database/))
    await user.click(screen.getAllByRole('button', { name: 'Save' })[1])
    expect(db.updateServerSettings).toHaveBeenCalledWith({ block_filter_entry_rules: 'EntryTitle=ads', keep_filter_entry_rules: 'EntryTag=(', retention_days: 7, server_fetch_enabled: true })
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove old entries now' }))
    expect(await screen.findByText('1 old entry removed.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove old entries now' }))
    expect(await screen.findByText('3 old entries removed.')).toBeInTheDocument()
  })

  it('reports database setting errors', async () => {
    db.updateServerSettings.mockRejectedValueOnce(new Error('denied')).mockRejectedValueOnce('raw')
    const { user } = renderRoute(<SettingsPage />)
    await screen.findByLabelText('Block rules')
    await user.click(screen.getAllByRole('button', { name: 'Save' })[1])
    expect(await screen.findByText('denied')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Save' })[1])
    expect(await screen.findByText('raw')).toBeInTheDocument()
    db.getServerSettings.mockRejectedValue(new Error('relation does not exist'))
    renderRoute(<SettingsPage />)
    expect(await screen.findByText('relation does not exist')).toBeInTheDocument()
  })
})

describe('setup page', () => {
  const fill = async (user: ReturnType<typeof renderRoute>['user'], url = 'https://new.supabase.co/') => {
    await user.clear(screen.getByLabelText('Project URL'))
    await user.type(screen.getByLabelText('Project URL'), url)
    await user.clear(screen.getByLabelText('Publishable (anon) key'))
    await user.type(screen.getByLabelText('Publishable (anon) key'), ' key ')
    await user.type(screen.getByLabelText('Email'), 'me@example.org')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('stores the connection and signs in', async () => {
    supabase.setResponder(() => ({ data: [{ id: 1 }], error: null }))
    const { user } = renderRoute(<SetupPage />)
    expect(screen.getByLabelText('Project URL')).toHaveValue('https://p.supabase.co')
    await fill(user)
    await waitFor(() => expect(supabase.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.org', password: 'secret' }))
    expect(getSettings()).toMatchObject({ supabaseUrl: 'https://new.supabase.co', supabaseKey: 'key' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports authentication and schema problems', async () => {
    supabase.client.auth.signInWithPassword.mockResolvedValueOnce({ error: new Error('Invalid login credentials') } as never)
    const { user } = renderRoute(<SetupPage />)
    await fill(user)
    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()

    supabase.setResponder(() => ({ data: null, error: { message: 'relation "settings" does not exist' } }))
    await user.clear(screen.getByLabelText('Password'))
    await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/Apply the migrations in supabase\/migrations/)).toBeInTheDocument()
  })

  it('rejects invalid project urls', async () => {
    supabase.client.auth.signInWithPassword.mockRejectedValueOnce('raw failure')
    const { user } = renderRoute(<SetupPage />)
    await fill(user, 'https://ok.supabase.co')
    expect(await screen.findByText('raw failure')).toBeInTheDocument()
  })
})
