import { useSyncExternalStore } from 'react'

export type ProxyMode = 'none' | 'http-only' | 'all'
export type FetchMode = 'edge' | 'custom' | 'direct'
export type Theme = 'system' | 'light' | 'dark'

export interface LocalSettings {
  supabaseUrl: string
  supabaseKey: string
  imageProxyTemplate: string
  imageProxyMode: ProxyMode
  imageProxyMedia: boolean
  fetchMode: FetchMode
  fetchProxyTemplate: string
  refreshOnOpen: boolean
  refreshIntervalMinutes: number
  refreshConcurrency: number
  entriesPerPage: number
  sortDirection: 'desc' | 'asc'
  markReadOnView: boolean
  showReadingTime: boolean
  theme: Theme
  defaultUserAgent: string
  invidiousInstance: string
}

export const defaultSettings: LocalSettings = {
  supabaseUrl: '',
  supabaseKey: '',
  imageProxyTemplate: '',
  imageProxyMode: 'none',
  imageProxyMedia: true,
  fetchMode: 'edge',
  fetchProxyTemplate: '',
  refreshOnOpen: true,
  refreshIntervalMinutes: 30,
  refreshConcurrency: 4,
  entriesPerPage: 50,
  sortDirection: 'desc',
  markReadOnView: true,
  showReadingTime: true,
  theme: 'system',
  defaultUserAgent: '',
  invidiousInstance: 'yewtu.be',
}

const storageKey = 'rss.settings'
const listeners = new Set<() => void>()
let current: LocalSettings = load()

function load(): LocalSettings {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { ...defaultSettings }
    return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    return { ...defaultSettings }
  }
}

export function getSettings(): LocalSettings {
  return current
}

export function saveSettings(patch: Partial<LocalSettings>): LocalSettings {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(storageKey, JSON.stringify(current))
  } catch {
    return current
  }
  listeners.forEach((listener) => listener())
  return current
}

export function clearSettings(): void {
  current = { ...defaultSettings }
  try {
    localStorage.removeItem(storageKey)
  } catch {
    current = { ...defaultSettings }
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettings(): LocalSettings {
  return useSyncExternalStore(subscribe, getSettings, getSettings)
}

export function hasConnection(settings: LocalSettings = current): boolean {
  return Boolean(settings.supabaseUrl && settings.supabaseKey)
}
