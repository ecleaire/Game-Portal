begin;
alter function public.portal_api(text,jsonb,text,text) rename to portal_api_before_profiles;
create function public.portal_api(p_action text,p_body jsonb default '{}',p_token_hash text default null,p_new_token_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare checked jsonb; u portal_private.users; a portal_private.admin_users; s portal_private.game_submissions; creator portal_private.users; items jsonb; page_offset integer;
begin
 if p_action <> 'social.creator' then return public.portal_api_before_profiles(p_action,p_body,p_token_hash,p_new_token_hash);end if;
 if p_token_hash is not null then
  checked:=public.portal_api_before_profiles('user.me','{}',p_token_hash,null);
  if checked->>'error'='forbidden' then checked:=public.portal_api_before_profiles('admin.me','{}',p_token_hash,null);end if;
  if checked ? 'error' then return checked;end if;
  if checked ? 'user' then select * into u from portal_private.users where id=(checked->'user'->>'id')::uuid for update;
  elsif checked ? 'admin' then select * into a from portal_private.admin_users where id=(checked->'admin'->>'id')::uuid for update;
  else return '{"error":"unauthorized"}';end if;
 end if;
 select * into s from portal_private.game_submissions where public_slug=p_body->>'slug';
 if s.id is null or portal_private.library_game(s.id,u,a)->>'unavailable'='true' then return '{"error":"not_found"}';end if;
 select * into creator from portal_private.users where id=s.user_id;
 if creator.id is null or not portal_private.available(creator) then return '{"error":"not_found"}';end if;
 page_offset:=coalesce((p_body->>'offset')::integer,0);
 if page_offset<0 or page_offset>100000 then return '{"error":"invalid_request"}';end if;
 -- Unlisted links grant access to that game, never discovery of other unlisted games.
 select coalesce(jsonb_agg(v order by created_at desc,id),'[]') into items from (
  select g.id,g.created_at,portal_private.library_game(g.id,u,a) v
  from portal_private.game_submissions g where g.user_id=creator.id
   and (g.visibility<>'unlisted' or g.user_id=u.id)
   and portal_private.library_game(g.id,u,a)->>'unavailable' is distinct from 'true'
  order by g.created_at desc,g.id limit 25 offset page_offset
 ) visible;
 return jsonb_build_object('creator',jsonb_build_object('name',coalesce(nullif(creator.display_name,''),creator.username),'avatar_key',creator.avatar_key),
  'games',items,'has_more',(select count(*)>page_offset+25 from portal_private.game_submissions g where g.user_id=creator.id
   and (g.visibility<>'unlisted' or g.user_id=u.id) and portal_private.library_game(g.id,u,a)->>'unavailable' is distinct from 'true'));
exception when invalid_text_representation or numeric_value_out_of_range then return '{"error":"invalid_request"}';
end $$;
revoke all on function public.portal_api_before_profiles(text,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.portal_api(text,jsonb,text,text) to service_role;
commit;
