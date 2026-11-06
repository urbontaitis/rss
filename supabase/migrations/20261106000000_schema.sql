create table public.categories (
  id bigint generated always as identity primary key,
  title text not null unique,
  hide_globally boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.feeds (
  id bigint generated always as identity primary key,
  category_id bigint references public.categories (id) on delete set null,
  title text not null default '',
  feed_url text not null unique,
  site_url text not null default '',
  icon_url text not null default '',
  description text not null default '',
  disabled boolean not null default false,
  hide_globally boolean not null default false,
  crawler boolean not null default false,
  ignore_http_cache boolean not null default false,
  no_media_player boolean not null default false,
  server_fetch boolean not null default true,
  user_agent text not null default '',
  cookie text not null default '',
  username text not null default '',
  password text not null default '',
  scraper_rules text not null default '',
  rewrite_rules text not null default '',
  url_rewrite_rules text not null default '',
  block_filter_entry_rules text not null default '',
  keep_filter_entry_rules text not null default '',
  etag text not null default '',
  last_modified text not null default '',
  checked_at timestamptz,
  parsing_error_count integer not null default 0,
  parsing_error_msg text not null default '',
  created_at timestamptz not null default now()
);

create index feeds_category_id_idx on public.feeds (category_id);

create table public.entries (
  id bigint generated always as identity primary key,
  feed_id bigint not null references public.feeds (id) on delete cascade,
  hash text not null,
  title text not null default '',
  url text not null default '',
  comments_url text not null default '',
  author text not null default '',
  content text not null default '',
  tags text[] not null default '{}',
  enclosures jsonb not null default '[]',
  reading_time integer not null default 0,
  status text not null default 'unread' check (status in ('unread', 'read', 'removed')),
  starred boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', regexp_replace(coalesce(content, ''), '<[^>]*>', ' ', 'g')), 'B')
  ) stored,
  unique (feed_id, hash)
);

create index entries_status_published_idx on public.entries (status, published_at desc);
create index entries_feed_status_idx on public.entries (feed_id, status);
create index entries_starred_idx on public.entries (published_at desc) where starred;
create index entries_changed_idx on public.entries (changed_at desc) where status = 'read';
create index entries_search_idx on public.entries using gin (search);

create table public.settings (
  id integer primary key default 1 check (id = 1),
  block_filter_entry_rules text not null default '',
  keep_filter_entry_rules text not null default '',
  retention_days integer not null default 60 check (retention_days > 0),
  server_fetch_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1);

create table public.feed_snapshots (
  id bigint generated always as identity primary key,
  feed_id bigint not null references public.feeds (id) on delete cascade,
  body text not null,
  body_hash text generated always as (md5(body)) stored,
  etag text not null default '',
  last_modified text not null default '',
  fetched_at timestamptz not null default now(),
  unique (feed_id, body_hash)
);

create or replace function public.touch_changed_at() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status or new.starred is distinct from old.starred then
    new.changed_at := now();
  end if;
  return new;
end;
$$;

create trigger entries_touch_changed_at
before update on public.entries
for each row execute function public.touch_changed_at();

create view public.entry_list with (security_invoker = true) as
select
  e.id,
  e.feed_id,
  e.title,
  e.url,
  e.comments_url,
  e.author,
  e.tags,
  e.reading_time,
  e.status,
  e.starred,
  e.published_at,
  e.created_at,
  e.changed_at,
  e.search,
  f.title as feed_title,
  f.site_url as feed_site_url,
  f.icon_url as feed_icon_url,
  f.category_id,
  c.title as category_title,
  (f.hide_globally or coalesce(c.hide_globally, false)) as hidden
from public.entries e
join public.feeds f on f.id = e.feed_id
left join public.categories c on c.id = f.category_id;

create view public.feed_counters with (security_invoker = true) as
select
  f.id as feed_id,
  f.category_id,
  count(e.id) filter (where e.status = 'unread') as unread,
  count(e.id) filter (where e.status <> 'removed') as total
from public.feeds f
left join public.entries e on e.feed_id = f.id
group by f.id, f.category_id;

create or replace function public.mark_all_read(p_feed_id bigint default null, p_category_id bigint default null, p_before timestamptz default now())
returns integer
language sql
security invoker
set search_path = public
as $$
  with updated as (
    update public.entries e
    set status = 'read'
    from public.feeds f
    left join public.categories c on c.id = f.category_id
    where e.feed_id = f.id
      and e.status = 'unread'
      and e.created_at <= p_before
      and (p_feed_id is null or e.feed_id = p_feed_id)
      and (p_category_id is null or f.category_id = p_category_id)
      and (p_feed_id is not null or p_category_id is not null or not (f.hide_globally or coalesce(c.hide_globally, false)))
    returning e.id
  )
  select count(*)::integer from updated;
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
  update public.entries
  set status = 'removed', content = '', enclosures = '[]'
  where status = 'read'
    and not starred
    and changed_at < now() - make_interval(days => coalesce(days, 60));
  get diagnostics affected = row_count;
  delete from public.feed_snapshots where fetched_at < now() - interval '7 days';
  return affected;
end;
$$;

alter table public.categories enable row level security;
alter table public.feeds enable row level security;
alter table public.entries enable row level security;
alter table public.settings enable row level security;
alter table public.feed_snapshots enable row level security;

create policy "owner access" on public.categories for all to authenticated using (true) with check (true);
create policy "owner access" on public.feeds for all to authenticated using (true) with check (true);
create policy "owner access" on public.entries for all to authenticated using (true) with check (true);
create policy "owner access" on public.settings for all to authenticated using (true) with check (true);
create policy "owner access" on public.feed_snapshots for all to authenticated using (true) with check (true);

revoke all on public.categories, public.feeds, public.entries, public.settings, public.feed_snapshots, public.entry_list, public.feed_counters from anon;
revoke execute on function public.mark_all_read(bigint, bigint, timestamptz) from public, anon;
revoke execute on function public.cleanup_entries() from public, anon;
grant execute on function public.mark_all_read(bigint, bigint, timestamptz) to authenticated;
grant execute on function public.cleanup_entries() to authenticated;
