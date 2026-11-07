-- Per-event attendance decisions and server-side event-detail release.
alter table public.guests
  add column if not exists celebration_status text not null default 'pending'
    check (celebration_status in ('pending','confirmed','declined')),
  add column if not exists ceremony_status text not null default 'pending'
    check (ceremony_status in ('pending','confirmed','declined'));

update public.guests
set celebration_status = case when invited_to_celebration then status else 'pending' end,
    ceremony_status = case when invited_to_ceremony then status else 'pending' end;

create or replace function private.public_wedding()
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select (s.published - 'rsvp_message_template' - 'wedding_date' - 'wedding_time')
    || jsonb_build_object('schedule','[]'::jsonb,'venues','[]'::jsonb,'announcements','[]'::jsonb)
  from public.wedding_settings s where singleton;
$function$;

create or replace function private.guest_event_details(p_guest_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  g public.guests%rowtype;
  settings jsonb;
  event_schedule jsonb := '[]'::jsonb;
  event_venues jsonb := '[]'::jsonb;
  event_announcements jsonb := '[]'::jsonb;
  has_celebration boolean;
  has_ceremony boolean;
begin
  select * into g from public.guests where id=p_guest_id and deleted_at is null;
  if not found then return null; end if;
  has_celebration := g.invited_to_celebration and g.celebration_status='confirmed';
  has_ceremony := g.invited_to_ceremony and g.ceremony_status='confirmed';
  if not has_celebration and not has_ceremony then return null; end if;
  select published into settings from public.wedding_settings where singleton;

  if coalesce((settings->>'show_schedule')::boolean,false) then
    select coalesce(jsonb_agg(item order by item->>'time'),'[]'::jsonb) into event_schedule
    from jsonb_array_elements(coalesce(settings->'schedule','[]'::jsonb)) item
    where coalesce((item->>'visible')::boolean,false)
      and ((has_celebration and coalesce(item->>'event_scope','both') in ('celebration','both'))
        or (has_ceremony and coalesce(item->>'event_scope','both') in ('ceremony','both')));
  end if;

  if coalesce((settings->>'show_venues')::boolean,false) then
    select coalesce(jsonb_agg(item),'[]'::jsonb) into event_venues
    from jsonb_array_elements(coalesce(settings->'venues','[]'::jsonb)) item
    where coalesce((item->>'visible')::boolean,false)
      and (
        (has_celebration and coalesce(item->>'event_scope',
          case when lower(coalesce(item->>'type','')) like '%cerim%' then 'ceremony'
               when lower(coalesce(item->>'type','')) like '%recep%' or lower(coalesce(item->>'type','')) like '%celebra%' then 'celebration'
               else 'both' end) in ('celebration','both'))
        or
        (has_ceremony and coalesce(item->>'event_scope',
          case when lower(coalesce(item->>'type','')) like '%cerim%' then 'ceremony'
               when lower(coalesce(item->>'type','')) like '%recep%' or lower(coalesce(item->>'type','')) like '%celebra%' then 'celebration'
               else 'both' end) in ('ceremony','both'))
      );
  end if;

  if coalesce((settings->>'show_announcements')::boolean,false) then
    select coalesce(jsonb_agg(item),'[]'::jsonb) into event_announcements
    from jsonb_array_elements(coalesce(settings->'announcements','[]'::jsonb)) item
    where coalesce((item->>'visible')::boolean,false)
      and (nullif(item->>'expires_at','') is null or (item->>'expires_at')::date >= (now() at time zone 'America/Sao_Paulo')::date)
      and ((has_celebration and coalesce(item->>'event_scope','both') in ('celebration','both'))
        or (has_ceremony and coalesce(item->>'event_scope','both') in ('ceremony','both')));
  end if;

  return jsonb_build_object(
    'wedding_date',coalesce(settings->'wedding_date','null'::jsonb),
    'wedding_time',coalesce(settings->'wedding_time','null'::jsonb),
    'schedule',event_schedule,'venues',event_venues,'announcements',event_announcements,
    'confirmed_events',to_jsonb(array_remove(array[
      case when has_celebration then 'celebration' end,
      case when has_ceremony then 'ceremony' end
    ],null))
  );
end;
$function$;
revoke all on function private.guest_event_details(uuid) from public,anon,authenticated;
grant execute on function private.guest_event_details(uuid) to service_role;

create or replace function public.rsvp_lookup(p_name text,p_last4 text,p_token_hash text)
returns jsonb language plpgsql set search_path = ''
as $function$
declare
  normalized text;
  candidate record;
  candidate_count integer := 0;
  selected_id uuid;
  selected_name text;
  selected_status text;
  selected_invited_celebration boolean;
  selected_invited_ceremony boolean;
  selected_celebration_status text;
  selected_ceremony_status text;
  event_info jsonb;
begin
  normalized := private.normalize_name(p_name);
  if length(normalized)<3 then return jsonb_build_object('notFound',true); end if;
  for candidate in
    select g.id,g.full_name,g.status,g.invited_to_celebration,g.invited_to_ceremony,g.celebration_status,g.ceremony_status
    from public.guests g where g.deleted_at is null
      and (g.full_name_key=normalized or (g.alt_name_key<>'' and g.alt_name_key=normalized)) limit 2
  loop
    candidate_count:=candidate_count+1;
    if candidate_count=1 then
      selected_id:=candidate.id; selected_name:=candidate.full_name; selected_status:=candidate.status;
      selected_invited_celebration:=candidate.invited_to_celebration; selected_invited_ceremony:=candidate.invited_to_ceremony;
      selected_celebration_status:=candidate.celebration_status; selected_ceremony_status:=candidate.ceremony_status;
    end if;
  end loop;
  if candidate_count=0 then return jsonb_build_object('notFound',true); end if;
  if candidate_count>1 then
    if coalesce(p_last4,'')='' then return jsonb_build_object('ambiguous',true); end if;
    candidate_count:=0;
    for candidate in
      select g.id,g.full_name,g.status,g.invited_to_celebration,g.invited_to_ceremony,g.celebration_status,g.ceremony_status
      from public.guests g where g.deleted_at is null
        and (g.full_name_key=normalized or (g.alt_name_key<>'' and g.alt_name_key=normalized))
        and g.phone<>'' and right(g.phone,4)=p_last4 limit 2
    loop
      candidate_count:=candidate_count+1;
      if candidate_count=1 then
        selected_id:=candidate.id; selected_name:=candidate.full_name; selected_status:=candidate.status;
        selected_invited_celebration:=candidate.invited_to_celebration; selected_invited_ceremony:=candidate.invited_to_ceremony;
        selected_celebration_status:=candidate.celebration_status; selected_ceremony_status:=candidate.ceremony_status;
      end if;
    end loop;
    if candidate_count<>1 then return jsonb_build_object('notFound',true); end if;
  end if;
  insert into private.rsvp_sessions(token_hash,guest_id) values(p_token_hash,selected_id);
  if (selected_invited_celebration and selected_celebration_status='confirmed')
     or (selected_invited_ceremony and selected_ceremony_status='confirmed') then
    event_info:=private.guest_event_details(selected_id);
  else event_info:=null; end if;
  return jsonb_build_object('guest',jsonb_build_object(
    'id',selected_id,'full_name',selected_name,'status',selected_status,
    'invited_to_celebration',selected_invited_celebration,'invited_to_ceremony',selected_invited_ceremony,
    'celebration_status',selected_celebration_status,'ceremony_status',selected_ceremony_status
  ),'event_info',event_info);
end;
$function$;

create or replace function public.rsvp_answer(p_token_hash text,p_responses jsonb,p_message text)
returns jsonb language plpgsql set search_path = ''
as $function$
declare
  selected_guest public.guests%rowtype;
  deadline date;
  next_celebration_status text;
  next_ceremony_status text;
  aggregate_status text;
  event_info jsonb;
begin
  if p_responses is null or jsonb_typeof(p_responses)<>'object' then
    return jsonb_build_object('error','Informe sua resposta para cada evento do convite.');
  end if;
  if length(p_message)>500 then return jsonb_build_object('error','O recado deve ter no máximo 500 caracteres.'); end if;
  select (published->>'rsvp_deadline')::date into deadline from public.wedding_settings where singleton;
  if deadline is null or (now() at time zone 'America/Sao_Paulo')::date>deadline then
    return jsonb_build_object('error','O prazo para confirmar presença já encerrou. Fale com os noivos.');
  end if;
  select g.* into selected_guest from private.rsvp_sessions s
    join public.guests g on g.id=s.guest_id
    where s.token_hash=p_token_hash and s.expires_at>now() and g.deleted_at is null;
  if not found then return jsonb_build_object('error','Sua sessão expirou. Busque seu nome novamente.'); end if;
  if not selected_guest.invited_to_celebration and not selected_guest.invited_to_ceremony then
    return jsonb_build_object('error','Este convite não possui eventos liberados. Fale com os noivos.');
  end if;
  if selected_guest.invited_to_celebration then
    if p_responses->>'celebration' not in ('confirmed','declined') then return jsonb_build_object('error','Selecione sua resposta para a celebração.'); end if;
    next_celebration_status:=p_responses->>'celebration';
  else
    if p_responses ? 'celebration' then return jsonb_build_object('error','Este convite não inclui a celebração.'); end if;
    next_celebration_status:=selected_guest.celebration_status;
  end if;
  if selected_guest.invited_to_ceremony then
    if p_responses->>'ceremony' not in ('confirmed','declined') then return jsonb_build_object('error','Selecione sua resposta para a cerimônia.'); end if;
    next_ceremony_status:=p_responses->>'ceremony';
  else
    if p_responses ? 'ceremony' then return jsonb_build_object('error','Este convite não inclui a cerimônia.'); end if;
    next_ceremony_status:=selected_guest.ceremony_status;
  end if;
  if (selected_guest.invited_to_celebration and next_celebration_status='confirmed')
     or (selected_guest.invited_to_ceremony and next_ceremony_status='confirmed') then aggregate_status:='confirmed';
  elsif (not selected_guest.invited_to_celebration or next_celebration_status='declined')
     and (not selected_guest.invited_to_ceremony or next_ceremony_status='declined') then aggregate_status:='declined';
  else aggregate_status:='pending'; end if;
  perform set_config('app.audit_actor','Convidado via página pública',true);
  update public.guests set
    celebration_status=next_celebration_status,ceremony_status=next_ceremony_status,status=aggregate_status,
    confirmed_at=case when aggregate_status='confirmed' then now() else null end,
    message=case when p_message is null then message else regexp_replace(p_message,'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]','','g') end,
    message_read=case when p_message is null then message_read else false end
  where id=selected_guest.id and deleted_at is null;
  if not found then return jsonb_build_object('error','Convite não encontrado. Fale com os noivos.'); end if;
  event_info:=private.guest_event_details(selected_guest.id);
  return jsonb_build_object('ok',true,'status',aggregate_status,
    'celebration_status',next_celebration_status,'ceremony_status',next_ceremony_status,'event_info',event_info);
end;
$function$;

create or replace function public.rsvp_request(p_action text,p_fingerprint text,p_keyword_hash text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_action is null or p_action not in ('lookup','answer') then return jsonb_build_object('error','Ação inválida.','http_status',400); end if;
  if not public.rsvp_rate_limit(p_fingerprint,p_action) then return jsonb_build_object('error','Muitas tentativas. Aguarde 15 minutos e tente novamente.','http_status',429); end if;
  if coalesce(p_keyword_hash,'')='' then return jsonb_build_object('error','Digite a palavra-chave informada no convite.','http_status',400); end if;
  if p_keyword_hash<>'25217914ae5a23bf29fcfa3e21f04c4f023813294c7acb5f99e0b512d7a97fdd' then
    return jsonb_build_object('error','A palavra-chave não confere. Confira a palavra informada no convite e tente novamente.','http_status',403);
  end if;
  if p_action='lookup' then result:=public.rsvp_lookup(p_payload->>'name',p_payload->>'last4',p_payload->>'token_hash');
  else result:=public.rsvp_answer(p_payload->>'token_hash',p_payload->'responses',p_payload->>'message'); end if;
  return result || jsonb_build_object('http_status',case when result ? 'error' then 400 else 200 end);
end;
$$;
revoke all on function public.rsvp_request(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.rsvp_request(text,text,text,jsonb) to service_role;
