begin;

-- Review state and audience are separate. A draft is never put in the review
-- queue; an approved game can be made private again without losing approval.
alter table portal_private.game_submissions drop constraint game_submissions_status_check;
alter table portal_private.game_submissions add constraint game_submissions_status_check
  check (status in ('uploading','draft','pending','approved','rejected','unpublished'));
alter table portal_private.game_submissions
  add column visibility text not null default 'public' check (visibility in ('draft','unlisted','public')),
  add column published_at timestamptz,
  add column public_slug text not null default encode(extensions.gen_random_bytes(18),'hex') unique,
  add column package_storage_key text,
  add column thumbnail_key text;
-- Existing approved packages remain private until a moderator explicitly
-- publishes their ZIP to the separate, private Supabase Storage bucket.
update portal_private.game_submissions set visibility='draft' where status not in ('pending','approved');
create index game_submissions_public_listing on portal_private.game_submissions(published_at desc)
  where status='approved' and visibility='public' and package_storage_key is not null;

create or replace function portal_private.submission_view(s portal_private.game_submissions, include_storage boolean default false) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',s.id,'user_id',s.user_id,'title',s.title,'engine',s.engine,'description',s.description,
    'version',s.version,'controls',s.controls,'status',s.status,'review_reason',s.review_reason,
    'visibility',s.visibility,'published_at',s.published_at,'public_slug',s.public_slug,
    'has_thumbnail',s.thumbnail_key is not null,
    'package_ready',s.package_storage_key is not null,
    'is_published',s.status='approved' and s.visibility in ('public','unlisted')
      and s.package_storage_key is not null and (s.published_at is null or s.published_at<=now()),
    'package_name',s.package_name,'package_size',s.package_size,'created_at',s.created_at,'updated_at',s.updated_at,
    'drive_file_id',case when include_storage then s.drive_file_id end,
    'package_storage_key',case when include_storage then s.package_storage_key end,
    'thumbnail_key',case when include_storage then s.thumbnail_key end));
$$;

alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_phase5;
create function portal_private.submission_action(u portal_private.users, action text, body jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s portal_private.game_submissions; audience text; date_value timestamptz;
begin
  if action in ('user.submission.create','user.submission.visibility') then
    audience:=coalesce(body->>'visibility','public');
    if audience not in ('draft','unlisted','public') then return '{"error":"invalid_request"}'; end if;
    date_value:=nullif(body->>'published_at','')::timestamptz;
    if date_value > now()+interval '2 years' then return '{"error":"invalid_request"}'; end if;
  end if;
  if action='user.submission.create' then
    if u.role not in ('uploader','trusted_uploader') then return '{"error":"forbidden"}'; end if;
    insert into portal_private.game_submissions(user_id,title,engine,description,version,controls,visibility,published_at)
      values(u.id,btrim(body->>'title'),body->>'engine',coalesce(body->>'description',''),
        btrim(body->>'version'),coalesce(body->>'controls',''),audience,date_value) returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action='user.submission.complete' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status <> 'uploading' then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set
      status=case when s.visibility='draft' then 'draft' when u.role='trusted_uploader' then 'approved' else 'pending' end,
      drive_file_id=body->>'drive_file_id',package_name=body->>'package_name',
      package_size=(body->>'package_size')::bigint,
      package_storage_key=nullif(body->>'package_storage_key',''),thumbnail_key=nullif(body->>'thumbnail_key',''),
      review_reason=case when s.visibility<>'draft' and u.role='trusted_uploader' then '信頼済み投稿者により審査を省略' else null end,
      updated_at=now() where id=s.id returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action='user.submission.visibility' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status='unpublished' then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set visibility=audience,published_at=date_value,
      status=case when s.status='approved' then 'approved'
        when s.status='uploading' then 'uploading'
        when audience='draft' then 'draft'
        when u.role='trusted_uploader' then 'approved'
        else 'pending' end,
      review_reason=case when s.status='rejected' and audience<>'draft' then null else s.review_reason end,
      updated_at=now() where id=s.id returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action='user.submission.update' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status not in ('uploading','draft','pending','rejected') then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set title=btrim(body->>'title'),engine=body->>'engine',
      description=coalesce(body->>'description',''),version=btrim(body->>'version'),controls=coalesce(body->>'controls',''),
      status=case when s.status='rejected' and s.visibility<>'draft' then 'pending' else s.status end,
      review_reason=case when s.status='rejected' and s.visibility<>'draft' then null else s.review_reason end,
      updated_at=now() where id=s.id returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action='user.submission.preview' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id;
    if s.id is null or s.drive_file_id is null then return '{"error":"not_found"}'; end if;
    if s.status not in ('draft','pending','approved','rejected') then return '{"error":"conflict"}'; end if;
    return jsonb_build_object('submission',portal_private.submission_view(s,true));
  end if;
  if action='user.submission.thumbnail' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id;
    if s.id is null or s.thumbnail_key is null then return '{"error":"not_found"}'; end if;
    return jsonb_build_object('thumbnail_key',s.thumbnail_key);
  end if;
  return portal_private.submission_action_phase5(u,action,body);
end $$;
revoke all on function portal_private.submission_action(portal_private.users,text,jsonb) from public,anon,authenticated,service_role;

alter function portal_private.admin_action(portal_private.admin_users,text,jsonb) rename to admin_action_phase5;
create function portal_private.admin_action(a portal_private.admin_users, action text, body jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s portal_private.game_submissions; result jsonb; target_status text; reason text;
begin
  if action='admin.submissions' then
    select coalesce(jsonb_agg(portal_private.submission_view(game) || jsonb_build_object('username',u.username)
      order by game.created_at desc),'[]') into result
      from (select id from portal_private.game_submissions where visibility<>'draft'
        order by created_at desc limit 100 offset greatest(0,least(coalesce((body->>'offset')::integer,0),1000000))) page
      join portal_private.game_submissions game using(id) join portal_private.users u on u.id=game.user_id;
    return jsonb_build_object('submissions',result);
  end if;
  if action='admin.submission.complete' then
    target_status:=body->>'status'; reason:=nullif(body->>'reason','');
    if target_status not in ('approved','rejected') or char_length(coalesce(reason,''))>500 then return '{"error":"invalid_request"}'; end if;
    if target_status='approved' and nullif(body->>'package_storage_key','') is null then return '{"error":"invalid_request"}'; end if;
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status<>'pending' or s.visibility='draft' then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set status=target_status,review_reason=reason,
      package_storage_key=case when target_status='approved' then body->>'package_storage_key' else null end,
      updated_at=now() where id=s.id returning * into s;
    insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata)
      values(a.id,'admin.submission.' || target_status,s.id,jsonb_strip_nulls(jsonb_build_object('reason',reason)));
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action='admin.submission.unpublish' then
    reason:=nullif(body->>'reason','');
    if char_length(coalesce(reason,''))>500 then return '{"error":"invalid_request"}'; end if;
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status<>'approved' then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set status='unpublished',review_reason=reason,updated_at=now()
      where id=s.id returning * into s;
    insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata)
      values(a.id,'admin.submission.unpublish',s.id,jsonb_strip_nulls(jsonb_build_object('reason',reason)));
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action='admin.submission.download' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid;
    if s.id is null or s.visibility='draft' or s.drive_file_id is null then return '{"error":"not_found"}'; end if;
    return jsonb_build_object('submission',portal_private.submission_view(s,true));
  end if;
  if action='admin.submission.thumbnail' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid;
    if s.id is null or s.visibility='draft' or s.thumbnail_key is null then return '{"error":"not_found"}'; end if;
    return jsonb_build_object('thumbnail_key',s.thumbnail_key);
  end if;
  if action='admin.submission.repair' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid for update;
    if s.id is null or s.status<>'approved' or s.visibility='draft' or s.drive_file_id is null then return '{"error":"not_found"}'; end if;
    if s.package_storage_key is not null then return '{"error":"conflict"}'; end if;
    return jsonb_build_object('submission',portal_private.submission_view(s,true));
  end if;
  if action='admin.submission.repair_complete' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid for update;
    if s.id is null or s.status<>'approved' or s.package_storage_key is not null then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions set package_storage_key=body->>'package_storage_key',updated_at=now()
      where id=s.id returning * into s;
    insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata)
      values(a.id,'admin.submission.publish_package',s.id,'{}');
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  return portal_private.admin_action_phase5(a,action,body);
end $$;
revoke all on function portal_private.admin_action(portal_private.admin_users,text,jsonb) from public,anon,authenticated,service_role;

-- These functions are server-only. Anonymous clients cannot bypass publication
-- time or visibility by querying PostgREST directly.
create function public.portal_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug',s.public_slug,'title',s.title,'engine',s.engine,'description',s.description,
    'version',s.version,'controls',s.controls,'username',u.username,'has_thumbnail',s.thumbnail_key is not null)
    order by coalesce(s.published_at,s.created_at) desc),'[]'::jsonb)
  from portal_private.game_submissions s join portal_private.users u on u.id=s.user_id
  where s.status='approved' and s.visibility='public' and s.package_storage_key is not null
    and (s.published_at is null or s.published_at<=now());
$$;
revoke all on function public.portal_catalog() from public,anon,authenticated;
grant execute on function public.portal_catalog() to service_role;

create function public.portal_public_game(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slug',s.public_slug,'title',s.title,'engine',s.engine,
    'description',s.description,'version',s.version,'controls',s.controls,'username',u.username,
    'package_storage_key',s.package_storage_key,'thumbnail_key',s.thumbnail_key)
  from portal_private.game_submissions s join portal_private.users u on u.id=s.user_id
  where s.public_slug=p_slug and s.status='approved' and s.visibility in ('public','unlisted')
    and s.package_storage_key is not null and (s.published_at is null or s.published_at<=now());
$$;
revoke all on function public.portal_public_game(text) from public,anon,authenticated;
grant execute on function public.portal_public_game(text) to service_role;

commit;
