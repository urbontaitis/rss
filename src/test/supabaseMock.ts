import { vi } from 'vitest'

export interface Call {
  method: string
  args: unknown[]
}

export interface Recorded {
  table: string
  calls: Call[]
}

type Responder = (query: Recorded) => { data: unknown; error: { message: string } | null; count?: number | null }

export function createSupabaseMock(responder: Responder = () => ({ data: [], error: null })) {
  const queries: Recorded[] = []
  const rpcs: { name: string; args: unknown }[] = []
  let respond = responder

  const builder = (table: string) => {
    const recorded: Recorded = { table, calls: [] }
    queries.push(recorded)
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === 'then') {
            const result = respond(recorded)
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
          }
          return (...args: unknown[]) => {
            recorded.calls.push({ method: prop, args })
            return proxy
          }
        },
      },
    )
    return proxy
  }

  const client = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(async (name: string, args?: unknown) => {
      rpcs.push({ name, args })
      return respond({ table: `rpc:${name}`, calls: [{ method: 'rpc', args: [args] }] })
    }),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'token-123' } } })),
      getUser: vi.fn(async () => ({ data: { user: { email: 'me@example.org' } } })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      onAuthStateChange: vi.fn((_callback: (event: string, session: unknown) => void) => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  }

  return {
    client,
    queries,
    rpcs,
    setResponder(next: Responder) {
      respond = next
    },
    callsFor(table: string) {
      return queries.filter((query) => query.table === table)
    },
  }
}

export function methods(query: Recorded): string[] {
  return query.calls.map((call) => `${call.method}(${call.args.map((arg) => JSON.stringify(arg)).join(',')})`)
}
