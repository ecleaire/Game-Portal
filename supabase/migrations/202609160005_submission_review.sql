begin;

-- Keep the Phase 2 implementation intact and add narrowly scoped review actions.
alter function portal_private.admin_action(portal_private.admin_users,text,jsonb) rename to admin_action_phase2;

create function portal_private.admin_action(a portal_private.admin_users, action text, body jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s portal_private.game_submissions; result jsonb; target_status text; reason text;
begin
  if action = 'admin.submissions' then
    select coalesce(jsonb_agg(portal_private.submission_view(game) || jsonb_build_object('username',u.username) order by game.created_at desc),'[]') into result
      from (select id from portal_private.game_submissions order by created_at desc limit 100
            offset greatest(0,least(coalesce((body->>'offset')::integer,0),1000000))) page
      join portal_private.game_submissions game using(id) join portal_private.users u on u.id=game.user_id;
    return jsonb_build_object('submissions',result);
  end if;
  -- These two actions are callable only by the Edge Function. The browser action
  -- allowlist deliberately omits them, so Drive IDs never leave the server path.
  if action = 'admin.submission.prepare' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status <> 'pending' or s.drive_file_id is null then return '{"error":"conflict"}'; end if;
    return jsonb_build_object('submission',portal_private.submission_view(s,true));
  end if;
  if action = 'admin.submission.complete' then
    target_status:=body->>'status'; reason:=nullif(body->>'reason','');
    if target_status not in ('approved','rejected') or char_length(coalesce(reason,'')) > 500 then return '{"error":"invalid_request"}'; end if;
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status <> 'pending' then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set status=target_status,review_reason=reason,updated_at=now() where id=s.id returning * into s;
    insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata)
      values(a.id,'admin.submission.' || target_status,s.id,jsonb_strip_nulls(jsonb_build_object('reason',reason)));
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action = 'admin.submission.download' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid;
    if s.id is null or s.drive_file_id is null then return '{"error":"not_found"}'; end if;
    return jsonb_build_object('submission',portal_private.submission_view(s,true));
  end if;
  return portal_private.admin_action_phase2(a,action,body);
end $$;
revoke all on function portal_private.admin_action(portal_private.admin_users,text,jsonb) from public,anon,authenticated,service_role;

commit;
