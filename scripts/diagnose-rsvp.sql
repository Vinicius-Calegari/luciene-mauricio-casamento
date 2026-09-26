-- Non-mutating RSVP database diagnostics. Run as an administrative role.
-- No guest name, phone, message or token is returned. No RSVP session is created.
-- The lookup key is selected privately from one active row for a realistic plan.
-- All session settings are local to this transaction and are rolled back.
-- Compare SQL execution separately from HTTP/Edge/browser measurements.
begin read only;
set local statement_timeout='10s';

do $diagnostic$
declare lookup_key text;
begin
  select full_name_key into lookup_key
  from public.guests where deleted_at is null order by id limit 1;
  perform set_config('diagnostic.rsvp_lookup_key',
    coalesce(lookup_key,'no-active-guest-'||gen_random_uuid()::text),true);
end;
$diagnostic$;

-- Exact row counts; estimates can be stale immediately after initial setup.
select now() as captured_at,
       (select count(*) from public.guests) as guests_total,
       (select count(*) from public.guests where deleted_at is null) as guests_active,
       (select count(*) from public.guests where deleted_at is not null) as guests_trashed,
       (select count(*) from private.rsvp_attempts) as attempt_buckets,
       (select count(*) from private.rsvp_sessions) as sessions,
       (select count(*) from public.audit_log) as audit_events;

select n.nspname as schema,c.relname as relation,
       pg_relation_size(c.oid) as heap_bytes,
       pg_indexes_size(c.oid) as index_bytes,
       pg_total_relation_size(c.oid) as total_bytes
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and n.nspname in ('public','private')
order by n.nspname,c.relname;

select schemaname,tablename,indexname,indexdef
from pg_indexes where schemaname in ('public','private')
order by schemaname,tablename,indexname;

-- BEFORE: the old unique-name path ran both of these SELECTs.
explain (analyze,buffers,format json)
select count(*) from public.guests
where deleted_at is null
  and (full_name_key=current_setting('diagnostic.rsvp_lookup_key')
    or (alt_name_key<>'' and alt_name_key=current_setting('diagnostic.rsvp_lookup_key')));

explain (analyze,buffers,format json)
select * from public.guests
where deleted_at is null
  and (full_name_key=current_setting('diagnostic.rsvp_lookup_key')
    or (alt_name_key<>'' and alt_name_key=current_setting('diagnostic.rsvp_lookup_key')))
limit 1;

-- AFTER: the bounded lookup fetches at most two public result candidates.
-- No COUNT and no SELECT *. Homonyms get a second bounded phone-suffix query.
-- These SELECT-only plans exclude session insertion and PL/pgSQL overhead.
explain (analyze,buffers,format json)
select g.id,g.full_name,g.status
from public.guests g
where g.deleted_at is null
  and (g.full_name_key=current_setting('diagnostic.rsvp_lookup_key')
    or (g.alt_name_key<>'' and g.alt_name_key=current_setting('diagnostic.rsvp_lookup_key')))
limit 2;

-- Cumulative server SQL metrics, excluding the HTTP network path.
-- Multiple rows for an operation represent different normalized query shapes.
select case
         when query like '%"rsvp_request"%' then 'rsvp_request'
         when query like '%"rsvp_lookup"%' then 'rsvp_lookup'
         when query like '%"rsvp_rate_limit"%' then 'rsvp_rate_limit'
         when query like '%"get_public_wedding"%' then 'get_public_wedding'
       end as operation,
       calls,round(mean_exec_time::numeric,3) as mean_exec_ms,
       round(min_exec_time::numeric,3) as min_exec_ms,
       round(max_exec_time::numeric,3) as max_exec_ms,
       shared_blks_hit,shared_blks_read,temp_blks_read,temp_blks_written
from extensions.pg_stat_statements
where query like 'WITH pgrst_source AS%'
  and (query like '%"rsvp_request"%' or query like '%"rsvp_lookup"%'
    or query like '%"rsvp_rate_limit"%' or query like '%"get_public_wedding"%')
order by calls desc;
select stats_reset from extensions.pg_stat_statements_info;

-- Snapshot only: idle ClientRead waits mean reusable idle connections.
-- This cannot measure historical or external gateway/pool queue delays.
select application_name,backend_type,coalesce(state,'background') as state,
       coalesce(wait_event_type,'none') as wait_type,
       coalesce(wait_event,'none') as wait_event,count(*) as connections
from pg_stat_activity where datname=current_database()
group by application_name,backend_type,state,wait_event_type,wait_event
order by connections desc;

select current_setting('max_connections') as max_connections,
       (select count(*) from pg_locks where not granted) as ungranted_locks,
       (select count(*) from pg_stat_activity
        where datname=current_database() and wait_event_type='Lock') as lock_waiting_backends;
select numbackends,deadlocks,temp_files,temp_bytes,stats_reset
from pg_stat_database where datname=current_database();

rollback;
