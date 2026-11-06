begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(16);

insert into public.categories (id, title, hide_globally) overriding system value values (900001, 'Visible', false), (900002, 'Hidden', true);
insert into public.feeds (id, feed_url, title, category_id) overriding system value values
  (900001, 'https://a.example/feed', 'A', 900001),
  (900002, 'https://b.example/feed', 'B', 900002),
  (900003, 'https://c.example/feed', 'C', null);
insert into public.entries (feed_id, hash, title, content) values
  (900001, 'a1', 'Bicycle touring', '<p>Gravel <b>route</b></p>'),
  (900001, 'a2', 'Second', 'text'),
  (900002, 'b1', 'Hidden entry', 'text'),
  (900003, 'c1', 'Uncategorised', 'text');

select throws_ok(
  $$insert into public.entries (feed_id, hash) values (900001, 'a1')$$,
  '23505', null, 'duplicate entry hashes per feed are rejected'
);

select is(
  (select array_agg(title order by title) from public.entry_list where hidden),
  array['Hidden entry'],
  'entries of hidden categories are flagged'
);

select is(
  (select array_agg(title) from public.entry_list where search @@ websearch_to_tsquery('simple', 'route')),
  array['Bicycle touring'],
  'full text search matches content without html tags'
);

select is(
  (select array_agg(title) from public.entry_list where search @@ websearch_to_tsquery('simple', 'b')),
  null,
  'html tag names are not indexed'
);

select is(
  (select unread::int from public.feed_counters where feed_id = 900001),
  2,
  'feed counters report unread entries'
);

create temp table results (name text primary key, value int);
grant all on results to authenticated;

set local role authenticated;
insert into results select 'all', public.mark_all_read();
insert into results select 'hidden_status', (status = 'unread')::int from public.entries where hash = 'b1';
insert into results select 'category', public.mark_all_read(p_category_id => 900002);
update public.entries set status = 'unread' where hash = 'a2';
insert into results select 'feed', public.mark_all_read(p_feed_id => 900001);
reset role;

select is((select value from results where name = 'all'), 3, 'mark_all_read without scope skips hidden feeds');
select is((select value from results where name = 'hidden_status'), 1, 'hidden entry stays unread');
select is((select value from results where name = 'category'), 1, 'mark_all_read with a category marks that category');
select is((select value from results where name = 'feed'), 1, 'mark_all_read with a feed marks only that feed');

update public.entries set changed_at = now() - interval '400 days' where hash in ('a1', 'a2');
update public.entries set starred = true where hash = 'a2';
update public.entries set changed_at = now() - interval '400 days' where hash = 'a2';

select is(public.cleanup_entries(), 1, 'cleanup removes old read entries that are not starred');
select is(
  (select status || ':' || content from public.entries where hash = 'a1'),
  'removed:',
  'removed entries keep their row but lose content'
);
select is(
  (select status from public.entries where hash = 'a2'),
  'read',
  'starred entries are kept'
);

update public.settings set server_fetch_enabled = false where id = 1;
select is(public.harvest_feeds(), 0, 'harvesting is skipped when disabled');

update public.settings set server_fetch_enabled = true where id = 1;
update public.feeds set disabled = true where id = 900003;
select is(public.harvest_feeds() >= 2, true, 'harvesting queues requests for enabled feeds');
select is(
  (select count(*)::int from public.fetch_requests where feed_id = 900003),
  0,
  'disabled feeds are not fetched'
);

select is(
  (select count(*)::int from cron.job where jobname in ('rss-harvest-feeds', 'rss-collect-responses', 'rss-cleanup-entries')),
  3,
  'scheduled jobs are registered'
);

select * from finish();
rollback;
