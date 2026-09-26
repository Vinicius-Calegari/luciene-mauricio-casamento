-- Integration contract for public.rsvp_lookup.
-- Run the whole file as postgres in a dedicated transaction. Every fixture,
-- generated audit event and RSVP session is rolled back, including on failure.
-- Requires the wedding migrations. Does not change settings or real guests.
-- A successful run returns 24 cases before the final ROLLBACK.
begin;
set local statement_timeout='15s';

do $test$
declare
  run_id text=replace(gen_random_uuid()::text,'-','');
  fixture_ids uuid[]=array[
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
  ];
  unique_name text;
  alias_name text;
  homonym_name text;
  collision_name text;
  case_record record;
  response jsonb;
  session_hash text;
  expected_guest jsonb;
  successful_cases integer=0;
  checked_cases integer=0;
begin
  unique_name='Élodie Fixture '||run_id;
  alias_name='Lólo Fixture '||run_id;
  homonym_name='Homônimo Fixture '||run_id;
  collision_name='Cruzado Fixture '||run_id;

  insert into public.guests(id,full_name,alt_name,side,phone,status,deleted_at)
  values
    (fixture_ids[1],unique_name,alias_name,'luciene','5532999900000','confirmed',null),
    (fixture_ids[2],homonym_name,'','luciene','5532999901111','pending',null),
    (fixture_ids[3],homonym_name,'','mauricio','5532999902222','declined',null),
    (fixture_ids[4],homonym_name,'','luciene','5532999903333','confirmed',null),
    (fixture_ids[5],'Repetido Fixture '||run_id,'','luciene','5532999904444','pending',null),
    (fixture_ids[6],'Repetido Fixture '||run_id,'','mauricio','5532888804444','pending',null),
    (fixture_ids[7],'Semfone Fixture '||run_id,'','luciene','','pending',null),
    (fixture_ids[8],'Semfone Fixture '||run_id,'','mauricio','5532999905555','confirmed',null),
    -- A deleted match must neither be returned nor make the live name ambiguous.
    (fixture_ids[9],unique_name,'Apagado Fixture '||run_id,'luciene','5532999900000','pending',now()),
    -- Matching both full name and alias on one row still means one guest.
    (fixture_ids[10],'Mesmo Fixture '||run_id,'Mesmo Fixture '||run_id,'luciene','','pending',null),
    -- An alias on one guest can collide with another guest's complete name.
    (fixture_ids[11],collision_name,'','luciene','5532999906666','pending',null),
    (fixture_ids[12],'Outro Fixture '||run_id,collision_name,'mauricio','5532999907777','pending',null),
    (fixture_ids[13],'Excluido Fixture '||run_id,'Excluido Alias '||run_id,'luciene','','pending',now());

  for case_record in
    select * from (values
      ('exact name',unique_name,''::text,fixture_ids[1],'guest'),
      ('accent case whitespace','  ELODIE   FIXTURE '||upper(run_id)||'  ','',fixture_ids[1],'guest'),
      ('alias',alias_name,'',fixture_ids[1],'guest'),
      ('alias normalized','  LOLO   FIXTURE '||upper(run_id)||'  ','',fixture_ids[1],'guest'),
      ('unique ignores wrong phone',unique_name,'9999',fixture_ids[1],'guest'),
      ('unique ignores null phone',unique_name,null::text,fixture_ids[1],'guest'),
      ('homonyms require phone',homonym_name,'',null::uuid,'ambiguous'),
      ('homonyms null phone',homonym_name,null::text,null::uuid,'ambiguous'),
      ('homonym one',homonym_name,'1111',fixture_ids[2],'guest'),
      ('homonym two',homonym_name,'2222',fixture_ids[3],'guest'),
      ('homonym three beyond two candidates',homonym_name,'3333',fixture_ids[4],'guest'),
      ('homonym wrong phone',homonym_name,'9999',null::uuid,'notFound'),
      ('duplicate phone remains ambiguous','Repetido Fixture '||run_id,'4444',null::uuid,'notFound'),
      ('empty phones cannot identify','Semfone Fixture '||run_id,'0000',null::uuid,'notFound'),
      ('one populated phone','Semfone Fixture '||run_id,'5555',fixture_ids[8],'guest'),
      ('deleted alias','Apagado Fixture '||run_id,'',null::uuid,'notFound'),
      ('deleted full name','Excluido Fixture '||run_id,'',null::uuid,'notFound'),
      ('same full and alias not duplicate','Mesmo Fixture '||run_id,'',fixture_ids[10],'guest'),
      ('full name alias collision',collision_name,'',null::uuid,'ambiguous'),
      ('collision full name phone',collision_name,'6666',fixture_ids[11],'guest'),
      ('collision alias phone',collision_name,'7777',fixture_ids[12],'guest'),
      ('no match','Inexistente Fixture '||run_id,'',null::uuid,'notFound'),
      ('no partial match','Élodie Fixture '||left(run_id,16),'',null::uuid,'notFound'),
      ('short name','Al','',null::uuid,'notFound')
    ) as cases(label,input_name,last4,expected_id,expected_kind)
  loop
    session_hash=md5(run_id||case_record.label)||md5(case_record.label||run_id);
    response=public.rsvp_lookup(case_record.input_name,case_record.last4,session_hash);
    if case_record.expected_kind='guest' then
      select jsonb_build_object('guest',jsonb_build_object('id',g.id,'full_name',g.full_name,'status',g.status))
      into expected_guest from public.guests g where g.id=case_record.expected_id;
      if response is distinct from expected_guest then
        raise exception 'RSVP contract failed: % (response contract)',case_record.label;
      end if;
      if not exists(select 1 from private.rsvp_sessions s where s.token_hash=session_hash
        and s.guest_id=case_record.expected_id and s.expires_at=now()+interval '1 hour') then
        raise exception 'RSVP contract failed: % (session binding or expiry)',case_record.label;
      end if;
      successful_cases=successful_cases+1;
    else
      if response is distinct from jsonb_build_object(case_record.expected_kind,true) then
        raise exception 'RSVP contract failed: % (missing or ambiguous contract)',case_record.label;
      end if;
      if exists(select 1 from private.rsvp_sessions s where s.token_hash=session_hash) then
        raise exception 'RSVP contract failed: % (unexpected session)',case_record.label;
      end if;
    end if;
    checked_cases=checked_cases+1;
  end loop;

  if (select count(*) from private.rsvp_sessions where guest_id=any(fixture_ids))<>successful_cases then
    raise exception 'RSVP contract failed: unexpected session count';
  end if;
  if has_function_privilege('anon','public.rsvp_lookup(text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.rsvp_lookup(text,text,text)','EXECUTE')
    or not has_function_privilege('service_role','public.rsvp_lookup(text,text,text)','EXECUTE') then
    raise exception 'RSVP contract failed: function permissions';
  end if;
  perform set_config('test.rsvp_lookup_cases',checked_cases::text,true);
end;
$test$;

select current_setting('test.rsvp_lookup_cases')::integer as passed_cases,
       'All fixture guests, audit events and sessions are rolled back.' as cleanup;
rollback;
