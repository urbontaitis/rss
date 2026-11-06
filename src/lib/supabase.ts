import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSettings } from './settings'

let client: SupabaseClient | null = null
let clientKey = ''

export function getClient(): SupabaseClient {
  const { supabaseUrl, supabaseKey } = getSettings()
  const key = `${supabaseUrl}|${supabaseKey}`
  if (!client || key !== clientKey) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rss.auth' },
    })
    clientKey = key
  }
  return client
}

export function resetClient(): void {
  client = null
  clientKey = ''
}

export async function accessToken(): Promise<string> {
  const { data } = await getClient().auth.getSession()
  return data.session?.access_token ?? ''
}
