begin;
alter table portal_private.users add column bio text not null default '' check(char_length(bio)<=1000);
drop trigger moderate_users on portal_private.users;
create trigger moderate_users before insert or update on portal_private.users for each row execute function portal_private.moderate_fields('username','display_name','bio');
alter function portal_private.user_view(portal_private.users) rename to user_view_before_bio;
create function portal_private.user_view(u portal_private.users) returns jsonb language sql stable set search_path='' as $$
 select portal_private.user_view_before_bio(u)||jsonb_build_object('bio',u.bio);
$$;
alter function public.portal_api(text,jsonb,text,text) rename to portal_api_before_bio;
create function public.portal_api(p_action text,p_body jsonb default '{}',p_token_hash text default null,p_new_token_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; u portal_private.users; bio_value text; field_name text;
begin
 if p_action='user.profile' and p_body ? 'bio' then
  if jsonb_typeof(p_body->'bio') is distinct from 'string' or char_length(p_body->>'bio')>1000 then return '{"error":"invalid_bio"}';end if;
 end if;
 result:=public.portal_api_before_bio(p_action,p_body,p_token_hash,p_new_token_hash);
 if result ? 'error' then return result;end if;
 if p_action='user.profile' and p_body ? 'bio' and result ? 'user' then
  -- Only the authenticated user returned by the old action can be updated.
  -- A forbidden bio rolls back the display name/icon change as well.
  update portal_private.users set bio=p_body->>'bio',updated_at=now() where id=(result->'user'->>'id')::uuid returning * into u;
  return result||jsonb_build_object('user',portal_private.user_view(u));
 end if;
 if p_action='social.creator' and result ? 'creator' then
  -- The existing profile endpoint must grant access first. Never expose a
  -- biography using a user ID, a hidden game, a BAN, or an expired session.
  select owner.bio into bio_value from portal_private.game_submissions s join portal_private.users owner on owner.id=s.user_id where s.public_slug=p_body->>'slug';
  return result||jsonb_build_object('creator',(result->'creator')||jsonb_build_object('bio',coalesce(bio_value,'')));
 end if;
 return result;
exception when sqlstate 'PT001' or sqlstate 'PT002' then
 get stacked diagnostics field_name=pg_exception_detail;
 return jsonb_build_object('error',case when sqlstate='PT001' then 'content_blocked' else 'url_not_allowed' end,'field',field_name);
end $$;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
revoke all on function public.portal_api_before_bio(text,jsonb,text,text),public.portal_api(text,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.portal_api(text,jsonb,text,text) to service_role;
commit;
