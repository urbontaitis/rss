import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('settings', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.restoreAllMocks())

  it('loads defaults and merges stored values', async () => {
    localStorage.setItem('rss.settings', JSON.stringify({ entriesPerPage: 20, unknown: true }))
    const { getSettings, defaultSettings } = await import('../../lib/settings')
    expect(getSettings()).toMatchObject({ ...defaultSettings, entriesPerPage: 20 })
  })

  it('falls back to defaults for broken storage', async () => {
    localStorage.setItem('rss.settings', '{broken')
    const { getSettings, defaultSettings } = await import('../../lib/settings')
    expect(getSettings()).toEqual(defaultSettings)
  })

  it('saves, notifies hooks and clears', async () => {
    const { saveSettings, clearSettings, useSettings, hasConnection, defaultSettings } = await import('../../lib/settings')
    const { result } = renderHook(() => useSettings())
    expect(hasConnection()).toBe(false)
    act(() => {
      saveSettings({ supabaseUrl: 'https://p.supabase.co', supabaseKey: 'k' })
    })
    expect(result.current.supabaseUrl).toBe('https://p.supabase.co')
    expect(hasConnection()).toBe(true)
    expect(JSON.parse(localStorage.getItem('rss.settings') || '{}').supabaseKey).toBe('k')
    act(() => clearSettings())
    expect(result.current).toEqual(defaultSettings)
    expect(localStorage.getItem('rss.settings')).toBeNull()
  })

  it('keeps working when storage is unavailable', async () => {
    const { saveSettings, clearSettings, getSettings } = await import('../../lib/settings')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(saveSettings({ entriesPerPage: 7 }).entriesPerPage).toBe(7)
    clearSettings()
    expect(getSettings().entriesPerPage).toBe(50)
  })
})
