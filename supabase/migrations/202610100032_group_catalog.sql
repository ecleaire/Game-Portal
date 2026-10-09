begin;
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_group_catalog;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; games jsonb;
begin
 if action='user.shared.games' and nullif(body->>'group_id','') is not null then
  if not exists(select 1 from portal_private.group_members m join portal_private.groups g on g.id=m.group_id and g.active
   where m.user_id=u.id and g.id::text=body->>'group_id') then return '{"error":"not_found"}';end if;
  select coalesce(jsonb_agg(portal_private.submission_view(s)-'shared_user_ids'-'group_ids'-'management_group_id'
   order by s.created_at desc,s.id),'[]') into games
   from portal_private.game_submissions s
   join portal_private.game_group_shares sh on sh.game_id=s.id
   join portal_private.group_members author_member on author_member.user_id=s.user_id and author_member.group_id=sh.group_id
   join portal_private.users author on author.id=s.user_id
   where sh.group_id::text=body->>'group_id' and s.visibility='group' and s.status='approved'
   and s.package_storage_key is not null and (s.published_at is null or s.published_at<=now()) and portal_private.available(author);
  return jsonb_build_object('games',games);
 end if;
 return portal_private.submission_action_before_group_catalog(u,action,body);
end $$;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
commit;
