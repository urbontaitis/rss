-- Keep the database small on limited plans.
--
-- The biggest growth came from background fetching:
--   * pg_net keeps every HTTP response body in net._http_response for 6 hours,
--     and every feed was downloaded in full every 15 minutes.
--   * feed_snapshots kept a full copy of each changed feed for up to 7 days
--     when the app was not opened.
--   * pg_cron keeps a row per job run in cron.job_run_details forever.
-- Removed entries also kept their title, url, tags and search vector.

-- Validators of the last background fetch, kept apart from the ones the app
-- uses so the two fetch paths never hide items from each other.
alter table public.feeds
  add column if not exists harvest_etag text not null default '',
  add column if not exists harvest_last_modified text not null default '';

create or replace function public.collect_feed_responses() returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  affected integer;
  done bigint[];
begin
  select coalesce(array_agg(q.request_id), '{}') into done
  from public.fetch_requests q
  join net._http_response r on r.id = q.request_id;

  insert into public.feed_snapshots (feed_id, body, etag, last_modified)
  select
    q.feed_id,
    r.content,
    coalesce(r.headers ->> 'etag', r.headers ->> 'ETag', ''),
    coalesce(r.headers ->> 'last-modified', r.headers ->> 'Last-Modified', '')
  from public.fetch_requests q
  join net._http_response r on r.id = q.request_id
  where q.request_id = any (done)
    and r.status_code = 200
    and r.content is not null
    and length(r.content) > 0
    and octet_length(r.content) <= 2 * 1024 * 1024
  on conflict (feed_id, body_hash) do nothing;
  get diagnostics affected = row_count;

  -- Remember validators so the next download can be answered with 304.
  update public.feeds f
  set harvest_etag = coalesce(r.headers ->> 'etag', r.headers ->> 'ETag', ''),
      harvest_last_modified = coalesce(r.headers ->> 'last-modified', r.headers ->> 'Last-Modified', '')
  from public.fetch_requests q
  join net._http_response r on r.id = q.request_id
  where q.request_id = any (done)
    and r.status_code = 200
    and f.id = q.feed_id;

  delete from public.fetch_requests where request_id = any (done);
  delete from public.fetch_requests where created_at < now() - interval '1 hour';

  -- Drop the response bodies now instead of waiting for pg_net's 6 hour TTL.
  begin
    delete from net._http_response where id = any (done);
  exception when insufficient_privilege then
    null;
  end;

  -- A newer document of the same feed already holds the recent items, so a
  -- few snapshots per feed are enough to bridge the time the app is closed.
  delete from public.feed_snapshots s
  using (
    select id, row_number() over (partition by feed_id order by fetched_at desc, id desc) as n
    from public.feed_snapshots
  ) ranked
  where ranked.id = s.id and ranked.n > 3;

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

  -- Safety stop: never let background downloads push the database towards
  -- the 500 MB limit of the free plan. The app still refreshes feeds itself.
  if pg_database_size(current_database()) > 350 * 1024 * 1024 then
    raise warning 'rss: database is over 350 MB, background fetching is paused';
    return 0;
  end if;

  for f in
    select id, feed_url, user_agent, cookie, username, password, ignore_http_cache, harvest_etag, harvest_last_modified
    from public.feeds
    where not disabled and server_fetch
      and not exists (select 1 from public.fetch_requests q where q.feed_id = feeds.id)
  loop
    headers := jsonb_build_object(
      'User-Agent', coalesce(nullif(f.user_agent, ''), 'Mozilla/5.0 (compatible; RSS Reader)'),
      'Accept', 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.8'
    );
    if not f.ignore_http_cache then
      if f.harvest_etag <> '' then
        headers := headers || jsonb_build_object('If-None-Match', f.harvest_etag);
      end if;
      if f.harvest_last_modified <> '' then
        headers := headers || jsonb_build_object('If-Modified-Since', f.harvest_last_modified);
      end if;
    end if;
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

create or replace function public.cleanup_entries() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
  days integer;
begin
  select retention_days into days from public.settings where id = 1;

  -- Only the feed id and hash are needed to stop a removed entry from being
  -- imported again; clearing the rest also empties its search vector.
  update public.entries
  set status = 'removed', content = '', enclosures = '[]', title = '', url = '',
      comments_url = '', author = '', tags = '{}'
  where status = 'read'
    and not starred
    and changed_at < now() - make_interval(days => coalesce(days, 60));
  get diagnostics affected = row_count;

  update public.entries
  set content = '', enclosures = '[]', title = '', url = '', comments_url = '', author = '', tags = '{}'
  where status = 'removed'
    and (content <> '' or title <> '' or url <> '' or author <> '' or tags <> '{}' or enclosures <> '[]');

  delete from public.feed_snapshots where fetched_at < now() - interval '3 days';

  begin
    delete from cron.job_run_details where end_time < now() - interval '3 days';
  exception when insufficient_privilege or undefined_table then
    null;
  end;

  return affected;
end;
$$;

revoke execute on function public.collect_feed_responses() from public, anon, authenticated;
revoke execute on function public.harvest_feeds() from public, anon, authenticated;
revoke execute on function public.cleanup_entries() from public, anon;
grant execute on function public.cleanup_entries() to authenticated;
