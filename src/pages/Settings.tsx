import { useEffect, useState, type FormEvent } from 'react'
import { FilterRulesHelp } from '../components/RulesHelp'
import { cleanupEntries, getServerSettings, updateServerSettings } from '../lib/db'
import { applyTemplate } from '../lib/fetcher'
import { useAsync } from '../lib/hooks'
import { validateFilterRules } from '../lib/rules/filter'
import { clearSettings, saveSettings, useSettings, type LocalSettings } from '../lib/settings'
import { getClient, resetClient } from '../lib/supabase'
import type { ServerSettings } from '../lib/types'

function LocalSettingsForm() {
  const settings = useSettings()
  const [draft, setDraft] = useState<LocalSettings>(settings)
  const [saved, setSaved] = useState(false)
  const set = <K extends keyof LocalSettings>(key: K, value: LocalSettings[K]) => {
    setSaved(false)
    setDraft({ ...draft, [key]: value })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    saveSettings({ ...draft, refreshIntervalMinutes: Math.max(5, draft.refreshIntervalMinutes), entriesPerPage: Math.min(500, Math.max(5, draft.entriesPerPage)) })
    setSaved(true)
  }

  const sample = 'https://example.org/image.jpg'

  return (
    <form onSubmit={submit} className="form">
      <p className="muted small">These settings are stored in this browser only.</p>
      <fieldset>
        <legend>Reading</legend>
        <label>
          Entries per page
          <input type="number" min={5} max={500} value={draft.entriesPerPage} onChange={(event) => set('entriesPerPage', Number(event.target.value))} />
        </label>
        <label>
          Entry sorting
          <select value={draft.sortDirection} onChange={(event) => set('sortDirection', event.target.value as 'asc' | 'desc')}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
        <label>
          Theme
          <select value={draft.theme} onChange={(event) => set('theme', event.target.value as LocalSettings['theme'])}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="checkbox"><input type="checkbox" checked={draft.markReadOnView} onChange={(event) => set('markReadOnView', event.target.checked)} /> Mark entries as read when opened</label>
        <label className="checkbox"><input type="checkbox" checked={draft.showReadingTime} onChange={(event) => set('showReadingTime', event.target.checked)} /> Show reading time</label>
        <label>
          Invidious instance
          <input type="text" value={draft.invidiousInstance} onChange={(event) => set('invidiousInstance', event.target.value)} />
        </label>
      </fieldset>
      <fieldset>
        <legend>Refresh</legend>
        <label className="checkbox"><input type="checkbox" checked={draft.refreshOnOpen} onChange={(event) => set('refreshOnOpen', event.target.checked)} /> Refresh feeds when the app is opened</label>
        <label>
          Refresh interval while open (minutes)
          <input type="number" min={5} value={draft.refreshIntervalMinutes} onChange={(event) => set('refreshIntervalMinutes', Number(event.target.value))} />
        </label>
        <label>
          Parallel requests
          <input type="number" min={1} max={16} value={draft.refreshConcurrency} onChange={(event) => set('refreshConcurrency', Number(event.target.value))} />
        </label>
        <label>
          Fetch method
          <select value={draft.fetchMode} onChange={(event) => set('fetchMode', event.target.value as LocalSettings['fetchMode'])}>
            <option value="edge">Supabase edge function "fetch"</option>
            <option value="custom">Custom CORS proxy</option>
            <option value="direct">Direct (only feeds that allow CORS)</option>
          </select>
        </label>
        {draft.fetchMode === 'custom' ? (
          <label>
            CORS proxy URL template
            <input type="text" placeholder="https://proxy.example.org/?url={encoded}" value={draft.fetchProxyTemplate} onChange={(event) => set('fetchProxyTemplate', event.target.value)} />
          </label>
        ) : null}
        <label>
          Default user agent
          <input type="text" placeholder="Mozilla/5.0 (compatible; RSS Reader)" value={draft.defaultUserAgent} onChange={(event) => set('defaultUserAgent', event.target.value)} />
        </label>
      </fieldset>
      <fieldset>
        <legend>Image proxy</legend>
        <label>
          Proxy images
          <select value={draft.imageProxyMode} onChange={(event) => set('imageProxyMode', event.target.value as LocalSettings['imageProxyMode'])}>
            <option value="none">Never</option>
            <option value="http-only">Only insecure (http) images</option>
            <option value="all">Always</option>
          </select>
        </label>
        <label>
          Proxy URL template
          <input type="text" placeholder="https://wsrv.nl/?url={encoded}" value={draft.imageProxyTemplate} onChange={(event) => set('imageProxyTemplate', event.target.value)} />
        </label>
        <label className="checkbox"><input type="checkbox" checked={draft.imageProxyMedia} onChange={(event) => set('imageProxyMedia', event.target.checked)} /> Also proxy audio and video</label>
        <p className="muted small">
          Placeholders: <code>{'{url}'}</code>, <code>{'{encoded}'}</code>, <code>{'{base64}'}</code>, <code>{'{base64url}'}</code>. Without a placeholder the encoded URL is appended.
          {draft.imageProxyTemplate ? <><br />Example: <code>{applyTemplate(draft.imageProxyTemplate, sample)}</code></> : null}
        </p>
      </fieldset>
      <div className="buttons">
        <button type="submit" className="button primary">Save</button>
        {saved ? <span className="muted">Saved.</span> : null}
      </div>
    </form>
  )
}

function ServerSettingsForm() {
  const { data, error } = useAsync(getServerSettings, [])
  const [draft, setDraft] = useState<ServerSettings>()
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (data) setDraft(data)
  }, [data])
  if (error) return <p className="alert error">{error}</p>
  if (!draft) return <p className="muted">Loading…</p>

  const invalid = [...validateFilterRules(draft.block_filter_entry_rules), ...validateFilterRules(draft.keep_filter_entry_rules)]

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setDraft(await updateServerSettings({
        block_filter_entry_rules: draft.block_filter_entry_rules,
        keep_filter_entry_rules: draft.keep_filter_entry_rules,
        retention_days: Math.max(1, draft.retention_days),
        server_fetch_enabled: draft.server_fetch_enabled,
      }))
      setMessage('Saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const cleanup = async () => {
    const count = await cleanupEntries()
    setMessage(`${count} old entr${count === 1 ? 'y' : 'ies'} removed.`)
  }

  return (
    <form onSubmit={submit} className="form">
      <p className="muted small">These settings are stored in the database.</p>
      <fieldset>
        <legend>Global filter rules</legend>
        <label>
          Block rules
          <textarea rows={4} spellCheck={false} value={draft.block_filter_entry_rules} onChange={(event) => setDraft({ ...draft, block_filter_entry_rules: event.target.value })} />
        </label>
        <label>
          Keep rules
          <textarea rows={4} spellCheck={false} value={draft.keep_filter_entry_rules} onChange={(event) => setDraft({ ...draft, keep_filter_entry_rules: event.target.value })} />
        </label>
        <FilterRulesHelp />
        {invalid.length ? <p className="alert error">Invalid rules (ignored): {invalid.join('; ')}</p> : null}
      </fieldset>
      <fieldset>
        <legend>Database</legend>
        <label>
          Remove read entries after (days)
          <input type="number" min={1} value={draft.retention_days} onChange={(event) => setDraft({ ...draft, retention_days: Number(event.target.value) })} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={draft.server_fetch_enabled} onChange={(event) => setDraft({ ...draft, server_fetch_enabled: event.target.checked })} /> Fetch feeds in the database every 15 minutes (pg_cron + pg_net)
        </label>
        <p className="muted small">Fetched documents are stored as snapshots and turned into entries the next time the app is opened, so short-lived items are not missed while the browser is closed.</p>
      </fieldset>
      <div className="buttons">
        <button type="submit" className="button primary">Save</button>
        <button type="button" className="button" onClick={() => void cleanup()}>Remove old entries now</button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </form>
  )
}

function ConnectionPanel() {
  const settings = useSettings()
  const [email, setEmail] = useState('')
  useEffect(() => {
    getClient().auth.getUser().then(({ data }) => setEmail(data.user?.email || ''))
  }, [])

  const signOut = async () => {
    await getClient().auth.signOut()
  }

  const disconnect = async () => {
    if (!confirm('Sign out and remove all settings stored in this browser?')) return
    await getClient().auth.signOut().catch(() => undefined)
    resetClient()
    clearSettings()
  }

  return (
    <div className="panel">
      <p>
        Connected to <code>{settings.supabaseUrl}</code>{email ? <> as <strong>{email}</strong></> : null}.
      </p>
      <div className="buttons">
        <button type="button" className="button" onClick={() => void signOut()}>Sign out</button>
        <button type="button" className="button danger" onClick={() => void disconnect()}>Forget connection</button>
      </div>
    </div>
  )
}

export function SettingsPage() {
  return (
    <section>
      <div className="page-header"><h1>Settings</h1></div>
      <h2>Connection</h2>
      <ConnectionPanel />
      <h2>Browser</h2>
      <LocalSettingsForm />
      <h2>Database</h2>
      <ServerSettingsForm />
    </section>
  )
}
