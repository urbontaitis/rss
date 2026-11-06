import { useState, type ChangeEvent } from 'react'
import { importFeeds, ensureCategory, listCategories, listFeeds } from '../lib/db'
import { buildOpml, parseOpml, type OpmlFeed } from '../lib/opml'
import { refreshAll } from '../lib/refresh'
import { bumpRevision } from '../lib/store'
import type { Category } from '../lib/types'

export function OpmlPage() {
  const [pending, setPending] = useState<OpmlFeed[]>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setMessage('')
    setPending(undefined)
    if (!file) return
    try {
      setPending(parseOpml(await file.text()))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const runImport = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const cache = new Map<string, Category>()
      for (const category of await listCategories()) cache.set(category.title.toLowerCase(), category)
      const rows = []
      for (const feed of pending) {
        const category = feed.category ? await ensureCategory(feed.category, cache) : null
        rows.push({ feed_url: feed.feedUrl, title: feed.title, site_url: feed.siteUrl, category_id: category?.id ?? null })
      }
      const added = await importFeeds(rows)
      setMessage(`Imported ${added} new feed(s), ${pending.length - added} already existed.`)
      setPending(undefined)
      bumpRevision()
      void refreshAll()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runExport = async () => {
    const [feeds, categories] = await Promise.all([listFeeds(), listCategories()])
    const blob = new Blob([buildOpml(feeds, categories)], { type: 'text/x-opml' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `feeds-${new Date().toISOString().slice(0, 10)}.opml`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  const categories = pending ? new Set(pending.map((feed) => feed.category).filter(Boolean)).size : 0

  return (
    <section>
      <div className="page-header"><h1>Import / Export</h1></div>
      <div className="panel">
        <h2>Export</h2>
        <p>Download all subscriptions as an OPML file.</p>
        <button type="button" className="button primary" onClick={() => void runExport()}>Export OPML</button>
      </div>
      <div className="panel">
        <h2>Import</h2>
        <p>Select an OPML file. Feeds already subscribed are skipped; outline groups become categories.</p>
        <label className="file-label">
          OPML file
          <input type="file" accept=".opml,.xml,text/xml,text/x-opml,application/xml" onChange={(event) => void onFile(event)} />
        </label>
        {pending ? (
          <>
            <p>{pending.length} feed(s) in {categories} categor{categories === 1 ? 'y' : 'ies'} found.</p>
            <button type="button" className="button primary" disabled={busy} onClick={() => void runImport()}>{busy ? 'Importing…' : 'Import'}</button>
          </>
        ) : null}
      </div>
      {message ? <p className="alert">{message}</p> : null}
    </section>
  )
}
