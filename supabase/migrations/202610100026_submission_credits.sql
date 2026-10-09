begin;
alter table portal_private.game_submissions add column credits text not null default '' check(char_length(credits)<=8000);
alter function portal_private.submission_view(portal_private.game_submissions,boolean) rename to submission_view_before_credits;
create function portal_private.submission_view(s portal_private.game_submissions,include_storage boolean default false) returns jsonb language sql stable set search_path='' as $$
 select portal_private.submission_view_before_credits(s,include_storage)||jsonb_build_object('credits',s.credits);
$$;
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_credits;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; s portal_private.game_submissions;
begin
 if action not in ('user.submission.create','user.submission.update','user.submission.save') or not body ? 'credits' then
  return portal_private.submission_action_before_credits(u,action,body);
 end if;
 if jsonb_typeof(body->'credits') is distinct from 'string' or char_length(body->>'credits')>8000 then return '{"error":"invalid_request"}';end if;
 result:=portal_private.submission_action_before_credits(u,action,body);
 if result ? 'error' or not result ? 'submission' then return result;end if;
 -- Existing action must authorize and complete successfully before any write.
 update portal_private.game_submissions set credits=body->>'credits' where id=(result->'submission'->>'id')::uuid and user_id=u.id returning * into s;
 if s.id is null then return '{"error":"not_found"}';end if;
 return result||jsonb_build_object('submission',portal_private.submission_view(s));
end $$;
alter function public.portal_public_game(text) rename to portal_public_game_before_credits;
create function public.portal_public_game(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when v is null then null else v||jsonb_build_object('credits',s.credits) end
 from public.portal_public_game_before_credits(p_slug) v left join portal_private.game_submissions s on s.public_slug=p_slug;
$$;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
revoke all on function public.portal_public_game_before_credits(text),public.portal_public_game(text) from public,anon,authenticated,service_role;
grant execute on function public.portal_public_game(text) to service_role;
commit;
