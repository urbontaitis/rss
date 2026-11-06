import { createHandler } from './handler.ts'

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

Deno.serve(
  createHandler({
    fetch,
    resolveDns: (hostname, type) => Deno.resolveDns(hostname, type),
    allowedOrigins,
  }),
)
