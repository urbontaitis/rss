import { useState, type FormEvent } from 'react'
import { saveSettings, useSettings } from '../lib/settings'
import { getClient, resetClient } from '../lib/supabase'

export function SetupPage() {
  const settings = useSettings()
  const [url, setUrl] = useState(settings.supabaseUrl)
  const [key, setKey] = useState(settings.supabaseKey)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const supabaseUrl = url.trim().replace(/\/+$/, '')
      new URL(supabaseUrl)
      resetClient()
      saveSettings({ supabaseUrl, supabaseKey: key.trim() })
      const client = getClient()
      const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) throw authError
      const { error: schemaError } = await client.from('settings').select('id').limit(1)
      if (schemaError) throw new Error(`Signed in, but the database schema is missing: ${schemaError.message}. Apply the migrations in supabase/migrations.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="setup">
      <h1>RSS</h1>
      <p className="muted">Connect to your Supabase project. The project URL and key are stored in this browser; all feeds and entries are stored in the database.</p>
      <form onSubmit={submit} className="form">
        <label>
          Project URL
          <input type="url" required placeholder="https://xyzcompany.supabase.co" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label>
          Publishable (anon) key
          <input type="text" required autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} />
        </label>
        <label>
          Email
          <input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="alert error">{error}</p> : null}
        <div className="buttons">
          <button type="submit" className="button primary" disabled={busy}>{busy ? 'Connecting…' : 'Sign in'}</button>
        </div>
      </form>
    </main>
  )
}
