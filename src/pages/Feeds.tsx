import { Link } from 'react-router-dom'
import { FeedIcon } from '../components/FeedIcon'
import { deleteFeed, listCategories, listCounters, listFeeds } from '../lib/db'
import { useAsync } from '../lib/hooks'
import { refreshAll, refreshStore } from '../lib/refresh'
import { bumpRevision } from '../lib/store'
import { timeAgo } from '../lib/time'

export function FeedsPage() {
  const refresh = refreshStore.use()
  const { data, error } = useAsync(async () => {
    const [feeds, counters, categories] = await Promise.all([listFeeds(), listCounters(), listCategories()])
    return { feeds, counters: new Map(counters.map((counter) => [counter.feed_id, counter])), categories: new Map(categories.map((category) => [category.id, category])) }
  }, [])

  const remove = async (id: number, title: string) => {
    if (!confirm(`Remove "${title}" and all its entries?`)) return
    await deleteFeed(id)
    bumpRevision()
  }

  const failing = data?.feeds.filter((feed) => feed.parsing_error_count > 0) ?? []

  return (
    <section>
      <div className="page-header">
        <h1>Feeds{data ? <span className="count"> ({data.feeds.length})</span> : null}</h1>
        <ul className="page-actions">
          <li><Link to="/feeds/add">Add subscription</Link></li>
          <li><Link to="/opml">Import / Export</Link></li>
          <li><button type="button" className="link-button" disabled={refresh.running} onClick={() => void refreshAll({ force: true })}>Refresh all feeds</button></li>
        </ul>
      </div>
      {error ? <p className="alert error">{error}</p> : null}
      {failing.length ? <p className="alert error">{failing.length} feed(s) have refresh errors.</p> : null}
      {data && !data.feeds.length ? <p className="alert">You don't have any subscriptions. <Link to="/feeds/add">Add one</Link> or <Link to="/opml">import an OPML file</Link>.</p> : null}
      <div className="items">
        {data?.feeds.map((feed) => {
          const counter = data.counters.get(feed.id)
          const category = feed.category_id ? data.categories.get(feed.category_id) : undefined
          return (
            <article key={feed.id} className={`item ${feed.parsing_error_count ? 'item-error' : ''} ${feed.disabled ? 'item-read' : ''}`}>
              <div className="item-header">
                <span className="item-title">
                  <FeedIcon url={feed.icon_url} />
                  <Link to={`/feed/${feed.id}`}>{feed.title || feed.feed_url}</Link>
                  {counter ? <span className="count"> ({counter.unread}/{counter.total})</span> : null}
                </span>
                {category ? <Link to={`/category/${category.id}`} className="category">{category.title}</Link> : null}
              </div>
              <div className="item-meta">
                <ul className="item-meta-info">
                  <li><a href={feed.site_url || feed.feed_url} target="_blank" rel="noopener noreferrer">{(feed.site_url || feed.feed_url).replace(/^https?:\/\//, '').slice(0, 60)}</a></li>
                  <li>Checked {timeAgo(feed.checked_at)}</li>
                  {feed.disabled ? <li>Disabled</li> : null}
                </ul>
                <ul className="item-meta-icons">
                  <li><button type="button" className="link-button" disabled={refresh.running} onClick={() => void refreshAll({ feedIds: [feed.id] })}>Refresh</button></li>
                  <li><Link to={`/feed/${feed.id}/edit`}>Edit</Link></li>
                  <li><button type="button" className="link-button danger" onClick={() => void remove(feed.id, feed.title)}>Remove</button></li>
                </ul>
              </div>
              {feed.parsing_error_msg ? <div className="item-error-msg">{feed.parsing_error_msg}</div> : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
