import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { Header } from './components/Header'
import { startScheduler } from './lib/refresh'
import { hasConnection, useSettings } from './lib/settings'
import { getClient } from './lib/supabase'
import { CategoryEntriesPage, FeedEntriesPage, HistoryPage, SearchPage, StarredPage, UnreadPage } from './pages/Entries'
import { SetupPage } from './pages/Setup'

const EntryPage = lazy(() => import('./pages/Entry').then((module) => ({ default: module.EntryPage })))
const FeedsPage = lazy(() => import('./pages/Feeds').then((module) => ({ default: module.FeedsPage })))
const AddFeedPage = lazy(() => import('./pages/AddFeed').then((module) => ({ default: module.AddFeedPage })))
const FeedEditPage = lazy(() => import('./pages/FeedEdit').then((module) => ({ default: module.FeedEditPage })))
const CategoriesPage = lazy(() => import('./pages/Categories').then((module) => ({ default: module.CategoriesPage })))
const OpmlPage = lazy(() => import('./pages/Opml').then((module) => ({ default: module.OpmlPage })))
const SettingsPage = lazy(() => import('./pages/Settings').then((module) => ({ default: module.SettingsPage })))
const ShortcutsPage = lazy(() => import('./pages/Shortcuts').then((module) => ({ default: module.ShortcutsPage })))

export function useTheme(theme: string) {
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
}

export function useSession(connected: boolean, connectionKey: string): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    if (!connected) {
      setSession(null)
      return
    }
    let active = true
    const client = getClient()
    client.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session)
    })
    const { data } = client.auth.onAuthStateChange((_event, value) => setSession(value))
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [connected, connectionKey])
  return session
}

export function Reader() {
  useEffect(() => startScheduler(), [])
  return (
    <div className="layout">
      <Header />
      <main className="main">
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Routes>
            <Route path="/" element={<Navigate to="/unread" replace />} />
            <Route path="/unread" element={<UnreadPage />} />
            <Route path="/starred" element={<StarredPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/entry/:id" element={<EntryPage />} />
            <Route path="/feeds" element={<FeedsPage />} />
            <Route path="/feeds/add" element={<AddFeedPage />} />
            <Route path="/feed/:id" element={<FeedEntriesPage />} />
            <Route path="/feed/:id/edit" element={<FeedEditPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/category/:id" element={<CategoryEntriesPage />} />
            <Route path="/opml" element={<OpmlPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/shortcuts" element={<ShortcutsPage />} />
            <Route path="*" element={<Navigate to="/unread" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}

export function App() {
  const settings = useSettings()
  useTheme(settings.theme)
  const connected = hasConnection(settings)
  const session = useSession(connected, `${settings.supabaseUrl}|${settings.supabaseKey}`)

  if (session === undefined) return <p className="muted center">Loading…</p>
  if (!connected || !session) return <SetupPage />
  return (
    <HashRouter>
      <Reader />
    </HashRouter>
  )
}
