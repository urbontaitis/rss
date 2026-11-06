# RSS

A browser based RSS reader. It is a single page application (React + Vite) that talks directly to the [Supabase](https://supabase.com) REST API using [`@supabase/supabase-js`](https://supabase.com/docs/reference/javascript/introduction). There is no application server: the browser fetches, parses and filters feeds, and everything (feeds, categories, entries, rules, settings) is stored in your Supabase Postgres database.

It is built for a single person. One Supabase Auth user owns all data, and row level security only lets authenticated requests in.

## Features

- RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed, with feed discovery from a website URL (including YouTube channels)
- Unread, starred, history and full text search (Postgres `tsvector`)
- Categories, with an option to hide a feed or category from the global unread list
- OPML import and export
- Feed rules, all run in the browser:
  - Entry filtering: global and per feed block and keep rules (`EntryTitle`, `EntryURL`, `EntryCommentsURL`, `EntryContent`, `EntryAuthor`, `EntryTag`, `EntryDate` with `future`, `before:`, `after:`, `between:`, `max-age:`)
  - Content rewrite rules (`add_image_title`, `add_youtube_video`, `remove(...)`, `replace(...)`, `replace_title(...)`, `nl2br`, `convert_text_links`, `base64_decode`, `remove_tables`, `remove_clickbait`, `fix_medium_images`, `use_noscript_figure_images`, `parse_markdown` and others)
  - URL rewrite rules: `rewrite("regex"|"replacement")`
  - Scraper rules: CSS selectors that extract full content from the original page, with a readability fallback
  - Preview buttons in the feed editor show which entries a rule keeps or blocks, and what the scraper extracts
- An image proxy for images, `srcset`, video posters and (optionally) audio/video in entry content, including scraped content
- Per feed user agent, cookie and HTTP basic auth, plus a conditional `ETag`/`Last-Modified` fetch
- Audio, video and image attachments, embedded YouTube players (`youtube-nocookie.com`)
- HTML is sanitized with DOMPurify. Only iframes from known video and audio hosts are allowed, and they are sandboxed.
- Keyboard shortcuts (press `?`), light and dark themes, and a layout that works on mobile

## How it works

```
Browser (SPA)                          Supabase
┌──────────────────────────┐           ┌───────────────────────────────────────┐
│ localStorage             │           │ Auth (single user)                    │
│  - project URL / key     │  REST     │ Postgres                              │
│  - image proxy           │◀────────▶│  categories, feeds, entries, settings │
│  - fetch method, UI prefs│           │  feed_snapshots                       │
│                          │           │  pg_cron + pg_net (optional fetching) │
│ fetch → parse → filter → │  HTTPS    │ Edge function "fetch" (CORS proxy)    │
│ scrape → rewrite →       │◀────────▶│                                       │
│ sanitize → insert        │           └───────────────────────────────────────┘
└──────────────────────────┘
```

1. You open the app and enter the Supabase project URL, the publishable (anon) key, and the email and password of your Supabase Auth user. The URL and key are saved in `localStorage`. The auth session is saved by supabase-js.
2. When the app opens, it refreshes every feed that is due, and it keeps refreshing on an interval while the tab is open. A Web Lock makes sure only one tab refreshes at a time.
3. Most sites don't send CORS headers, so the browser can't download feeds directly. By default, requests go through the bundled `fetch` edge function, which checks your JWT and blocks private network addresses. You can switch to your own CORS proxy URL template, or to direct fetching, under Settings.
4. **Background fetching (optional):** Postgres can't run the JavaScript rule pipeline, so the database does the downloading only. If you turn on *Fetch feeds in the database* in Settings, a `pg_cron` job uses `pg_net` to download every feed every 15 minutes and stores the raw documents in `feed_snapshots`. The next time the app opens, it turns the snapshots into entries with the full rule pipeline. This way, items from fast-moving feeds aren't missed while the browser is closed.
5. A daily `pg_cron` job marks read, unstarred entries older than the retention period as `removed` and clears their content. The row stays so the entry isn't imported again.

### Stored in the browser

Supabase connection, image proxy (URL template and mode), fetch method / CORS proxy, refresh interval and concurrency, entries per page, sort order, theme, mark-as-read behaviour, default user agent and Invidious instance.

### Stored in Supabase

Categories, feeds (including all rules and fetch options), entries (status, star, content, attachments), global filter rules, retention and the background fetch switch.

## Setup

### 1. Create the Supabase project and schema

The `supabase/` directory holds the configuration, migrations and edge function.

**With the GitHub integration (recommended):** connect this repository in the Supabase dashboard under *Project Settings → Integrations → GitHub*. Leave the Supabase directory as `supabase`. Migrations in `supabase/migrations` run on preview branches for pull requests, and on the production project when they are merged into the production branch. See [Branching via GitHub](https://supabase.com/docs/guides/deployment/branching/github-integration).

**With the CLI:**

```sh
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase functions deploy fetch
```

Migrations:

| File | Purpose |
| --- | --- |
| `20261106000000_schema.sql` | Tables, views (`entry_list`, `feed_counters`), full text search, RPC functions, row level security |
| `20261106000100_scheduled_jobs.sql` | Enables `pg_cron` and `pg_net`, and schedules background fetching, response collection and cleanup |

### 2. Create your user

In the dashboard, open *Authentication → Users → Add user* and create a user with email and password (auto confirm). Then turn off new sign ups under *Authentication → Sign In / Providers* so nobody else can register. `supabase/config.toml` already turns sign ups off for local and branch environments.

### 3. Run or host the app

```sh
npm install
npm run dev
npm run build
```

`npm run dev` starts a local server, and `npm run build` writes a static build to `dist/`. The build uses relative paths and hash routing, so `dist/` can be served from any static host (GitHub Pages, Cloudflare Pages, Netlify, a bucket, or a file server). Open the app, enter the project URL, publishable key, email and password, then add feeds or import an OPML file under *Feeds → Import / Export*.

### Image proxy

Under *Settings → Image proxy*, set a URL template and choose when to use it (never, only `http://` images, or always). Placeholders:

| Placeholder | Value |
| --- | --- |
| `{url}` | raw URL |
| `{encoded}` | `encodeURIComponent(url)` |
| `{base64}` | base64 of the URL |
| `{base64url}` | URL safe base64 without padding |

If the template has no placeholder, the encoded URL is appended. Examples: `https://wsrv.nl/?url={encoded}`, `https://imgproxy.example.org/insecure/plain/{url}`.

The proxy is applied when content is shown, so changing it affects existing entries as well.

## Development

```sh
npm test
npm run typecheck
npx supabase start
```

`npm test` runs the parser, rules, OPML, proxy and sanitizer tests (Vitest with jsdom). `npx supabase start` runs a local Supabase stack with the migrations applied.

## License

MIT
