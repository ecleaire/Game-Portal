begin;
alter table portal_private.game_submissions drop constraint game_submissions_visibility_check;
alter table portal_private.game_submissions add constraint game_submissions_visibility_check check(visibility in ('draft','unlisted','public','shared'));
create table portal_private.game_shares (
 game_id uuid references portal_private.game_submissions(id) on delete cascade,
 user_id uuid references portal_private.users(id) on delete cascade,
 primary key(game_id,user_id)
);
alter table portal_private.game_shares enable row level security;
revoke all on portal_private.game_shares from public,anon,authenticated,service_role;
create index game_shares_recipient on portal_private.game_shares(user_id,game_id);

-- Track current and previous files so account/game deletion removes every revision.
create table portal_private.game_files (
 game_id uuid not null references portal_private.game_submissions(id) on delete cascade,
 bucket text not null check(bucket in ('portal-packages','portal-thumbnails','drive')),
 key text not null, primary key(game_id,bucket,key)
);
create table portal_private.deleted_game_files (
 game_id uuid references portal_private.submission_deletions(id) on delete cascade,
 bucket text not null, key text not null, primary key(game_id,bucket,key)
);
alter table portal_private.game_files enable row level security;
alter table portal_private.deleted_game_files enable row level security;
revoke all on portal_private.game_files,portal_private.deleted_game_files from public,anon,authenticated,service_role;
alter table portal_private.submission_deletions drop constraint submission_deletions_user_id_fkey;
-- Keep immutable audit UUIDs after removing an administrator; never alter audit rows.
alter table portal_private.admin_audit_log drop constraint admin_audit_log_admin_id_fkey;
create function portal_private.track_game_files() returns trigger language plpgsql set search_path='' as $$
begin
 insert into portal_private.game_files(game_id,bucket,key)
 select new.id,v.bucket,v.key from (values('portal-packages',new.package_storage_key),('portal-thumbnails',new.thumbnail_key),('drive',new.drive_file_id)) v(bucket,key)
 where v.key is not null on conflict do nothing;
 return new;
end $$;
create trigger track_game_files after insert or update on portal_private.game_submissions for each row execute function portal_private.track_game_files();
insert into portal_private.game_files select s.id,v.bucket,v.key from portal_private.game_submissions s
 cross join lateral (values('portal-packages',s.package_storage_key),('portal-thumbnails',s.thumbnail_key),('drive',s.drive_file_id)) v(bucket,key)
 where v.key is not null on conflict do nothing;
create function portal_private.delete_game(s portal_private.game_submissions) returns void language plpgsql set search_path='' as $$
begin
 insert into portal_private.submission_deletions(id,user_id,drive_file_id,package_storage_key,thumbnail_key)
 values(s.id,s.user_id,s.drive_file_id,coalesce(s.package_storage_key,s.id::text||'.zip'),s.thumbnail_key) on conflict do nothing;
 insert into portal_private.deleted_game_files select game_id,bucket,key from portal_private.game_files where game_id=s.id on conflict do nothing;
 delete from portal_private.game_submissions where id=s.id;
end $$;
create or replace function public.portal_submission_cleanup(p_id uuid,p_complete boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_complete then delete from portal_private.submission_deletions where id=p_id;return '{"ok":true}';end if;
 select jsonb_build_object('drive_file_id',drive_file_id,'package_storage_key',package_storage_key,'thumbnail_key',thumbnail_key,
 'extra_assets',coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket,'key',key)) from portal_private.deleted_game_files where game_id=p_id),'[]'))
 into result from portal_private.submission_deletions where id=p_id;return result;
end $$;

alter function portal_private.submission_view(portal_private.game_submissions,boolean) rename to submission_view_before_sharing;
create function portal_private.submission_view(s portal_private.game_submissions,include_storage boolean default false) returns jsonb language sql stable set search_path='' as $$
 select portal_private.submission_view_before_sharing(s,include_storage)||jsonb_build_object('shared_user_ids',
 coalesce((select jsonb_agg(user_id order by user_id) from portal_private.game_shares where game_id=s.id),'[]'));
$$;
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_sharing;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s portal_private.game_submissions; result jsonb; ids jsonb; audience text; g uuid;
begin
 if action in ('user.shared.games','user.shared.game') then
  if action='user.shared.game' then
   select gs.* into s from portal_private.game_submissions gs
    where (gs.user_id=u.id or exists(select 1 from portal_private.game_shares sh where sh.game_id=gs.id and sh.user_id=u.id))
    and gs.public_slug=body->>'slug' and gs.visibility='shared' and gs.status='approved'
    and gs.package_storage_key is not null and (gs.published_at is null or gs.published_at<=now());
   if s.id is null then return '{"error":"not_found"}';end if;
   return jsonb_build_object('game',(portal_private.submission_view(s,true)-'shared_user_ids')||jsonb_build_object('slug',s.public_slug));
  end if;
  select coalesce(jsonb_agg((portal_private.submission_view(gs)-'shared_user_ids') order by gs.created_at desc),'[]') into result
   from portal_private.game_submissions gs join portal_private.game_shares sh on sh.game_id=gs.id where sh.user_id=u.id and gs.visibility='shared'
   and gs.status='approved' and gs.package_storage_key is not null and (gs.published_at is null or gs.published_at<=now());
  return jsonb_build_object('games',result);
 end if;
 if action='user.submission.delete' then
  if body->>'confirmation' is distinct from 'delete' then return '{"error":"invalid_request"}';end if;
  select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
  if s.id is null then return portal_private.submission_action_before_sharing(u,action,body);end if;
  if body->>'title' is distinct from s.title then return '{"error":"conflict"}';end if;
  perform portal_private.delete_game(s);return '{"deleted":true}';
 end if;
 if action in ('user.submission.create','user.submission.visibility') then
  audience:=coalesce(body->>'visibility','public');
  if audience='shared' then
   ids:=body->'shared_user_ids';
   if ids is null or jsonb_typeof(ids)<>'array' then return '{"error":"invalid_shares"}';end if;
   if jsonb_array_length(ids) not between 1 and 50 or (select count(distinct v) from jsonb_array_elements(ids) v)<>jsonb_array_length(ids) then return '{"error":"invalid_shares"}';end if;
   if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string' or not exists(
    select 1 from portal_private.users r where r.id::text=v#>>'{}' and r.id<>u.id and portal_private.available(r))) then return '{"error":"invalid_shares"}';end if;
   body:=body||'{"visibility":"unlisted"}';
  end if;
  if action='user.submission.visibility' then
   perform 1 from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
  end if;
  result:=portal_private.submission_action_before_sharing(u,action,body);
  if result ? 'error' then return result;end if;
  g:=(result->'submission'->>'id')::uuid;
  delete from portal_private.game_shares where game_id=g;
  if audience='shared' then
   update portal_private.game_submissions set visibility='shared' where id=g;
   insert into portal_private.game_shares select g,v::uuid from jsonb_array_elements_text(ids) v;
  end if;
  select * into s from portal_private.game_submissions where id=g;
  return jsonb_build_object('submission',portal_private.submission_view(s));
 end if;
 return portal_private.submission_action_before_sharing(u,action,body);
end $$;

alter function portal_private.admin_action(portal_private.admin_users,text,jsonb) rename to admin_action_before_account_management;
create function portal_private.admin_action(a portal_private.admin_users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare u portal_private.users; t portal_private.admin_users; s portal_private.game_submissions; result jsonb; ids jsonb:='[]'; n integer; next_role text;
begin
 if action='admin.cleanup' then
  select coalesce(jsonb_agg(id),'[]') into ids from (select id from portal_private.submission_deletions order by created_at limit 10) pending;
  return jsonb_build_object('deleted',true,'cleanup_ids',ids);
 end if;
 if action='admin.users' then
  select coalesce(jsonb_agg(v order by created_at,id),'[]') into result from (
   select v,created_at,id from (
    select portal_private.user_view(r)||jsonb_build_object('kind','user','game_count',(select count(*) from portal_private.game_submissions where user_id=r.id)) v,r.created_at,r.id from portal_private.users r
    union all select jsonb_build_object('id',r.id,'username',r.username,'role',r.role,'kind','admin','status',case when r.active then 'active' else 'disabled' end,'created_at',r.created_at,'updated_at',r.updated_at),r.created_at,r.id from portal_private.admin_users r
   ) all_accounts order by created_at,id limit 100 offset greatest(0,least(coalesce((body->>'offset')::integer,0),1000000))
  ) page;
  return jsonb_build_object('users',result);
 end if;
 if action='admin.submissions' then
  select coalesce(jsonb_agg(portal_private.submission_view(gs)||jsonb_build_object('username',r.username) order by gs.created_at desc),'[]') into result
  from (select * from portal_private.game_submissions where body->>'user_id' is null or user_id=(body->>'user_id')::uuid order by created_at desc limit 100 offset greatest(0,least(coalesce((body->>'offset')::integer,0),1000000))) gs join portal_private.users r on r.id=gs.user_id;
  return jsonb_build_object('submissions',result);
 end if;
 if action in ('admin.submission.delete','admin.account.delete') then
  if body->>'confirmation' is distinct from 'delete' then return '{"error":"invalid_request"}';end if;
  if action='admin.submission.delete' then
   select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid for update;
   if s.id is null then return '{"error":"not_found"}';end if;
   if body->>'title' is distinct from s.title then return '{"error":"conflict"}';end if;
   perform portal_private.delete_game(s);ids:=jsonb_build_array(s.id);
  else
   select * into u from portal_private.users where id=(body->>'user_id')::uuid for update;
   if u.id is null then return '{"error":"not_found"}';end if;
   if body->>'username' is distinct from u.username then return '{"error":"conflict"}';end if;
   for s in select * from portal_private.game_submissions where user_id=u.id order by id for update loop
    perform portal_private.delete_game(s);ids:=ids||jsonb_build_array(s.id);
   end loop;
   -- Include older user-initiated deletions that are still queued for cleanup.
   select coalesce(jsonb_agg(id),'[]') into ids from portal_private.submission_deletions where user_id=u.id;
   delete from portal_private.sessions where user_id=u.id;
   delete from portal_private.user_passwords where user_id=u.id;
   delete from portal_private.login_limits where key in ('user.login:'||u.username,'password:'||u.id::text);
   delete from portal_private.users where id=u.id;
  end if;
  insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata) values(a.id,action,coalesce(u.id,s.id),jsonb_build_object('deleted_games',jsonb_array_length(ids)));
  return jsonb_build_object('deleted',true,'cleanup_ids',ids,'deleted_games',jsonb_array_length(ids));
 end if;
 if action in ('admin.admin.rename','admin.admin.role','admin.admin.disable','admin.admin.enable','admin.admin.kick','admin.admin.password','admin.admin.delete') then
  if a.role<>'super_admin' then return '{"error":"forbidden"}';end if;
  perform pg_advisory_xact_lock(1847373922);
  select * into t from portal_private.admin_users where id=(body->>'admin_id')::uuid for update;
  if t.id is null then return '{"error":"not_found"}';end if;
  if t.id=a.id and action in ('admin.admin.role','admin.admin.disable','admin.admin.delete') then return '{"error":"self_protected"}';end if;
  next_role:=body->>'role';
  if action='admin.admin.role' and coalesce(next_role,'') not in ('super_admin','admin') then return '{"error":"invalid_request"}';end if;
  if t.active and t.role='super_admin' and (action in ('admin.admin.disable','admin.admin.delete') or (action='admin.admin.role' and next_role<>'super_admin'))
   and (select count(*) from portal_private.admin_users where active and role='super_admin')<=1 then return '{"error":"last_super_admin"}';end if;
  if action='admin.admin.delete' and (body->>'confirmation' is distinct from 'delete' or body->>'username' is distinct from t.username) then return '{"error":"invalid_request"}';end if;
  if action='admin.admin.rename' then update portal_private.admin_users set username=portal_private.username(body->>'username'),updated_at=now() where id=t.id;
  elsif action='admin.admin.role' then update portal_private.admin_users set role=next_role,updated_at=now() where id=t.id;
  elsif action='admin.admin.disable' then update portal_private.admin_users set active=false,updated_at=now() where id=t.id;
  elsif action='admin.admin.enable' then update portal_private.admin_users set active=true,updated_at=now() where id=t.id;
  elsif action='admin.admin.password' then update portal_private.admin_users set password_hash=portal_private.password_hash(body->>'password'),updated_at=now() where id=t.id;
  end if;
  if action in ('admin.admin.role','admin.admin.disable','admin.admin.kick','admin.admin.password','admin.admin.delete') then
   delete from portal_private.sessions where admin_id=t.id;
  end if;
  if action='admin.admin.delete' then
   delete from portal_private.login_limits where key='admin.login:'||t.username;
   delete from portal_private.admin_users where id=t.id;
  end if;
  insert into portal_private.admin_audit_log(admin_id,action,target_id) values(a.id,action,t.id);
  return '{"ok":true}';
 end if;
 return portal_private.admin_action_before_account_management(a,action,body);
end $$;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
commit;
