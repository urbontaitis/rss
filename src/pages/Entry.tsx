import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FeedIcon } from '../components/FeedIcon'
import { getEntry, getFeed, setEntryStarred, setEntryStatus } from '../lib/db'
import { useAsync, useHotkeys } from '../lib/hooks'
import { proxify } from '../lib/mediaProxy'
import { neighbours } from '../lib/navigation'
import { downloadOriginal } from '../lib/refresh'
import { renderContent } from '../lib/sanitize'
import { useSettings } from '../lib/settings'
import { bumpCounters } from '../lib/store'
import { fullDate, timeAgo } from '../lib/time'
import type { Entry } from '../lib/types'

function Enclosures({ entry, noPlayer }: { entry: Entry; noPlayer: boolean }) {
  const settings = useSettings()
  if (!entry.enclosures.length) return null
  const mediaUrl = (url: string) => (settings.imageProxyMedia ? proxify(url, settings) : url)
  return (
    <details className="enclosures" open={entry.enclosures.some((item) => /^(audio|video)\//.test(item.type))}>
      <summary>Attachments ({entry.enclosures.length})</summary>
      {entry.enclosures.map((item) => (
        <div key={item.url} className="enclosure">
          {!noPlayer && item.type.startsWith('audio/') ? <audio controls preload="none" src={mediaUrl(item.url)} /> : null}
          {!noPlayer && item.type.startsWith('video/') ? <video controls preload="none" src={mediaUrl(item.url)} /> : null}
          {item.type.startsWith('image/') && !entry.content.includes(item.url) ? <img src={proxify(item.url, settings)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {decodeURIComponent(item.url.split('/').pop()?.split('?')[0] || item.url)}
          </a>
          {item.type ? <span className="muted"> {item.type}</span> : null}
        </div>
      ))}
    </details>
  )
}

export function EntryPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const settings = useSettings()
  const { data, error } = useAsync(async () => {
    const entry = await getEntry(id)
    const feed = await getFeed(entry.feed_id)
    return { entry, feed }
  }, [id])
  const [entry, setEntry] = useState<Entry>()
  const [busy, setBusy] = useState('')
  const nav = neighbours(id)

  useEffect(() => {
    if (!data) return
    setEntry(data.entry)
    if (settings.markReadOnView && data.entry.status === 'unread') {
      setEntryStatus([data.entry.id], 'read').then(() => {
        setEntry((value) => (value ? { ...value, status: 'read' } : value))
        bumpCounters()
      })
    }
  }, [data])

  const html = useMemo(() => (entry ? renderContent(entry.content, settings) : ''), [entry?.content, settings])

  const toggleRead = async () => {
    if (!entry) return
    const status = entry.status === 'read' ? 'unread' : 'read'
    setEntry({ ...entry, status })
    await setEntryStatus([entry.id], status)
    bumpCounters()
  }

  const toggleStar = async () => {
    if (!entry) return
    setEntry({ ...entry, starred: !entry.starred })
    await setEntryStarred(entry.id, !entry.starred)
  }

  const fetchOriginal = async () => {
    if (!entry || !data) return
    setBusy('Downloading original content…')
    try {
      const content = await downloadOriginal(entry, data.feed)
      setEntry({ ...entry, content })
      setBusy('')
    } catch (err) {
      setBusy(err instanceof Error ? err.message : String(err))
    }
  }

  useHotkeys(
    {
      j: () => nav.next && navigate(`/entry/${nav.next}`),
      n: () => nav.next && navigate(`/entry/${nav.next}`),
      ArrowRight: () => nav.next && navigate(`/entry/${nav.next}`),
      k: () => nav.prev && navigate(`/entry/${nav.prev}`),
      p: () => nav.prev && navigate(`/entry/${nav.prev}`),
      ArrowLeft: () => nav.prev && navigate(`/entry/${nav.prev}`),
      u: () => navigate(nav.back),
      Backspace: () => navigate(nav.back),
      v: () => entry?.url && window.open(entry.url, '_blank', 'noopener,noreferrer'),
      m: () => void toggleRead(),
      s: () => void toggleStar(),
      d: () => void fetchOriginal(),
    },
    [entry, nav.next, nav.prev, nav.back],
  )

  if (error) return <p className="alert error">{error}</p>
  if (!entry || !data) return <p className="muted">Loading…</p>

  return (
    <article className="entry">
      <header className="entry-header">
        <h1 dir="auto">
          {entry.url ? (
            <a href={entry.url} target="_blank" rel="noopener noreferrer">{entry.title}</a>
          ) : (
            entry.title
          )}
        </h1>
        <ul className="entry-actions">
          <li><button type="button" className="link-button" onClick={() => void toggleRead()}>{entry.status === 'read' ? 'Mark as unread' : 'Mark as read'}</button></li>
          <li><button type="button" className="link-button" onClick={() => void toggleStar()}>{entry.starred ? '★ Unstar' : '☆ Star'}</button></li>
          {entry.url ? <li><button type="button" className="link-button" onClick={() => void fetchOriginal()}>Fetch original content</button></li> : null}
          {entry.comments_url ? <li><a href={entry.comments_url} target="_blank" rel="noopener noreferrer">Comments</a></li> : null}
          {'share' in navigator && entry.url ? <li><button type="button" className="link-button" onClick={() => void navigator.share({ title: entry.title, url: entry.url }).catch(() => undefined)}>Share</button></li> : null}
        </ul>
        <div className="entry-meta">
          <FeedIcon url={data.feed.icon_url} />
          <Link to={`/feed/${data.feed.id}`}>{data.feed.title}</Link>
          {entry.author ? <span> · {entry.author}</span> : null}
          <span> · <time dateTime={entry.published_at} title={fullDate(entry.published_at)}>{timeAgo(entry.published_at)}</time></span>
          {settings.showReadingTime && entry.reading_time ? <span> · {entry.reading_time} min read</span> : null}
        </div>
        {entry.tags.length ? <div className="entry-tags">{entry.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</div> : null}
        {busy ? <p className="alert">{busy}</p> : null}
      </header>
      <div className="entry-content" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />
      <Enclosures entry={entry} noPlayer={data.feed.no_media_player} />
      <nav className="pagination">
        {nav.prev ? <Link to={`/entry/${nav.prev}`}>‹ Previous</Link> : <span className="muted">‹ Previous</span>}
        <Link to={nav.back}>Back to list</Link>
        {nav.next ? <Link to={`/entry/${nav.next}`}>Next ›</Link> : <span className="muted">Next ›</span>}
      </nav>
    </article>
  )
}
