begin;
create or replace function portal_private.tag_limit() returns trigger language plpgsql set search_path='' as $$
begin
 perform 1 from portal_private.game_submissions where id=new.game_id for update;
 if (select count(*) from portal_private.game_tags where game_id=new.game_id)>=22 then raise exception 'tag_limit'; end if;
 return new;
end $$;
create or replace function portal_private.valid_tags(ids jsonb,g uuid) returns boolean language plpgsql set search_path='' as $$
begin
 if ids is null or jsonb_typeof(ids) is distinct from 'array' then return false; end if;
 if jsonb_array_length(ids)>22 then return false; end if;
 if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[a-f0-9-]{36}$') then return false; end if;
 if (select count(distinct v) from jsonb_array_elements_text(ids) v)<>jsonb_array_length(ids) then return false; end if;
 return not exists(select 1 from jsonb_array_elements_text(ids) v where not exists(
  select 1 from portal_private.tags t where t.id::text=v and (t.is_active or exists(
   select 1 from portal_private.game_tags gt where gt.game_id=g and gt.tag_id=t.id))));
end $$;

alter table portal_private.game_submissions add column package_revision uuid;
alter function portal_private.submission_view(portal_private.game_submissions,boolean) rename to submission_view_before_replacement;
create function portal_private.submission_view(s portal_private.game_submissions,include_storage boolean default false) returns jsonb language sql stable set search_path='' as $$
 select portal_private.submission_view_before_replacement(s,include_storage)||jsonb_build_object('package_revision',s.package_revision);
$$;
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_replacement;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s portal_private.game_submissions;
begin
 if action='user.submission.complete' and nullif(body->>'thumbnail_key','') is null then
  select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
  body:=body||jsonb_build_object('thumbnail_key',s.thumbnail_key);
 end if;
 if action in ('user.submission.replace_prepare','user.submission.replace_complete') then
  select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
  if s.id is null then return '{"error":"not_found"}'; end if;
  if u.role not in ('uploader','trusted_uploader') then return '{"error":"forbidden"}'; end if;
  if s.status not in ('draft','pending','approved','rejected') then return '{"error":"conflict"}'; end if;
  if action='user.submission.replace_prepare' then return jsonb_build_object('updated_at',s.updated_at,'previous_key',s.package_storage_key); end if;
  if s.updated_at is distinct from (body->>'previous_updated_at')::timestamptz then return '{"error":"conflict"}'; end if;
  if coalesce(body->>'package_storage_key','') !~ ('^'||s.id::text||'-'||(body->>'package_revision')::uuid::text||'-[a-f0-9]{64}\.zip$')
    or coalesce(body->>'drive_file_id','')='' or (body->>'package_size')::bigint not between 1 and 52428800 then return '{"error":"invalid_request"}'; end if;
  update portal_private.game_submissions set
   status=case when s.visibility='draft' then 'draft' when u.role='trusted_uploader' then 'approved' else 'pending' end,
   drive_file_id=body->>'drive_file_id',package_storage_key=body->>'package_storage_key',package_revision=(body->>'package_revision')::uuid,
   package_name=body->>'package_name',package_size=(body->>'package_size')::bigint,
   review_reason=case when s.visibility<>'draft' and u.role='trusted_uploader' then '信頼済み投稿者により審査を省略' else null end,updated_at=now()
   where id=s.id returning * into s;
  return jsonb_build_object('submission',portal_private.submission_view(s));
 end if;
 return portal_private.submission_action_before_replacement(u,action,body);
end $$;
revoke all on function portal_private.submission_view_before_replacement(portal_private.game_submissions,boolean),portal_private.submission_action(portal_private.users,text,jsonb) from public,anon,authenticated,service_role;
commit;
