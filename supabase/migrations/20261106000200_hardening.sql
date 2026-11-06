alter function public.touch_changed_at() set search_path = public;

create index if not exists entries_feed_published_idx on public.entries (feed_id, published_at desc);

revoke all on public.fetch_requests from public;
revoke execute on function public.touch_changed_at() from public, anon, authenticated;

alter table public.feeds add constraint feeds_feed_url_http check (feed_url ~* '^https?://');
