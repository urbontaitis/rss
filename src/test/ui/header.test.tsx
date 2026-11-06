import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, refresh, resetMocks } from './dbMock'
import { renderRoute } from './render'

vi.mock('../../lib/db', () => db)
vi.mock('../../lib/refresh', async (original) => ({ ...(await original<typeof import('../../lib/refresh')>()), ...refresh }))

const { Header } = await import('../../components/Header')
const { refreshStore } = await import('../../lib/refresh')
const { bumpCounters } = await import('../../lib/store')

beforeEach(() => {
  resetMocks()
  refreshStore.set({ running: false, message: '', done: 0, total: 0 })
  db.listCounters.mockResolvedValue([
    { feed_id: 1, category_id: null, unread: 3, total: 9 },
    { feed_id: 2, category_id: null, unread: '4', total: 4 },
  ])
})

describe('header', () => {
  it('shows the unread total and refreshes it when counters change', async () => {
    renderRoute(<Header />)
    expect(await screen.findByText('(7)')).toBeInTheDocument()
    db.listCounters.mockResolvedValue([])
    act(() => bumpCounters())
    await waitFor(() => expect(screen.queryByText('(7)')).toBeNull())
  })

  it('searches', async () => {
    const { user } = renderRoute(<Header />)
    await user.type(screen.getByRole('searchbox'), '  gravel bike  {Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=gravel%20bike')
  })

  it('ignores empty searches', async () => {
    const { user } = renderRoute(<Header />)
    await user.type(screen.getByRole('searchbox'), '   {Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  it('refreshes all feeds and shows progress and results', async () => {
    const { user } = renderRoute(<Header />)
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refresh.refreshAll).toHaveBeenCalledWith({ force: true })
    act(() => refreshStore.set({ running: true, done: 2, total: 5 }))
    expect(screen.getByRole('button', { name: 'Refreshing 2/5' })).toBeDisabled()
    act(() => refreshStore.set({ running: false, message: '3 new entries' }))
    expect(screen.getByText('3 new entries')).toBeInTheDocument()
  })

  it('has keyboard shortcuts', async () => {
    const { user } = renderRoute(<Header />)
    await user.keyboard('/')
    expect(screen.getByRole('searchbox')).toHaveFocus()
    await user.keyboard('{Escape}')
    screen.getByRole('searchbox').blur()
    await user.keyboard('R')
    expect(refresh.refreshAll).toHaveBeenCalledWith({ force: true })
    await user.keyboard('?')
    expect(screen.getByTestId('location')).toHaveTextContent('/shortcuts')
  })
})
