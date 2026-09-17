begin;

-- Keep Drive identifiers server-only. The Edge Function alone calls this action
-- while minting a short-lived, encrypted preview URL for the owning user.
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_phase3;
create function portal_private.submission_action(u portal_private.users, action text, body jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s portal_private.game_submissions;
begin
  if action='user.submission.preview' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id;
    if s.id is null or s.drive_file_id is null then return '{"error":"not_found"}'; end if;
    if s.status not in ('pending','approved','rejected') then return '{"error":"conflict"}'; end if;
    return jsonb_build_object('submission',portal_private.submission_view(s,true));
  end if;
  return portal_private.submission_action_phase3(u,action,body);
end $$;

commit;
