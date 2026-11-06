import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { listEntries, markAllRead, setEntryStarred, setEntryStatus, type EntryQuery } from '../lib/db'
import { useAsync, useHotkeys } from '../lib/hooks'
import { rememberList } from '../lib/navigation'
import { useSettings } from '../lib/settings'
import { bumpCounters, bumpRevision } from '../lib/store'
import { fullDate, timeAgo } from '../lib/time'
import type { EntryListItem } from '../lib/types'
import { FeedIcon } from './FeedIcon'

interface Props {
  title: string
  query: Omit<EntryQuery, 'page'>
  emptyText?: string
  actions?: React.ReactNode
}

export function EntryList({ title, query, emptyText = 'There are no entries.', actions }: Props) {
  const settings = useSettings()
  const location = useLocation()
  const navigate = useNavigate()
  const page = Number(new URLSearchParams(location.search).get('page') || 0)
  const key = JSON.stringify(query)
  const { data, error, loading, reload } = useAsync(() => listEntries({ ...query, page }), `${key}|${page}|${settings.entriesPerPage}|${settings.sortDirection}`)
  const [items, setItems] = useState<EntryListItem[]>([])
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    setItems(data?.items || [])
    setSelected(0)
  }, [data])

  useEffect(() => {
    rememberList((data?.items || []).map((item) => item.id), location.pathname + location.search)
  }, [data, location.pathname, location.search])

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / settings.entriesPerPage))
  const pageLink = (target: number) => {
    const params = new URLSearchParams(location.search)
    if (target) params.set('page', String(target))
    else params.delete('page')
    const search = params.toString()
    return `${location.pathname}${search ? `?${search}` : ''}`
  }

  const patch = (id: number, change: Partial<EntryListItem>) => setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)))

  const toggleRead = async (item: EntryListItem) => {
    const status = item.status === 'read' ? 'unread' : 'read'
    patch(item.id, { status })
    await setEntryStatus([item.id], status)
    bumpCounters()
  }

  const toggleStar = async (item: EntryListItem) => {
    patch(item.id, { starred: !item.starred })
    await setEntryStarred(item.id, !item.starred)
  }

  const markPageRead = async () => {
    const ids = items.filter((item) => item.status === 'unread').map((item) => item.id)
    await setEntryStatus(ids, 'read')
    bumpRevision()
  }

  const markEverythingRead = async () => {
    if (!confirm('Mark all entries as read?')) return
    await markAllRead({ feedId: query.feedId, categoryId: query.categoryId })
    bumpRevision()
  }

  const current = items[selected]
  useHotkeys(
    {
      j: () => setSelected((value) => Math.min(items.length - 1, value + 1)),
      ArrowDown: () => setSelected((value) => Math.min(items.length - 1, value + 1)),
      k: () => setSelected((value) => Math.max(0, value - 1)),
      ArrowUp: () => setSelected((value) => Math.max(0, value - 1)),
      o: () => current && navigate(`/entry/${current.id}`),
      Enter: () => current && navigate(`/entry/${current.id}`),
      v: () => current?.url && window.open(current.url, '_blank', 'noopener,noreferrer'),
      m: () => current && void toggleRead(current),
      s: () => current && void toggleStar(current),
      A: () => void markPageRead(),
      n: () => page < totalPages - 1 && navigate(pageLink(page + 1)),
      p: () => page > 0 && navigate(pageLink(page - 1)),
    },
  )

  useEffect(() => {
    document.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const showMarkAll = useMemo(() => query.view === 'unread' || query.view === 'all', [query.view])

  return (
    <section>
      <div className="page-header">
        <h1>
          {title}
          {data ? <span className="count"> ({data.total})</span> : null}
        </h1>
        <ul className="page-actions">
          {items.some((item) => item.status === 'unread') ? (
            <li>
              <button type="button" className="link-button" onClick={() => void markPageRead()}>Mark this page as read</button>
            </li>
          ) : null}
          {showMarkAll ? (
            <li>
              <button type="button" className="link-button" onClick={() => void markEverythingRead()}>Mark all as read</button>
            </li>
          ) : null}
          {actions}
        </ul>
      </div>
      {error ? <p className="alert error">{error} <button className="link-button" onClick={reload}>Retry</button></p> : null}
      {loading && !data ? <p className="muted">Loading…</p> : null}
      {data && !items.length ? <p className="alert">{emptyText}</p> : null}
      <div className="items">
        {items.map((item, index) => (
          <article key={item.id} className={`item ${item.status === 'read' ? 'item-read' : 'item-unread'}${index === selected ? ' selected' : ''}`} onClick={() => setSelected(index)}>
            <div className="item-header">
              <span className="item-title">
                <FeedIcon url={item.feed_icon_url} />
                <Link to={`/entry/${item.id}`}>{item.title}</Link>
              </span>
              {item.category_title ? <Link to={`/category/${item.category_id}`} className="category">{item.category_title}</Link> : null}
            </div>
            <div className="item-meta">
              <ul className="item-meta-info">
                <li>
                  <Link to={`/feed/${item.feed_id}`}>{item.feed_title || item.feed_site_url}</Link>
                </li>
                <li>
                  <time dateTime={item.published_at} title={fullDate(item.published_at)}>{timeAgo(item.published_at)}</time>
                </li>
                {settings.showReadingTime && item.reading_time ? <li>{item.reading_time} min read</li> : null}
              </ul>
              <ul className="item-meta-icons">
                <li>
                  <button type="button" className="link-button" onClick={() => void toggleRead(item)}>{item.status === 'read' ? 'Mark as unread' : 'Mark as read'}</button>
                </li>
                <li>
                  <button type="button" className="link-button" onClick={() => void toggleStar(item)}>{item.starred ? '★ Unstar' : '☆ Star'}</button>
                </li>
                {item.url ? (
                  <li>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">Original</a>
                  </li>
                ) : null}
                {item.comments_url ? (
                  <li>
                    <a href={item.comments_url} target="_blank" rel="noopener noreferrer">Comments</a>
                  </li>
                ) : null}
              </ul>
            </div>
          </article>
        ))}
      </div>
      {totalPages > 1 ? (
        <nav className="pagination">
          {page > 0 ? <Link to={pageLink(page - 1)}>‹ Previous</Link> : <span className="muted">‹ Previous</span>}
          <span className="muted">Page {page + 1} of {totalPages}</span>
          {page < totalPages - 1 ? <Link to={pageLink(page + 1)}>Next ›</Link> : <span className="muted">Next ›</span>}
        </nav>
      ) : null}
    </section>
  )
}
