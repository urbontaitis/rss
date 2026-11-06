begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(22);

select has_table('public', 'categories', 'categories table exists');
select has_table('public', 'feeds', 'feeds table exists');
select has_table('public', 'entries', 'entries table exists');
select has_table('public', 'settings', 'settings table exists');
select has_table('public', 'feed_snapshots', 'feed_snapshots table exists');
select has_view('public', 'entry_list', 'entry_list view exists');
select has_view('public', 'feed_counters', 'feed_counters view exists');

select ok((select relrowsecurity from pg_class where oid = 'public.categories'::regclass), 'RLS enabled on categories');
select ok((select relrowsecurity from pg_class where oid = 'public.feeds'::regclass), 'RLS enabled on feeds');
select ok((select relrowsecurity from pg_class where oid = 'public.entries'::regclass), 'RLS enabled on entries');
select ok((select relrowsecurity from pg_class where oid = 'public.settings'::regclass), 'RLS enabled on settings');
select ok((select relrowsecurity from pg_class where oid = 'public.feed_snapshots'::regclass), 'RLS enabled on feed_snapshots');
select ok((select relrowsecurity from pg_class where oid = 'public.fetch_requests'::regclass), 'RLS enabled on fetch_requests');

select ok(
  (select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.entry_list'::regclass),
  'entry_list runs with the caller permissions'
);
select ok(
  (select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.feed_counters'::regclass),
  'feed_counters runs with the caller permissions'
);

select ok(not has_table_privilege('anon', 'public.entries', 'select'), 'anon cannot read entries');
select ok(not has_table_privilege('anon', 'public.feeds', 'select'), 'anon cannot read feeds');
select ok(not has_function_privilege('anon', 'public.mark_all_read(bigint, bigint, timestamptz)', 'execute'), 'anon cannot mark entries read');
select ok(not has_function_privilege('authenticated', 'public.harvest_feeds()', 'execute'), 'authenticated cannot trigger harvesting directly');

select is((select count(*)::int from public.settings), 1, 'settings has exactly one row');
select throws_ok($$insert into public.settings (id) values (2)$$, '23514', null, 'a second settings row is rejected');
select throws_ok($$insert into public.feeds (feed_url) values ('file:///etc/passwd')$$, '23514', null, 'non http feed urls are rejected');

select * from finish();
rollback;
