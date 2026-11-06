import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createFeed, listCategories } from '../lib/db'
import { fetchUrl } from '../lib/fetcher'
import { useAsync } from '../lib/hooks'
import { discoverFeeds, looksLikeFeed } from '../lib/parser'
import { refreshAll } from '../lib/refresh'
import { bumpRevision } from '../lib/store'

export function AddFeedPage() {
  const navigate = useNavigate()
  const { data: categories } = useAsync(listCategories)
  const [url, setUrl] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [crawler, setCrawler] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [userAgent, setUserAgent] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [choices, setChoices] = useState<{ url: string; title: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const subscribe = async (feedUrl: string) => {
    const feed = await createFeed({
      feed_url: feedUrl,
      category_id: categoryId ? Number(categoryId) : null,
      crawler,
      user_agent: userAgent,
      username,
      password,
    })
    bumpRevision()
    await refreshAll({ feedIds: [feed.id] })
    navigate(`/feed/${feed.id}?all=1`)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setChoices([])
    setBusy(true)
    try {
      const target = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
      const result = await fetchUrl(target, { userAgent, username, password })
      if (result.status >= 400) throw new Error(`HTTP ${result.status}`)
      if (looksLikeFeed(result.body)) {
        await subscribe(result.url || target)
        return
      }
      const found = discoverFeeds(result.body, result.url || target)
      if (!found.length) throw new Error('No feed found at this address.')
      if (found.length === 1) await subscribe(found[0].url)
      else setChoices(found)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="page-header"><h1>New subscription</h1></div>
      <form onSubmit={submit} className="form">
        <label>
          URL
          <input type="text" required autoFocus placeholder="https://example.org/" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label>
          Category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">None</option>
            {categories?.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
          </select>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={crawler} onChange={(event) => setCrawler(event.target.checked)} /> Fetch original content
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} /> Advanced options
        </label>
        {advanced ? (
          <>
            <label>User agent<input type="text" value={userAgent} onChange={(event) => setUserAgent(event.target.value)} /></label>
            <label>Feed username<input type="text" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label>Feed password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          </>
        ) : null}
        {error ? <p className="alert error">{error}</p> : null}
        {choices.length ? (
          <div className="alert">
            <p>Choose a subscription:</p>
            {choices.map((choice) => (
              <p key={choice.url}>
                <button type="button" className="link-button" onClick={() => void subscribe(choice.url).catch((err) => setError(String(err)))}>{choice.title}</button>
                <br />
                <small className="muted">{choice.url}</small>
              </p>
            ))}
          </div>
        ) : null}
        <div className="buttons">
          <button type="submit" className="button primary" disabled={busy}>{busy ? 'Searching…' : 'Find a subscription'}</button>
        </div>
      </form>
    </section>
  )
}
