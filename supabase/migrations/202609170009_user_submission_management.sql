begin;

-- A submitter can correct metadata for an unfinished/rejected submission and
-- withdraw their own private submission. Drive files remain private; this
-- changes only the moderation state and never exposes a Drive identifier.
create or replace function portal_private.submission_action(u portal_private.users, action text, body jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s portal_private.game_submissions; result jsonb;
begin
  if action = 'user.submissions' then
    select coalesce(jsonb_agg(portal_private.submission_view(x) order by x.created_at desc),'[]') into result
      from (select * from portal_private.game_submissions where user_id = u.id order by created_at desc limit 100) x;
    return jsonb_build_object('submissions',result);
  end if;
  if action = 'user.submission.create' then
    if u.role <> 'uploader' then return '{"error":"forbidden"}'; end if;
    insert into portal_private.game_submissions(user_id,title,engine,description,version,controls)
      values(u.id,btrim(body->>'title'),body->>'engine',coalesce(body->>'description',''),btrim(body->>'version'),coalesce(body->>'controls','')) returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action = 'user.submission.update' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status not in ('uploading','pending','rejected') then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set title=btrim(body->>'title'),engine=body->>'engine',
      description=coalesce(body->>'description',''),version=btrim(body->>'version'),controls=coalesce(body->>'controls',''),
      status=case when s.status='rejected' and s.drive_file_id is not null then 'pending' else s.status end,
      review_reason=case when s.status='rejected' then null else review_reason end,updated_at=now()
      where id=s.id returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action = 'user.submission.withdraw' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status not in ('uploading','pending','rejected','approved') then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set status='unpublished',updated_at=now() where id=s.id returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action = 'user.submission.prepare' then
    select * into s from portal_private.game_submissions where id = (body->>'submission_id')::uuid and user_id = u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if u.role <> 'uploader' then return '{"error":"forbidden"}'; end if;
    if s.status <> 'uploading' then return '{"error":"conflict"}'; end if;
    return jsonb_build_object('submission_id',s.id);
  end if;
  if action = 'user.submission.complete' then
    select * into s from portal_private.game_submissions where id = (body->>'submission_id')::uuid and user_id = u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status <> 'uploading' then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set status='pending',drive_file_id=body->>'drive_file_id',
      package_name=body->>'package_name',package_size=(body->>'package_size')::bigint,updated_at=now()
      where id=s.id returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  return '{"error":"unknown_action"}';
end $$;

commit;
