begin;

-- Remove metadata immediately; persist cleanup work before touching external
-- storage so a temporary outage cannot leave an accessible game behind.
create table portal_private.submission_deletions (
  id uuid primary key,
  user_id uuid not null references portal_private.users(id),
  drive_file_id text,
  package_storage_key text,
  thumbnail_key text,
  created_at timestamptz not null default now()
);
alter table portal_private.submission_deletions enable row level security;
revoke all on portal_private.submission_deletions from public,anon,authenticated,service_role;

alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_phase7;
create function portal_private.submission_action(u portal_private.users, action text, body jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s portal_private.game_submissions;
begin
  if action='user.submission.delete' then
    if body->>'confirmation' is distinct from 'delete' then return '{"error":"invalid_request"}'; end if;
    select * into s from portal_private.game_submissions
      where id=(body->>'submission_id')::uuid and user_id=u.id for update;
    if s.id is null then
      -- The owner can retry unfinished cleanup after a lost HTTP response.
      if exists(select 1 from portal_private.submission_deletions
        where id=(body->>'submission_id')::uuid and user_id=u.id) then
        return '{"deleted":true}';
      end if;
      return '{"error":"not_found"}';
    end if;
    if body->>'title' is distinct from s.title then return '{"error":"conflict"}'; end if;
    insert into portal_private.submission_deletions(id,user_id,drive_file_id,package_storage_key,thumbnail_key)
      values(s.id,u.id,s.drive_file_id,coalesce(s.package_storage_key,s.id::text||'.zip'),s.thumbnail_key);
    delete from portal_private.game_submissions where id=s.id;
    return '{"deleted":true}';
  end if;
  return portal_private.submission_action_phase7(u,action,body);
end $$;
revoke all on function portal_private.submission_action(portal_private.users,text,jsonb) from public,anon,authenticated,service_role;

-- Only the trusted Edge Function may read storage identifiers or acknowledge
-- successful cleanup. This function is never exposed by the browser API.
create function public.portal_submission_cleanup(p_id uuid, p_complete boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_complete then
    delete from portal_private.submission_deletions where id=p_id;
    return '{"ok":true}';
  end if;
  select jsonb_build_object('drive_file_id',drive_file_id,'package_storage_key',package_storage_key,
    'thumbnail_key',thumbnail_key) into result from portal_private.submission_deletions where id=p_id;
  return result;
end $$;
revoke all on function public.portal_submission_cleanup(uuid,boolean) from public,anon,authenticated;
grant execute on function public.portal_submission_cleanup(uuid,boolean) to service_role;

commit;
