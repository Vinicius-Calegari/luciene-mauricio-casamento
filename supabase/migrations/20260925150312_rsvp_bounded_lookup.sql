-- Bound name matching to the only states the API needs: none, one or multiple.
-- Existing active-name indexes remain sufficient; no extra index is required.
-- This reduces SQL work, but the measured lookup was already below 0.1 ms.
create or replace function public.rsvp_lookup(p_name text,p_last4 text,p_token_hash text)
returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  normalized text;
  candidate record;
  candidate_count integer=0;
  selected_id uuid;
  selected_name text;
  selected_status text;
begin
  normalized=private.normalize_name(p_name);
  if length(normalized)<3 then
    return jsonb_build_object('notFound',true);
  end if;

  for candidate in
    select g.id,g.full_name,g.status
    from public.guests g
    where g.deleted_at is null
      and (g.full_name_key=normalized or (g.alt_name_key<>'' and g.alt_name_key=normalized))
    limit 2
  loop
    candidate_count=candidate_count+1;
    if candidate_count=1 then
      selected_id=candidate.id;
      selected_name=candidate.full_name;
      selected_status=candidate.status;
    end if;
  end loop;

  if candidate_count=0 then
    return jsonb_build_object('notFound',true);
  end if;
  if candidate_count>1 then
    if coalesce(p_last4,'')='' then
      return jsonb_build_object('ambiguous',true);
    end if;
    -- Search the full matching set again, not just the first two candidates.
    -- A provided phone suffix is intentionally ignored for a unique name.
    candidate_count=0;
    for candidate in
      select g.id,g.full_name,g.status
      from public.guests g
      where g.deleted_at is null
        and (g.full_name_key=normalized or (g.alt_name_key<>'' and g.alt_name_key=normalized))
        and g.phone<>'' and right(g.phone,4)=p_last4
      limit 2
    loop
      candidate_count=candidate_count+1;
      if candidate_count=1 then
        selected_id=candidate.id;
        selected_name=candidate.full_name;
        selected_status=candidate.status;
      end if;
    end loop;
    if candidate_count<>1 then
      return jsonb_build_object('notFound',true);
    end if;
  end if;

  insert into private.rsvp_sessions(token_hash,guest_id)
  values(p_token_hash,selected_id);
  return jsonb_build_object('guest',jsonb_build_object('id',selected_id,'full_name',selected_name,'status',selected_status));
end;
$$;

revoke all on function public.rsvp_lookup(text,text,text) from public,anon,authenticated;
grant execute on function public.rsvp_lookup(text,text,text) to service_role;
