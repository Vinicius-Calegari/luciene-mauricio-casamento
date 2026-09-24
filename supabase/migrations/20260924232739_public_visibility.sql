create or replace function private.public_wedding() returns jsonb
language sql stable security definer set search_path='' as $$
 select (s.published-'rsvp_message_template') || jsonb_build_object(
 'schedule',case when coalesce((s.published->>'show_schedule')::boolean,false) then
   (select coalesce(jsonb_agg(item order by item->>'time'),'[]'::jsonb) from jsonb_array_elements(coalesce(s.published->'schedule','[]'::jsonb)) item where coalesce((item->>'visible')::boolean,false))
   else '[]'::jsonb end,
 'venues',case when coalesce((s.published->>'show_venues')::boolean,false) then
   (select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(coalesce(s.published->'venues','[]'::jsonb)) item where coalesce((item->>'visible')::boolean,false))
   else '[]'::jsonb end,
 'announcements',case when coalesce((s.published->>'show_announcements')::boolean,false) then
   (select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(coalesce(s.published->'announcements','[]'::jsonb)) item
    where coalesce((item->>'visible')::boolean,false)
    and (nullif(item->>'expires_at','') is null or (item->>'expires_at')::date >= (now() at time zone 'America/Sao_Paulo')::date))
   else '[]'::jsonb end
 ) from public.wedding_settings s where singleton;
$$;
-- Clients may update only draft/published; trusted maintenance may prune old versions.
create or replace function private.settings_before_change() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at=now();
 if new.published is distinct from old.published then
   select coalesce(jsonb_agg(v.value order by v.ordinality),'[]'::jsonb) into new.versions
   from jsonb_array_elements(jsonb_build_array(jsonb_build_object('published',old.published,'created_at',old.updated_at)) || old.versions)
   with ordinality v(value,ordinality) where ordinality<=10;
 end if;
 if (new.published->>'rsvp_deadline') is null or not (new.published->>'rsvp_deadline') ~ '^\d{4}-\d{2}-\d{2}$' then
   raise exception 'Informe um prazo válido de confirmação.';
 end if;
 perform (new.published->>'rsvp_deadline')::date;
 return new;
end;
$$;
