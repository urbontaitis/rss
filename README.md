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
- HTML sanitized with DOMPurify, a strict Content Security Policy and a hardened fetch function (see [Security](#security))
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
| `20261106000200_hardening.sql` | Fixed `search_path` for the trigger function, an index for per feed lists, and a check that feed URLs are http(s) |

### 2. Create your user

In the dashboard, open *Authentication → Users → Add user* and create a user with email and password (auto confirm). Then turn off new sign ups under *Authentication → Sign In / Providers* so nobody else can register. `supabase/config.toml` already turns sign ups off for local and branch environments.

### 3. Deploy the app to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes the app on every push to `main`, after the full CI suite passes.

1. In the repository settings, open *Pages* and set *Source* to **GitHub Actions**.
2. Push to `main`, or run the *Deploy to GitHub Pages* workflow by hand.
3. Open `https://<user>.github.io/<repository>/` and enter the project URL, publishable key, email and password. Then add feeds or import an OPML file under *Feeds → Import / Export*.

The build uses relative paths and hash routing, so `dist/` also works on any other static host.

### 4. Restrict the fetch function (recommended)

The `fetch` edge function only accepts requests that carry a valid user JWT. To also limit which websites may call it, set the allowed origins:

```sh
npx supabase secrets set ALLOWED_ORIGINS=https://<user>.github.io,http://localhost:5173
```

### Local development

```sh
npm install
npm run dev
```

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

## Development and testing

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint (TypeScript and React hooks rules), zero warnings allowed |
| `npm run typecheck` | TypeScript in strict mode, including tests and configs |
| `npm test` | Unit and component tests (Vitest, jsdom, Testing Library) |
| `npm run test:coverage` | The same tests with coverage thresholds (99% statements, lines and functions, 95% branches) |
| `npm run test:e2e` | Playwright tests against the production build on desktop and mobile viewports, with the Supabase API mocked at the network layer |
| `npm run test:db` | pgTAP tests for migrations, row level security, functions and scheduled jobs (needs `supabase db start`) |

The suites check behaviour rather than lines:

- **Unit tests:** feed formats, every rule type, the refresh pipeline (deduplication, filtering, crawling, error backoff, snapshots, tab locking, scheduler), the fetch function's SSRF protection, and the sanitizer.
- **Component tests:** drive each page the way a user does.
- **End-to-end tests:** cover sign in, subscription and discovery, reading, starring, OPML import, rule previews and keyboard navigation. They also check that no script from feed content runs, that the CSP is present, that the initial JavaScript stays within budget with heavy modules deferred, and that pages don't scroll horizontally on mobile.

### Continuous integration

`.github/workflows/ci.yml` runs on every branch push and pull request. It has three parallel jobs:

1. **Checks:** a production dependency audit, lint, typecheck, and unit/component tests with coverage. The coverage summary is shown on the run page and uploaded as an artifact.
2. **End to end:** the Playwright tests in Chromium.
3. **Database:** starts the Supabase Postgres image, applies all migrations, runs `supabase db lint` and the pgTAP tests in `supabase/tests`.

### Dependency updates

[Renovate](https://docs.renovatebot.com/) (`renovate.json`) groups all dependency updates, including GitHub Action digests and lock file maintenance, into one weekly pull request. Each Renovate branch is a single commit that Renovate rewrites when updates change. Security fixes are raised immediately. Install the Renovate GitHub App on the repository to enable it.

## Security

- **Access:** row level security on every table; only the `authenticated` role has access, and `anon` has none. Turn off sign ups so the database belongs to a single user.
- **Database functions:** security definer functions use a fixed `search_path`, and the browser can't call the scheduling functions.
- **HTML sanitizing:** feed and scraped HTML is sanitized with DOMPurify before it is stored and again before it is shown. Scripts, styles, forms, event handlers and `javascript:` URLs are removed. Links open with `noopener noreferrer`. Iframes are allowed only from known video and audio hosts, the configured Invidious instance, or the entry's own site, and are sandboxed.
- **Fetch function:** it rejects non-HTTP URLs, private, loopback and link-local addresses (including DNS names that resolve to them), and checks every redirect hop. It drops cookies and credentials on cross-origin redirects, limits responses to 15 MB, and serves them with `nosniff` and a sandbox CSP.
- **Browser:** the production build has a Content Security Policy (`script-src 'self'`, `object-src 'none'`, `base-uri 'none'`) and a `no-referrer` policy, and images load with `referrerpolicy="no-referrer"`.
- **Secrets:** the browser stores only the publishable key and the auth session. Feed passwords and cookies are stored in the database, protected by row level security.

## Performance

- **Code splitting:** each route except the entry lists loads on demand. Readability and the Markdown parser load only when a scraper or `parse_markdown` rule runs. React, supabase-js and DOMPurify are separate long-cacheable chunks.
- **Refresh:** a configurable number of parallel requests, conditional `ETag`/`Last-Modified` requests, backoff for failing feeds, and a single refreshing tab.
- **Database:** indexed queries for unread, starred, history, per feed lists and full text search. Existence checks are batched before inserts, and inserts use `on conflict do nothing`.

## License

MIT
