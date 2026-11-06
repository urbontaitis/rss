import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FilterRulesHelp, RewriteRulesHelp, ScraperRulesHelp } from '../components/RulesHelp'
import { deleteFeed, getFeed, getServerSettings, listCategories, updateFeed } from '../lib/db'
import { fetchUrl } from '../lib/fetcher'
import { useAsync } from '../lib/hooks'
import { parseFeed } from '../lib/parser'
import { scrapeOriginal } from '../lib/refresh'
import { shouldKeep, validateFilterRules } from '../lib/rules/filter'
import { applyRewriteRules } from '../lib/rules/rewrite'
import { rewriteUrl } from '../lib/rules/urlRewrite'
import { renderContent } from '../lib/sanitize'
import { useSettings } from '../lib/settings'
import { bumpRevision } from '../lib/store'
import type { Feed } from '../lib/types'

type Draft = Omit<Feed, 'id' | 'created_at'>

interface PreviewItem {
  title: string
  url: string
  kept: boolean
}

export function FeedEditPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const settings = useSettings()
  const { data, error } = useAsync(async () => {
    const [feed, categories] = await Promise.all([getFeed(id), listCategories()])
    return { feed, categories }
  }, id)
  const [draft, setDraft] = useState<Draft>()
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<PreviewItem[]>()
  const [scrapePreview, setScrapePreview] = useState('')

  useEffect(() => {
    if (data) setDraft(data.feed)
  }, [data])

  if (error) return <p className="alert error">{error}</p>
  if (!draft || !data) return <p className="muted">Loading…</p>

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value })
  const text = (key: keyof Draft, label: string, type = 'text') => (
    <label>
      {label}
      <input type={type} autoComplete="off" value={String(draft[key] ?? '')} onChange={(event) => set(key, event.target.value as never)} />
    </label>
  )
  const area = (key: keyof Draft, label: string) => (
    <label>
      {label}
      <textarea rows={3} spellCheck={false} value={String(draft[key] ?? '')} onChange={(event) => set(key, event.target.value as never)} />
    </label>
  )
  const check = (key: keyof Draft, label: string) => (
    <label className="checkbox">
      <input type="checkbox" checked={Boolean(draft[key])} onChange={(event) => set(key, event.target.checked as never)} /> {label}
    </label>
  )

  const invalid = [...validateFilterRules(draft.block_filter_entry_rules), ...validateFilterRules(draft.keep_filter_entry_rules)]

  const save = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const patch: Partial<Feed> = { ...draft }
      delete patch.id
      delete patch.created_at
      await updateFeed(id, patch)
      bumpRevision()
      navigate(`/feed/${id}`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const remove = async () => {
    if (!confirm('Remove this feed and all its entries?')) return
    await deleteFeed(id)
    bumpRevision()
    navigate('/feeds')
  }

  const testFilters = async () => {
    setMessage('Fetching feed…')
    try {
      const [server, result] = await Promise.all([getServerSettings(), fetchUrl(draft.feed_url, { userAgent: draft.user_agent, cookie: draft.cookie, username: draft.username, password: draft.password })])
      const parsed = parseFeed(result.body, draft.feed_url)
      const rules = { globalBlock: server.block_filter_entry_rules, globalKeep: server.keep_filter_entry_rules, feedBlock: draft.block_filter_entry_rules, feedKeep: draft.keep_filter_entry_rules }
      setPreview(
        await Promise.all(
          parsed.items.map(async (item) => {
            const rewritten = await applyRewriteRules({ title: item.title, content: '', url: item.url, commentsUrl: item.commentsUrl, guid: item.guid, enclosures: [] }, draft.rewrite_rules)
            return { title: rewritten.title, url: item.url, kept: shouldKeep(item, rules) }
          }),
        ),
      )
      setMessage('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const testScraper = async () => {
    const first = preview?.find((item) => item.url)?.url
    if (!first) {
      setMessage('Run the filter preview first to pick an entry.')
      return
    }
    setMessage(`Fetching ${rewriteUrl(first, draft.url_rewrite_rules)}…`)
    try {
      const content = await scrapeOriginal({ ...(draft as Feed), id }, first)
      const rewritten = await applyRewriteRules({ title: '', content, url: first, commentsUrl: '', guid: '', enclosures: [] }, draft.rewrite_rules, { invidiousInstance: settings.invidiousInstance })
      setScrapePreview(renderContent(rewritten.content, settings, first))
      setMessage('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section>
      <div className="page-header">
        <h1>Edit feed: {data.feed.title}</h1>
      </div>
      {data.feed.parsing_error_msg ? <p className="alert error">{data.feed.parsing_error_msg}</p> : null}
      <form onSubmit={save} className="form">
        <fieldset>
          <legend>General</legend>
          {text('title', 'Title')}
          {text('site_url', 'Site URL', 'url')}
          {text('feed_url', 'Feed URL', 'url')}
          {text('icon_url', 'Icon URL')}
          <label>
            Category
            <select value={draft.category_id ?? ''} onChange={(event) => set('category_id', event.target.value ? Number(event.target.value) : null)}>
              <option value="">None</option>
              {data.categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
            </select>
          </label>
          {check('crawler', 'Fetch original content')}
          {check('hide_globally', 'Hide entries in global unread list')}
          {check('no_media_player', 'No media player (audio/video)')}
          {check('ignore_http_cache', 'Ignore HTTP cache')}
          {check('server_fetch', 'Allow scheduled fetching in the database')}
          {check('disabled', 'Do not refresh this feed')}
        </fieldset>
        <fieldset>
          <legend>Fetching</legend>
          {text('user_agent', 'User agent')}
          {text('cookie', 'Cookie')}
          {text('username', 'Feed username')}
          {text('password', 'Feed password', 'password')}
          <p className="muted small">Custom headers are only sent through the built-in fetch function and scheduled database fetching.</p>
        </fieldset>
        <fieldset>
          <legend>Rules</legend>
          {area('scraper_rules', 'Scraper rules')}
          {area('url_rewrite_rules', 'URL rewrite rules')}
          <ScraperRulesHelp />
          {area('rewrite_rules', 'Rewrite rules')}
          <RewriteRulesHelp />
          {area('block_filter_entry_rules', 'Block rules')}
          {area('keep_filter_entry_rules', 'Keep rules')}
          <FilterRulesHelp />
          {invalid.length ? <p className="alert error">Invalid rules (ignored): {invalid.join('; ')}</p> : null}
          <div className="buttons">
            <button type="button" className="button" onClick={() => void testFilters()}>Preview filters</button>
            <button type="button" className="button" onClick={() => void testScraper()}>Preview scraper</button>
          </div>
        </fieldset>
        {message ? <p className="alert">{message}</p> : null}
        {preview ? (
          <ul className="preview-list">
            {preview.map((item, index) => (
              <li key={index} className={item.kept ? '' : 'blocked'}>{item.kept ? '✓' : '✗'} {item.title}</li>
            ))}
          </ul>
        ) : null}
        {scrapePreview ? <div className="entry-content preview" dangerouslySetInnerHTML={{ __html: scrapePreview }} /> : null}
        <div className="buttons">
          <button type="submit" className="button primary">Update</button>
          <button type="button" className="button danger" onClick={() => void remove()}>Remove</button>
        </div>
      </form>
    </section>
  )
}
