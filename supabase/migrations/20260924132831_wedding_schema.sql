create schema if not exists private;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_cron;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  side text not null unique check (side in ('luciene','mauricio')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profile_self on public.profiles for select to authenticated using (id = (select auth.uid()));
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;

create function private.normalize_name(value text) returns text
language sql immutable strict set search_path='' as $$
 select lower(regexp_replace(trim(extensions.unaccent(value)), '\s+', ' ', 'g'));
$$;
revoke all on function private.normalize_name(text) from public;
grant execute on function private.normalize_name(text) to authenticated,service_role;

create table public.guests (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check(length(trim(full_name)) between 3 and 180),
 alt_name text not null default '' check(length(alt_name)<=180),
 full_name_key text generated always as (private.normalize_name(full_name)) stored,
 alt_name_key text generated always as (private.normalize_name(alt_name)) stored,
 side text not null check(side in ('luciene','mauricio')),
 phone text not null default '' check(phone='' or phone ~ '^55[1-9][0-9]{9,10}$'),
 status text not null default 'pending' check(status in ('pending','confirmed','declined')),
 confirmed_at timestamptz,
 notes text not null default '' check(length(notes)<=2000),
 message text not null default '' check(length(message)<=500),
 message_read boolean not null default false,
 message_favorite boolean not null default false,
 last_reminder_at timestamptz,
 reminder_count integer not null default 0 check(reminder_count>=0),
 deleted_at timestamptz,
 deleted_by text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index guests_side_created on public.guests(side,created_at desc);
create index guests_name_active on public.guests(full_name_key) where deleted_at is null;
create index guests_alt_active on public.guests(alt_name_key) where deleted_at is null and alt_name_key<>'';
create index guests_trash on public.guests(deleted_at) where deleted_at is not null;
alter table public.guests enable row level security;
revoke all on public.guests from anon,authenticated;
grant select,insert,update,delete on public.guests to authenticated;
grant all on public.guests to service_role;
create policy guests_select on public.guests for select to authenticated
 using(side=(select p.side from public.profiles p where p.id=(select auth.uid())));
create policy guests_insert on public.guests for insert to authenticated
 with check(side=(select p.side from public.profiles p where p.id=(select auth.uid())));
create policy guests_update on public.guests for update to authenticated
 using(side=(select p.side from public.profiles p where p.id=(select auth.uid())))
 with check(side=(select p.side from public.profiles p where p.id=(select auth.uid())));
create policy guests_delete on public.guests for delete to authenticated
 using(deleted_at is not null and side=(select p.side from public.profiles p where p.id=(select auth.uid())));

create table public.wedding_settings (
 singleton boolean primary key default true check(singleton),
 draft jsonb not null default '{}'::jsonb check(jsonb_typeof(draft)='object'),
 published jsonb not null default '{}'::jsonb check(jsonb_typeof(published)='object'),
 versions jsonb not null default '[]'::jsonb check(jsonb_typeof(versions)='array'),
 updated_at timestamptz not null default now()
);
alter table public.wedding_settings enable row level security;
revoke all on public.wedding_settings from anon,authenticated;
grant select on public.wedding_settings to authenticated;
grant update(draft,published) on public.wedding_settings to authenticated;
grant all on public.wedding_settings to service_role;
create policy settings_read on public.wedding_settings for select to authenticated
 using(exists(select 1 from public.profiles where id=(select auth.uid())));
create policy settings_update on public.wedding_settings for update to authenticated
 using(exists(select 1 from public.profiles where id=(select auth.uid())))
 with check(exists(select 1 from public.profiles where id=(select auth.uid())));

create table public.audit_log (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 actor_id uuid,
 actor_type text not null,
 action text not null,
 guest_id uuid,
 guest_name text,
 details text not null default '',
 before_row jsonb,
 after_row jsonb
);
create index audit_created_at on public.audit_log(created_at desc);
create index audit_guest on public.audit_log(guest_id,created_at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon,authenticated;
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
create policy audit_read on public.audit_log for select to authenticated
 using(exists(select 1 from public.profiles where id=(select auth.uid())));

create function private.guest_before_change() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at=now();
 if TG_OP='UPDATE' then
   if new.side is distinct from old.side then raise exception 'O lado do convite não pode ser alterado.'; end if;
   if new.deleted_at is not null and old.deleted_at is null then
     select p.name into new.deleted_by from public.profiles p where p.id=auth.uid();
     new.deleted_by=coalesce(new.deleted_by,'Sistema');
   elsif new.deleted_at is null then new.deleted_by=null;
   end if;
 end if;
 return new;
end;
$$;
revoke all on function private.guest_before_change() from public;
create trigger guest_before_change before insert or update on public.guests for each row execute function private.guest_before_change();

create function private.audit_guest_change() returns trigger language plpgsql security definer set search_path='' as $$
declare actor text; event text; old_data jsonb; new_data jsonb;
begin
 select name into actor from public.profiles where id=auth.uid();
 actor=coalesce(actor, nullif(current_setting('app.audit_actor',true),''),'Sistema');
 if TG_OP='INSERT' then event='adicionou convidado';
 elsif TG_OP='DELETE' then event='excluiu definitivamente';
 elsif new.deleted_at is not null and old.deleted_at is null then event='moveu para a lixeira';
 elsif new.deleted_at is null and old.deleted_at is not null then event='restaurou convidado';
 elsif new.status is distinct from old.status then event='alterou a resposta';
 elsif new.reminder_count is distinct from old.reminder_count then event='iniciou cobrança pelo WhatsApp';
 elsif new.message_read is distinct from old.message_read or new.message_favorite is distinct from old.message_favorite then event='organizou recado';
 elsif new.message is distinct from old.message then event='atualizou recado';
 else event='editou convidado'; end if;
 if TG_OP<>'INSERT' then old_data=to_jsonb(old)-array['phone','message','notes','full_name_key','alt_name_key']; end if;
 if TG_OP<>'DELETE' then new_data=to_jsonb(new)-array['phone','message','notes','full_name_key','alt_name_key']; end if;
 insert into public.audit_log(actor_id,actor_type,action,guest_id,guest_name,details,before_row,after_row)
 values(auth.uid(),actor,event,coalesce(new.id,old.id),coalesce(new.full_name,old.full_name),'',old_data,new_data);
 return coalesce(new,old);
end;
$$;
revoke all on function private.audit_guest_change() from public;
create trigger audit_guest_change after insert or update or delete on public.guests for each row execute function private.audit_guest_change();

create function private.settings_before_change() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at=now();
 if new.published is distinct from old.published then
   select coalesce(jsonb_agg(v.value order by v.ordinality),'[]'::jsonb) into new.versions
   from jsonb_array_elements(jsonb_build_array(jsonb_build_object('published',old.published,'created_at',old.updated_at)) || old.versions)
   with ordinality v(value,ordinality) where ordinality<=10;
 else new.versions=old.versions;
 end if;
 if (new.published->>'rsvp_deadline') is null or not (new.published->>'rsvp_deadline') ~ '^\d{4}-\d{2}-\d{2}$' then
   raise exception 'Informe um prazo válido de confirmação.';
 end if;
 perform (new.published->>'rsvp_deadline')::date;
 return new;
end;
$$;
revoke all on function private.settings_before_change() from public;
create trigger settings_before_change before update on public.wedding_settings for each row execute function private.settings_before_change();

create function private.audit_settings_change() returns trigger language plpgsql security definer set search_path='' as $$
declare actor text;
begin
 select name into actor from public.profiles where id=auth.uid();
 insert into public.audit_log(actor_id,actor_type,action,details,before_row,after_row)
 values(auth.uid(),coalesce(actor,'Sistema'),
   case when new.published is distinct from old.published then 'publicou informações do casamento' else 'salvou rascunho' end,
   'Informações e configurações do casamento',
   jsonb_build_object('prazo',old.published->>'rsvp_deadline'),
   jsonb_build_object('prazo',new.published->>'rsvp_deadline'));
 return new;
end;
$$;
revoke all on function private.audit_settings_change() from public;
create trigger audit_settings_change after update on public.wedding_settings for each row execute function private.audit_settings_change();

create function private.public_wedding() returns jsonb language sql stable security definer set search_path='' as $$
 select published-'rsvp_message_template' from public.wedding_settings where singleton;
$$;
revoke all on function private.public_wedding() from public;
grant execute on function private.public_wedding() to anon,authenticated;
grant usage on schema private to anon;
create function public.get_public_wedding() returns jsonb language sql stable set search_path='' as $$
 select private.public_wedding();
$$;
revoke all on function public.get_public_wedding() from public;
grant execute on function public.get_public_wedding() to anon,authenticated,service_role;

create function private.shared_messages() returns table(
 guest_id uuid,full_name text,side text,status text,message text,
 message_read boolean,message_favorite boolean,confirmed_at timestamptz
) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Acesso restrito.'; end if;
 return query select g.id,g.full_name,g.side,g.status,g.message,g.message_read,g.message_favorite,g.confirmed_at
 from public.guests g where g.deleted_at is null and g.message<>'' order by g.confirmed_at desc nulls last;
end;
$$;
revoke all on function private.shared_messages() from public;
grant execute on function private.shared_messages() to authenticated;
create function public.get_messages() returns table(
 guest_id uuid,full_name text,side text,status text,message text,
 message_read boolean,message_favorite boolean,confirmed_at timestamptz
) language sql stable set search_path='' as $$ select * from private.shared_messages(); $$;
revoke all on function public.get_messages() from public;
grant execute on function public.get_messages() to authenticated;

create function private.message_flags(p_guest_id uuid,p_read boolean,p_favorite boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Acesso restrito.'; end if;
 update public.guests set message_read=p_read,message_favorite=p_favorite where id=p_guest_id and deleted_at is null and message<>'';
 if not found then raise exception 'Recado não encontrado.'; end if;
end;
$$;
revoke all on function private.message_flags(uuid,boolean,boolean) from public;
grant execute on function private.message_flags(uuid,boolean,boolean) to authenticated;
create function public.set_message_flags(p_guest_id uuid,p_read boolean,p_favorite boolean) returns void language sql set search_path='' as $$
 select private.message_flags(p_guest_id,p_read,p_favorite);
$$;
revoke all on function public.set_message_flags(uuid,boolean,boolean) from public;
grant execute on function public.set_message_flags(uuid,boolean,boolean) to authenticated;

create table private.rsvp_attempts(
 fingerprint text not null,
 action text not null,
 bucket timestamptz not null,
 attempts integer not null default 1,
 primary key(fingerprint,action,bucket)
);
create table private.rsvp_sessions(
 token_hash text primary key,
 guest_id uuid not null references public.guests(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '1 hour'
);
create index rsvp_sessions_guest on private.rsvp_sessions(guest_id);
alter table private.rsvp_attempts enable row level security;
alter table private.rsvp_sessions enable row level security;
grant all on private.rsvp_attempts,private.rsvp_sessions to service_role;

create function public.rsvp_rate_limit(p_fingerprint text,p_action text) returns boolean
language plpgsql set search_path='' as $$
declare counter integer; current_bucket timestamptz;
begin
 current_bucket=to_timestamp(floor(extract(epoch from now())/900)*900);
 insert into private.rsvp_attempts(fingerprint,action,bucket) values(p_fingerprint,p_action,current_bucket)
 on conflict(fingerprint,action,bucket) do update set attempts=private.rsvp_attempts.attempts+1
 returning attempts into counter;
 return counter<=20;
end;
$$;
revoke all on function public.rsvp_rate_limit(text,text) from public,anon,authenticated;
grant execute on function public.rsvp_rate_limit(text,text) to service_role;

create function public.rsvp_lookup(p_name text,p_last4 text,p_token_hash text) returns jsonb
language plpgsql set search_path='' as $$
declare found_count integer; g public.guests; normalized text;
begin
 normalized=private.normalize_name(p_name);
 if length(normalized)<3 then return jsonb_build_object('notFound',true); end if;
 select count(*) into found_count from public.guests
 where deleted_at is null and (full_name_key=normalized or (alt_name_key<>'' and alt_name_key=normalized));
 if found_count>1 and coalesce(p_last4,'')='' then return jsonb_build_object('ambiguous',true); end if;
 if found_count=0 then return jsonb_build_object('notFound',true); end if;
 if found_count>1 then
   select count(*) into found_count from public.guests where deleted_at is null
   and (full_name_key=normalized or (alt_name_key<>'' and alt_name_key=normalized))
   and phone<>'' and right(phone,4)=p_last4;
   if found_count<>1 then return jsonb_build_object('notFound',true); end if;
   select * into g from public.guests where deleted_at is null
   and (full_name_key=normalized or (alt_name_key<>'' and alt_name_key=normalized))
   and phone<>'' and right(phone,4)=p_last4 limit 1;
 else
   select * into g from public.guests where deleted_at is null
   and (full_name_key=normalized or (alt_name_key<>'' and alt_name_key=normalized)) limit 1;
 end if;
 insert into private.rsvp_sessions(token_hash,guest_id) values(p_token_hash,g.id);
 return jsonb_build_object('guest',jsonb_build_object('id',g.id,'full_name',g.full_name,'status',g.status));
end;
$$;
revoke all on function public.rsvp_lookup(text,text,text) from public,anon,authenticated;
grant execute on function public.rsvp_lookup(text,text,text) to service_role;

create function public.rsvp_answer(p_token_hash text,p_status text,p_message text) returns jsonb
language plpgsql set search_path='' as $$
declare selected_guest uuid; deadline date;
begin
 if p_status not in ('confirmed','declined') or p_status is null then return jsonb_build_object('error','Resposta inválida.'); end if;
 if length(p_message)>500 then return jsonb_build_object('error','O recado deve ter no máximo 500 caracteres.'); end if;
 select (published->>'rsvp_deadline')::date into deadline from public.wedding_settings where singleton;
 if deadline is null or (now() at time zone 'America/Sao_Paulo')::date>deadline then return jsonb_build_object('error','O prazo para confirmar presença já encerrou. Fale com os noivos.'); end if;
 select guest_id into selected_guest from private.rsvp_sessions where token_hash=p_token_hash and expires_at>now();
 if selected_guest is null then return jsonb_build_object('error','Sua sessão expirou. Busque seu nome novamente.'); end if;
 perform set_config('app.audit_actor','Convidado via página pública',true);
 update public.guests set status=p_status,confirmed_at=now(),
 message=case when p_message is null then message else regexp_replace(p_message,'[\x00-\x08\x0B\x0C\x0E-\x1F]','','g') end,
 message_read=case when p_message is null then message_read else false end
 where id=selected_guest and deleted_at is null;
 if not found then return jsonb_build_object('error','Convite não encontrado. Fale com os noivos.'); end if;
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.rsvp_answer(text,text,text) from public,anon,authenticated;
grant execute on function public.rsvp_answer(text,text,text) to service_role;

insert into public.wedding_settings(singleton,draft,published)
select true, config,config from (
 select jsonb_build_object(
 'couple_names','Luciene & Mauricio','wedding_date','','wedding_time','',
 'rsvp_deadline','2026-11-30',
 'bible_verse_text','O meu amado é meu, e eu sou dele.','bible_verse_ref','Cantares 2:16, ARC',
 'rsvp_message_template','Oi, {nome}! Tudo bem? Estamos muito felizes em ter você no nosso casamento 💚 Ainda não recebemos a sua confirmação. Você pode confirmar por aqui até {prazo}: {link}. Com carinho, {noivos}',
 'show_schedule',true,'show_venues',true,'show_announcements',true,
 'schedule','[]'::jsonb,'venues','[]'::jsonb,'announcements','[]'::jsonb
 ) config
) defaults;

select cron.schedule('wedding-trash-cleanup','20 6 * * *',
 $cron$
 delete from public.guests where deleted_at < now()-interval '30 days';
 delete from private.rsvp_sessions where expires_at < now();
 delete from private.rsvp_attempts where bucket < now()-interval '2 days';
 $cron$);
