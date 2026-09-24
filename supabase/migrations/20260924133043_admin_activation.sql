create table private.admin_invites (
 token_hash text primary key,
 side text not null unique check(side in ('luciene','mauricio')),
 state text not null default 'available' check(state in ('available','reserved','used')),
 reserved_at timestamptz,
 expires_at timestamptz not null default now()+interval '90 days',
 user_id uuid references auth.users(id) on delete set null
);
alter table private.admin_invites enable row level security;
grant all on private.admin_invites to service_role;

create function public.reserve_admin_invite(p_token_hash text) returns jsonb language plpgsql set search_path='' as $$
declare selected_side text;
begin
 update private.admin_invites i set state='reserved',reserved_at=now()
 where token_hash=p_token_hash and expires_at>now()
 and (state='available' or (state='reserved' and reserved_at<now()-interval '10 minutes'))
 and not exists(select 1 from public.profiles p where p.side=i.side)
 returning side into selected_side;
 return jsonb_build_object('side',selected_side);
end;
$$;
revoke all on function public.reserve_admin_invite(text) from public,anon,authenticated;
grant execute on function public.reserve_admin_invite(text) to service_role;

create function public.release_admin_invite(p_token_hash text) returns jsonb language plpgsql set search_path='' as $$
begin
 update private.admin_invites set state='available',reserved_at=null where token_hash=p_token_hash and state='reserved';
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.release_admin_invite(text) from public,anon,authenticated;
grant execute on function public.release_admin_invite(text) to service_role;

create function public.finish_admin_invite(p_token_hash text,p_user_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare selected_side text;
begin
 select side into selected_side from private.admin_invites where token_hash=p_token_hash and state='reserved'
 and expires_at>now() for update;
 if selected_side is null then raise exception 'Convite indisponível.'; end if;
 insert into public.profiles(id,name,side)
 values(p_user_id,case when selected_side='luciene' then 'Luciene' else 'Mauricio' end,selected_side);
 update private.admin_invites set state='used',user_id=p_user_id where token_hash=p_token_hash;
 insert into public.audit_log(actor_id,actor_type,action,details)
 values(p_user_id,case when selected_side='luciene' then 'Luciene' else 'Mauricio' end,'ativou o acesso ao painel','Primeiro acesso protegido por convite');
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.finish_admin_invite(text,uuid) from public,anon,authenticated;
grant execute on function public.finish_admin_invite(text,uuid) to service_role;

create or replace function public.rsvp_rate_limit(p_fingerprint text,p_action text) returns boolean
language plpgsql set search_path='' as $$
declare counter integer; current_bucket timestamptz;
begin
 current_bucket=to_timestamp(floor(extract(epoch from now())/900)*900);
 insert into private.rsvp_attempts(fingerprint,action,bucket) values(p_fingerprint,p_action,current_bucket)
 on conflict(fingerprint,action,bucket) do update set attempts=private.rsvp_attempts.attempts+1
 returning attempts into counter;
 return counter<=case when p_action='activate' then 5 else 20 end;
end;
$$;
