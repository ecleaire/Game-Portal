-- Owners may edit plain-text metadata after approval. The reviewed ZIP and
-- publication status remain unchanged; table constraints still cap every field.
begin;

alter function portal_private.submission_action(portal_private.users,text,jsonb)
  rename to submission_action_phase6;

create function portal_private.submission_action(u portal_private.users, action text, body jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare s portal_private.game_submissions;
begin
  if action = 'user.submission.update' then
    select * into s from portal_private.game_submissions
      where id=(body->>'submission_id')::uuid and user_id=u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status = 'approved' then
      if nullif(btrim(body->>'title'),'') is null or char_length(body->>'title') > 120
        or body->>'engine' not in ('godot','scratch','other')
        or nullif(btrim(body->>'version'),'') is null or char_length(body->>'version') > 80
        or char_length(coalesce(body->>'description','')) > 4000
        or char_length(coalesce(body->>'controls','')) > 2000
      then return '{"error":"invalid_request"}'; end if;
      update portal_private.game_submissions set
        title=btrim(body->>'title'), engine=body->>'engine',
        description=coalesce(body->>'description',''),
        version=btrim(body->>'version'), controls=coalesce(body->>'controls',''),
        updated_at=now()
      where id=s.id returning * into s;
      return jsonb_build_object('submission',portal_private.submission_view(s));
    end if;
  end if;
  return portal_private.submission_action_phase6(u,action,body);
end;
$$;

revoke all on function portal_private.submission_action(portal_private.users,text,jsonb)
  from public,anon,authenticated,service_role;

commit;
