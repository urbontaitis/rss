import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { Header } from './components/Header'
import { startScheduler } from './lib/refresh'
import { hasConnection, useSettings } from './lib/settings'
import { getClient } from './lib/supabase'
import { AddFeedPage } from './pages/AddFeed'
import { CategoriesPage } from './pages/Categories'
import { EntryPage } from './pages/Entry'
import { CategoryEntriesPage, FeedEntriesPage, HistoryPage, SearchPage, StarredPage, UnreadPage } from './pages/Entries'
import { FeedEditPage } from './pages/FeedEdit'
import { FeedsPage } from './pages/Feeds'
import { OpmlPage } from './pages/Opml'
import { SettingsPage } from './pages/Settings'
import { SetupPage } from './pages/Setup'
import { ShortcutsPage } from './pages/Shortcuts'

function useTheme(theme: string) {
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
}

function useSession(connected: boolean, connectionKey: string) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    if (!connected) {
      setSession(null)
      return
    }
    const client = getClient()
    client.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = client.auth.onAuthStateChange((_event, value) => setSession(value))
    return () => data.subscription.unsubscribe()
  }, [connected, connectionKey])
  return session
}

function Reader() {
  useEffect(() => startScheduler(), [])
  return (
    <div className="layout">
      <Header />
      <main className="main">
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
