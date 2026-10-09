begin;
-- Null preserves 'not declared' for older submissions; never infer no AI use.
alter table portal_private.game_submissions add column ai_used boolean;
alter table portal_private.game_submissions add column ai_types text[] not null default '{}';
alter table portal_private.game_submissions add constraint game_ai_disclosure_check check (
 (ai_used is true and cardinality(ai_types) between 1 and 5 and ai_types <@ array['image','audio','text','code','other']::text[])
 or (ai_used is not true and cardinality(ai_types)=0));
alter function portal_private.submission_view(portal_private.game_submissions,boolean) rename to submission_view_before_ai;
create function portal_private.submission_view(s portal_private.game_submissions,include_storage boolean default false) returns jsonb language sql stable set search_path='' as $$
 select portal_private.submission_view_before_ai(s,include_storage)||jsonb_build_object('ai_used',s.ai_used,'ai_types',s.ai_types);
$$;
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_ai;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; s portal_private.game_submissions; used boolean; types text[];
begin
 if action not in ('user.submission.create','user.submission.update','user.submission.save') then return portal_private.submission_action_before_ai(u,action,body);end if;
 if body ? 'ai_used' or body ? 'ai_types' then
  if jsonb_typeof(body->'ai_used') is distinct from 'boolean' or jsonb_typeof(body->'ai_types') is distinct from 'array' then return '{"error":"invalid_ai"}';end if;
  if jsonb_array_length(body->'ai_types')>5 or exists(select 1 from jsonb_array_elements(body->'ai_types') v where jsonb_typeof(v) <> 'string') then return '{"error":"invalid_ai"}';end if;
  used:=(body->>'ai_used')::boolean;
  select coalesce(array_agg(v),'{}') into types from jsonb_array_elements_text(body->'ai_types') v;
  if not types <@ array['image','audio','text','code','other']::text[] or cardinality(types)<>(select count(distinct v) from unnest(types) v)
   or (used and cardinality(types)=0) or (not used and cardinality(types)>0) then return '{"error":"invalid_ai"}';end if;
 else
  -- Legacy callers keep the existing declaration on edit; old clients can still
  -- create a submission with the honest 'not declared' state during rollout.
  return portal_private.submission_action_before_ai(u,action,body);
 end if;
 result:=portal_private.submission_action_before_ai(u,action,body);
 if result ? 'error' or not result ? 'submission' then return result;end if;
 update portal_private.game_submissions set ai_used=used,ai_types=types where id=(result->'submission'->>'id')::uuid and user_id=u.id returning * into s;
 if s.id is null then return '{"error":"not_found"}';end if;
 return result||jsonb_build_object('submission',portal_private.submission_view(s));
end $$;
alter function public.portal_public_game(text) rename to portal_public_game_before_ai;
create function public.portal_public_game(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when v is null then null else v||jsonb_build_object('ai_used',s.ai_used,'ai_types',s.ai_types) end
 from public.portal_public_game_before_ai(p_slug) v left join portal_private.game_submissions s on s.public_slug=p_slug;
$$;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
revoke all on function public.portal_public_game_before_ai(text),public.portal_public_game(text) from public,anon,authenticated,service_role;
grant execute on function public.portal_public_game(text) to service_role;
commit;
