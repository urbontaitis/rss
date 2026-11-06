create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.fetch_requests (
  request_id bigint primary key,
  feed_id bigint not null references public.feeds (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.fetch_requests enable row level security;
revoke all on public.fetch_requests from anon, authenticated;

create or replace function public.collect_feed_responses() returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  affected integer;
begin
  insert into public.feed_snapshots (feed_id, body, etag, last_modified)
  select
    q.feed_id,
    r.content,
    coalesce(r.headers ->> 'etag', r.headers ->> 'ETag', ''),
    coalesce(r.headers ->> 'last-modified', r.headers ->> 'Last-Modified', '')
  from public.fetch_requests q
  join net._http_response r on r.id = q.request_id
  where r.status_code = 200
    and r.content is not null
    and length(r.content) > 0
  on conflict (feed_id, body_hash) do nothing;
  get diagnostics affected = row_count;

  delete from public.fetch_requests q
  using net._http_response r
  where r.id = q.request_id;

  delete from public.fetch_requests where created_at < now() - interval '1 hour';
  return affected;
end;
$$;

create or replace function public.harvest_feeds() returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  f record;
  request bigint;
  queued integer := 0;
  headers jsonb;
begin
  perform public.collect_feed_responses();

  if not coalesce((select server_fetch_enabled from public.settings where id = 1), false) then
    return 0;
  end if;

  for f in
    select id, feed_url, user_agent, cookie, username, password
    from public.feeds
    where not disabled and server_fetch
  loop
    headers := jsonb_build_object(
      'User-Agent', coalesce(nullif(f.user_agent, ''), 'Mozilla/5.0 (compatible; RSS Reader)'),
      'Accept', 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.8'
    );
    if f.cookie <> '' then
      headers := headers || jsonb_build_object('Cookie', f.cookie);
    end if;
    if f.username <> '' then
      headers := headers || jsonb_build_object(
        'Authorization',
        'Basic ' || translate(encode(convert_to(f.username || ':' || f.password, 'UTF8'), 'base64'), E'\n', '')
      );
    end if;
    request := net.http_get(url := f.feed_url, headers := headers, timeout_milliseconds := 30000);
    insert into public.fetch_requests (request_id, feed_id) values (request, f.id);
    queued := queued + 1;
  end loop;

  return queued;
end;
$$;

revoke execute on function public.collect_feed_responses() from public, anon, authenticated;
revoke execute on function public.harvest_feeds() from public, anon, authenticated;

select cron.schedule('rss-harvest-feeds', '*/15 * * * *', 'select public.harvest_feeds()');
select cron.schedule('rss-collect-responses', '*/5 * * * *', 'select public.collect_feed_responses()');
select cron.schedule('rss-cleanup-entries', '17 3 * * *', 'select public.cleanup_entries()');
