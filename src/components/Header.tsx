import { useState, type FormEvent } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { countUnread } from '../lib/db'
import { useAsync, useHotkeys } from '../lib/hooks'
import { refreshAll, refreshStore } from '../lib/refresh'
import { dataStore } from '../lib/store'

export function Header() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const refresh = refreshStore.use()
  const { counters: counterRevision } = dataStore.use()
  const { data: counts } = useAsync(countUnread, counterRevision)
  const unread = counts?.visible ?? 0

  useHotkeys(
    {
      '/': () => document.getElementById('search-input')?.focus(),
      R: () => void refreshAll({ force: true }),
      '?': () => navigate('/shortcuts'),
    },
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }

  return (
    <>
      <header className="header">
        <nav className="nav">
          <NavLink to="/unread" className="logo">RSS</NavLink>
          <NavLink to="/unread">Unread{unread ? <span className="count">({unread})</span> : null}</NavLink>
          <NavLink to="/starred">Starred</NavLink>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/feeds">Feeds</NavLink>
          <NavLink to="/categories">Categories</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <div className="header-tools">
        <form onSubmit={submit} className="search-form" role="search">
          <input id="search-input" type="search" placeholder="Search…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </form>
        <button type="button" className="link-button" disabled={refresh.running} onClick={() => void refreshAll({ force: true })} title="Refresh all feeds (R)">
          {refresh.running ? (refresh.total ? `Refreshing ${refresh.done}/${refresh.total}` : 'Refreshing…') : 'Refresh'}
        </button>
      </div>
      {refresh.message && !refresh.running ? <div className="refresh-status">{refresh.message}</div> : null}
    </>
  )
}
