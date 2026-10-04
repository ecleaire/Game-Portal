begin;
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_thumbnail_edit;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare s portal_private.game_submissions; key_value text;
begin
 if action in ('user.submission.thumbnail_prepare','user.submission.thumbnail_complete') then
  select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
  if s.id is null then return '{"error":"not_found"}'; end if;
  if s.status not in ('uploading','draft','pending','approved','rejected') then return '{"error":"conflict"}'; end if;
  if action='user.submission.thumbnail_prepare' then
   return jsonb_build_object('previous_key',coalesce(s.thumbnail_key,''));
  end if;
  key_value:=body->>'thumbnail_key';
  if key_value is null or key_value !~ ('^'||s.id::text||'-[a-f0-9]{64}\.(png|jpg|webp)$') then return '{"error":"invalid_thumbnail"}'; end if;
  if coalesce(s.thumbnail_key,'') is distinct from body->>'previous_key' then return '{"error":"conflict"}'; end if;
  update portal_private.game_submissions set thumbnail_key=key_value,updated_at=now() where id=s.id returning * into s;
  return jsonb_build_object('submission',portal_private.submission_view(s));
 end if;
 return portal_private.submission_action_before_thumbnail_edit(u,action,body);
end $$;
revoke all on function portal_private.submission_action(portal_private.users,text,jsonb) from public,anon,authenticated,service_role;
commit;
