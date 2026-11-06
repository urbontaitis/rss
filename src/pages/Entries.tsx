import { Link, useParams, useSearchParams } from 'react-router-dom'
import { EntryList } from '../components/EntryList'
import { getFeed, listCategories } from '../lib/db'
import { useAsync } from '../lib/hooks'
import { refreshAll, refreshStore } from '../lib/refresh'

export function UnreadPage() {
  return <EntryList title="Unread" query={{ view: 'unread' }} emptyText="There are no unread entries." />
}

export function StarredPage() {
  return <EntryList title="Starred" query={{ view: 'starred' }} emptyText="There are no starred entries." />
}

export function HistoryPage() {
  return <EntryList title="History" query={{ view: 'history' }} emptyText="There are no read entries." />
}

export function SearchPage() {
  const [params] = useSearchParams()
  const q = params.get('q') || ''
  return <EntryList title={`Search: ${q}`} query={{ view: 'search', search: q }} emptyText="No results." />
}

export function FeedEntriesPage() {
  const id = Number(useParams().id)
  const [params] = useSearchParams()
  const showAll = params.get('all') === '1'
  const refresh = refreshStore.use()
  const { data: feed } = useAsync(() => getFeed(id), id)
  return (
    <>
      {feed?.parsing_error_msg ? (
        <p className="alert error">
          Last refresh failed ({feed.parsing_error_count}×): {feed.parsing_error_msg}
        </p>
      ) : null}
      <EntryList
        title={feed?.title || 'Feed'}
        query={{ view: showAll ? 'all' : 'unread', feedId: id, status: 'any' }}
        actions={
          <>
            <li>
              <Link to={showAll ? `/feed/${id}` : `/feed/${id}?all=1`}>{showAll ? 'Show only unread' : 'Show all entries'}</Link>
            </li>
            <li>
              <button type="button" className="link-button" disabled={refresh.running} onClick={() => void refreshAll({ feedIds: [id] })}>Refresh</button>
            </li>
            <li>
              <Link to={`/feed/${id}/edit`}>Edit</Link>
            </li>
          </>
        }
      />
    </>
  )
}

export function CategoryEntriesPage() {
  const id = Number(useParams().id)
  const [params] = useSearchParams()
  const showAll = params.get('all') === '1'
  const { data: categories } = useAsync(listCategories)
  const category = categories?.find((item) => item.id === id)
  return (
    <EntryList
      title={category?.title || 'Category'}
      query={{ view: showAll ? 'all' : 'unread', categoryId: id, status: 'any' }}
      actions={
        <li>
          <Link to={showAll ? `/category/${id}` : `/category/${id}?all=1`}>{showAll ? 'Show only unread' : 'Show all entries'}</Link>
        </li>
      }
    />
  )
}
