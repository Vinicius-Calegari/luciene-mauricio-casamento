-- Keep rate limiting, invitation phrase validation and the operation in one transaction.
-- Only the Edge Function's service role can call this entry point.
create function public.rsvp_request(
  p_action text,
  p_fingerprint text,
  p_keyword_hash text,
  p_payload jsonb
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_action is null or p_action not in ('lookup','answer') then
    return jsonb_build_object('error','Ação inválida.','http_status',400);
  end if;
  if not public.rsvp_rate_limit(p_fingerprint,p_action) then
    return jsonb_build_object('error','Muitas tentativas. Aguarde 15 minutos e tente novamente.','http_status',429);
  end if;
  if coalesce(p_keyword_hash,'')='' then
    return jsonb_build_object('error','Digite a palavra-chave informada no convite.','http_status',400);
  end if;
  if p_keyword_hash<>'25217914ae5a23bf29fcfa3e21f04c4f023813294c7acb5f99e0b512d7a97fdd' then
    return jsonb_build_object('error','A palavra-chave não confere. Confira a palavra informada no convite e tente novamente.','http_status',403);
  end if;
  if p_action='lookup' then
    result=public.rsvp_lookup(p_payload->>'name',p_payload->>'last4',p_payload->>'token_hash');
  else
    result=public.rsvp_answer(p_payload->>'token_hash',p_payload->>'status',p_payload->>'message');
  end if;
  return result || jsonb_build_object('http_status',case when result ? 'error' then 400 else 200 end);
end;
$$;
revoke all on function public.rsvp_request(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.rsvp_request(text,text,text,jsonb) to service_role;
