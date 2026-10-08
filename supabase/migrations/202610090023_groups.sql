begin;
create table portal_private.groups (
 id uuid primary key default extensions.gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 80),
 active boolean not null default true, restrict_sharing boolean not null default true, created_at timestamptz not null default now()
);
alter table portal_private.groups add column description text not null default '' check(length(description)<=2000);
create table portal_private.group_members (
 group_id uuid references portal_private.groups(id) on delete cascade,
 user_id uuid references portal_private.users(id) on delete cascade, primary key(group_id,user_id)
);
create index group_members_user on portal_private.group_members(user_id,group_id);
create table portal_private.group_admins (
 group_id uuid references portal_private.groups(id) on delete cascade,
 admin_id uuid references portal_private.admin_users(id) on delete cascade, primary key(group_id,admin_id)
);
create index group_admins_admin on portal_private.group_admins(admin_id,group_id);
-- Participation never confers management rights. Only group_admins grants them.
create table portal_private.group_admin_members (
 group_id uuid references portal_private.groups(id) on delete cascade,
 admin_id uuid references portal_private.admin_users(id) on delete cascade, primary key(group_id,admin_id)
);
create index group_admin_members_admin on portal_private.group_admin_members(admin_id,group_id);
alter table portal_private.group_admin_members enable row level security;
revoke all on portal_private.group_admin_members from public,anon,authenticated,service_role;
alter table portal_private.game_submissions add column management_group_id uuid references portal_private.groups(id);
alter table portal_private.game_submissions drop constraint game_submissions_visibility_check;
alter table portal_private.game_submissions add constraint game_submissions_visibility_check check(visibility in ('draft','unlisted','public','shared','group'));
create index game_management_group on portal_private.game_submissions(management_group_id);
create table portal_private.game_group_shares (
 game_id uuid references portal_private.game_submissions(id) on delete cascade,
 group_id uuid references portal_private.groups(id) on delete cascade, primary key(game_id,group_id)
);
create index game_group_shares_group on portal_private.game_group_shares(group_id,game_id);
alter table portal_private.groups enable row level security;
alter table portal_private.group_members enable row level security;
alter table portal_private.group_admins enable row level security;
alter table portal_private.game_group_shares enable row level security;
revoke all on portal_private.groups,portal_private.group_members,portal_private.group_admins,portal_private.game_group_shares from public,anon,authenticated,service_role;

create function portal_private.manages_group(a portal_private.admin_users,g uuid) returns boolean language sql stable set search_path='' as $$
 select a.active and exists(select 1 from portal_private.groups where id=g and active)
 and (a.role='super_admin' or exists(select 1 from portal_private.group_admins where group_id=g and admin_id=a.id));
$$;
create function portal_private.manages_game(a portal_private.admin_users,s portal_private.game_submissions) returns boolean language sql stable set search_path='' as $$
 select a.role='super_admin' or (s.visibility<>'draft' and portal_private.manages_group(a,s.management_group_id)
 and exists(select 1 from portal_private.group_members where group_id=s.management_group_id and user_id=s.user_id));
$$;
alter function portal_private.submission_view(portal_private.game_submissions,boolean) rename to submission_view_before_groups;
create function portal_private.submission_view(s portal_private.game_submissions,include_storage boolean default false) returns jsonb language sql stable set search_path='' as $$
 select portal_private.submission_view_before_groups(s,include_storage)||jsonb_build_object('management_group_id',s.management_group_id,
 'group_ids',coalesce((select jsonb_agg(group_id order by group_id) from portal_private.game_group_shares where game_id=s.id),'[]'));
$$;

alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_groups;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s portal_private.game_submissions; result jsonb; groups_json jsonb; audience text; gid uuid; ids jsonb; restrict_group uuid;
begin
 if action='user.groups' then
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'description',g.description,'restrict_sharing',g.restrict_sharing) order by g.name,g.id),'[]') into groups_json
   from portal_private.groups g join portal_private.group_members m on m.group_id=g.id where m.user_id=u.id and g.active;
  return jsonb_build_object('groups',groups_json);
 end if;
 if action='user.shared.game' then
  select * into s from portal_private.game_submissions where public_slug=body->>'slug' and visibility='group' and status='approved'
   and package_storage_key is not null and (published_at is null or published_at<=now());
  if s.id is not null and exists(select 1 from portal_private.users author where author.id=s.user_id and portal_private.available(author)) and (s.user_id=u.id or exists(select 1 from portal_private.game_group_shares sh
   join portal_private.groups g on g.id=sh.group_id and g.active
   join portal_private.group_members recipient on recipient.group_id=g.id and recipient.user_id=u.id
   join portal_private.group_members owner_member on owner_member.group_id=g.id and owner_member.user_id=s.user_id where sh.game_id=s.id)) then
   return jsonb_build_object('game',(portal_private.submission_view(s,true)-'shared_user_ids'-'group_ids'-'management_group_id')||jsonb_build_object('slug',s.public_slug));
  end if;
 end if;
 if action='user.shared.games' then
  result:=portal_private.submission_action_before_groups(u,action,body);
  select coalesce(jsonb_agg(portal_private.submission_view(gs)-'shared_user_ids'-'group_ids'-'management_group_id' order by gs.created_at desc),'[]') into groups_json
   from portal_private.game_submissions gs where gs.visibility='group' and gs.status='approved' and gs.package_storage_key is not null
   and (gs.published_at is null or gs.published_at<=now()) and exists(select 1 from portal_private.users author where author.id=gs.user_id and portal_private.available(author)) and exists(select 1 from portal_private.game_group_shares sh
    join portal_private.groups g on g.id=sh.group_id and g.active
    join portal_private.group_members m on m.group_id=g.id and m.user_id=u.id
    join portal_private.group_members own on own.group_id=g.id and own.user_id=gs.user_id where sh.game_id=gs.id);
  return jsonb_build_object('games',(result->'games')||groups_json);
 end if;
 if action in ('user.submission.create','user.submission.save','user.submission.visibility') then
  if action<>'user.submission.create' then
   select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
   if s.id is null then return '{"error":"not_found"}';end if;
  end if;
  gid:=coalesce(nullif(body->>'management_group_id','')::uuid,s.management_group_id);
  select g.id into restrict_group from portal_private.groups g join portal_private.group_members m on m.group_id=g.id
   where m.user_id=u.id and g.active and g.restrict_sharing order by g.id limit 1;
  if gid is null then gid:=restrict_group;end if;
  if restrict_group is not null and exists(select 1 from portal_private.groups where id=gid and active and restrict_sharing) then restrict_group:=gid;end if;
  if gid is not null and not exists(select 1 from portal_private.group_members m join portal_private.groups g on g.id=m.group_id and g.active where m.group_id=gid and m.user_id=u.id) then return '{"error":"invalid_groups"}';end if;
  if s.management_group_id is not null and gid<>s.management_group_id then return '{"error":"group_locked"}';end if;
  audience:=coalesce(body->>'visibility','public');
  if restrict_group is not null and audience not in ('draft','group') then return '{"error":"group_private_required"}';end if;
  if audience='group' then
   ids:=body->'group_ids';
   if ids is null or jsonb_typeof(ids)<>'array' then return '{"error":"invalid_groups"}';end if;
   if jsonb_array_length(ids) not between 1 and 20 or (select count(distinct v) from jsonb_array_elements(ids) v)<>jsonb_array_length(ids) then return '{"error":"invalid_groups"}';end if;
   if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string' or not exists(select 1 from portal_private.groups g join portal_private.group_members m on m.group_id=g.id where g.id::text=v#>>'{}' and g.active and m.user_id=u.id)) then return '{"error":"invalid_groups"}';end if;
   if gid is null or not ids @> jsonb_build_array(gid) then return '{"error":"invalid_groups"}';end if;
   if restrict_group is not null and (jsonb_array_length(ids)<>1 or not ids @> jsonb_build_array(restrict_group)) then return '{"error":"group_private_required"}';end if;
   body:=body||'{"visibility":"unlisted"}';
  end if;
  result:=portal_private.submission_action_before_groups(u,action,body);
  if result ? 'error' then return result;end if;
  select * into s from portal_private.game_submissions where id=(result->'submission'->>'id')::uuid;
  update portal_private.game_submissions set management_group_id=gid,visibility=audience where id=s.id returning * into s;
  delete from portal_private.game_group_shares where game_id=s.id;
  if audience='group' then insert into portal_private.game_group_shares select s.id,v::uuid from jsonb_array_elements_text(ids) v;end if;
  return jsonb_build_object('submission',portal_private.submission_view(s));
 end if;
 return portal_private.submission_action_before_groups(u,action,body);
end $$;

alter function portal_private.admin_action(portal_private.admin_users,text,jsonb) rename to admin_action_before_groups;
create function portal_private.admin_action(a portal_private.admin_users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare g portal_private.groups; s portal_private.game_submissions; u portal_private.users; target_admin portal_private.admin_users; result jsonb; gid uuid; groups_json jsonb;
begin
 if action='admin.me' then return portal_private.admin_action_before_groups(a,action,body);end if;
 if action='admin.group.directory' then
  select coalesce(jsonb_agg(jsonb_build_object('id',gr.id,'name',gr.name,'description',gr.description,
    'joined',exists(select 1 from portal_private.group_admin_members where group_id=gr.id and admin_id=a.id),
    'manages',portal_private.manages_group(a,gr.id)) order by gr.name,gr.id),'[]') into groups_json
   from portal_private.groups gr where gr.active;
  return jsonb_build_object('groups',groups_json);
 end if;
 if action='admin.group.membership' then
  select * into g from portal_private.groups where id=(body->>'group_id')::uuid and active for update;
  if g.id is null then return '{"error":"not_found"}';end if;
  if body->>'operation'='join' then insert into portal_private.group_admin_members values(g.id,a.id) on conflict do nothing;
  elsif body->>'operation'='leave' then delete from portal_private.group_admin_members where group_id=g.id and admin_id=a.id;
  else return '{"error":"invalid_request"}';end if;
  insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata) values(a.id,action,g.id,jsonb_build_object('operation',body->>'operation'));
  return '{"ok":true}';
 end if;
 if action in ('admin.shared.games','admin.shared.game') then
  select coalesce(jsonb_agg((portal_private.submission_view(gs,action='admin.shared.game')-'shared_user_ids'-'group_ids'-'management_group_id')||jsonb_build_object('slug',gs.public_slug) order by gs.created_at desc),'[]') into groups_json
   from portal_private.game_submissions gs where gs.visibility='group' and gs.status='approved' and gs.package_storage_key is not null
   and (action='admin.shared.games' or gs.public_slug=body->>'slug') and (gs.published_at is null or gs.published_at<=now())
   and exists(select 1 from portal_private.users author where author.id=gs.user_id and portal_private.available(author))
   and exists(select 1 from portal_private.game_group_shares sh join portal_private.groups gr on gr.id=sh.group_id and gr.active
    join portal_private.group_admin_members m on m.group_id=gr.id and m.admin_id=a.id
    join portal_private.group_members own on own.group_id=gr.id and own.user_id=gs.user_id where sh.game_id=gs.id);
  if action='admin.shared.game' then
   if jsonb_array_length(groups_json)=0 then return '{"error":"not_found"}';end if;
   return jsonb_build_object('game',groups_json->0);
  end if;
  return jsonb_build_object('games',groups_json);
 end if;
 if action='admin.groups' then
  select coalesce(jsonb_agg(jsonb_build_object('id',gr.id,'name',gr.name,'description',gr.description,'active',gr.active,'restrict_sharing',gr.restrict_sharing,
    'member_count',(select count(*) from portal_private.group_members where group_id=gr.id)) order by gr.name,gr.id),'[]') into groups_json
   from portal_private.groups gr where a.role='super_admin' or exists(select 1 from portal_private.group_admins where group_id=gr.id and admin_id=a.id);
  return jsonb_build_object('groups',groups_json);
 end if;
 if action in ('admin.group.create','admin.group.update','admin.group.manager') and a.role<>'super_admin' then return '{"error":"forbidden"}';end if;
 if action='admin.group.create' then
  insert into portal_private.groups(name,description) values(btrim(body->>'name'),coalesce(body->>'description','')) returning * into g;
 elsif action like 'admin.group.%' then
  gid:=(body->>'group_id')::uuid;
  select * into g from portal_private.groups where id=gid for update;
  if g.id is null or (a.role='admin' and not portal_private.manages_group(a,gid)) then return '{"error":"not_found"}';end if;
  if action='admin.group.detail' then
   return jsonb_build_object('group',to_jsonb(g),'members',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'username',r.username,'role',r.role,'status',r.status) order by r.username) from portal_private.group_members m join portal_private.users r on r.id=m.user_id where m.group_id=gid),'[]'),
    'managers',case when a.role='super_admin' then coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'username',r.username,'role',r.role)) from portal_private.group_admins m join portal_private.admin_users r on r.id=m.admin_id where m.group_id=gid),'[]') else '[]'::jsonb end);
  elsif action='admin.group.rename' then
   update portal_private.groups set name=btrim(body->>'name'),description=coalesce(body->>'description',description) where id=gid returning * into g;
  elsif action='admin.group.update' then
   if body->>'active' not in ('true','false') or body->>'restrict_sharing' not in ('true','false') then return '{"error":"invalid_request"}';end if;
   update portal_private.groups set name=btrim(body->>'name'),description=coalesce(body->>'description',description),active=(body->>'active')::boolean,restrict_sharing=(body->>'restrict_sharing')::boolean where id=gid returning * into g;
  elsif action='admin.group.manager' then
   select * into target_admin from portal_private.admin_users where id=(body->>'admin_id')::uuid for update;
   if target_admin.id is null or target_admin.role<>'admin' or not target_admin.active then return '{"error":"invalid_request"}';end if;
   if body->>'operation'='add' then insert into portal_private.group_admins values(gid,target_admin.id) on conflict do nothing;
   elsif body->>'operation'='remove' then delete from portal_private.group_admins where group_id=gid and admin_id=target_admin.id;
   else return '{"error":"invalid_request"}';end if;
  elsif action='admin.group.account.create' then
   if coalesce(body->>'role','') not in ('player','uploader') then return '{"error":"forbidden"}';end if;
   insert into portal_private.users(username,role) values(portal_private.username(body->>'username'),body->>'role') returning * into u;
   insert into portal_private.user_passwords(user_id,password_hash,type) values(u.id,portal_private.password_hash(body->>'password'),'user');
   insert into portal_private.group_members values(gid,u.id);
  elsif action='admin.group.member' then
   select * into u from portal_private.users where id=(body->>'user_id')::uuid for update;
   if u.id is null then return '{"error":"not_found"}';end if;
   if a.role='admin' and exists(select 1 from portal_private.group_members m where m.user_id=u.id and not portal_private.manages_group(a,m.group_id)) then return '{"error":"forbidden"}';end if;
   -- Scoped managers may enroll a known account ID but cannot list unrelated users or change account-wide state.
   if body->>'operation'='add' then insert into portal_private.group_members values(gid,u.id) on conflict do nothing;
   elsif body->>'operation'='remove' then
    delete from portal_private.group_members where group_id=gid and user_id=u.id;
    -- Detached works become private, retaining their files for their author.
    delete from portal_private.game_group_shares where game_id in (select id from portal_private.game_submissions where user_id=u.id and management_group_id=gid);
    update portal_private.game_submissions set visibility='draft',status=case when package_storage_key is not null then 'draft' else status end,management_group_id=null,updated_at=now() where user_id=u.id and management_group_id=gid;
   else return '{"error":"invalid_request"}';end if;
  else return '{"error":"invalid_request"}';end if;
 else
  if a.role='admin' then
   if action='admin.submissions' then
    select coalesce(jsonb_agg(portal_private.submission_view(gs)||jsonb_build_object('username',r.username) order by gs.created_at desc),'[]') into result
     from (select * from portal_private.game_submissions t where portal_private.manages_game(a,t) order by created_at desc limit 100 offset greatest(0,least(coalesce((body->>'offset')::integer,0),1000000))) gs join portal_private.users r on r.id=gs.user_id;
    return jsonb_build_object('submissions',result);
   end if;
   if action not in ('admin.submission.prepare','admin.submission.complete','admin.submission.download','admin.submission.repair','admin.submission.repair_complete','admin.submission.thumbnail','admin.submission.unpublish','admin.submission.tags','admin.submission.save') then return '{"error":"forbidden"}';end if;
   select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid for update;
   if s.id is null or not portal_private.manages_game(a,s) then return '{"error":"not_found"}';end if;
  end if;
  if action='admin.submission.save' then
   select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid for update;
   if s.id is null or not portal_private.manages_game(a,s) then return '{"error":"not_found"}';end if;
   if s.visibility='draft' then return '{"error":"forbidden"}';end if;
   if a.role='admin' and body->>'visibility' not in ('group','draft') then return '{"error":"group_private_required"}';end if;
   select * into u from portal_private.users where id=s.user_id for update;
   if not portal_private.available(u) then return '{"error":"forbidden"}';end if;
   -- Delegate validation and atomic metadata/audience changes; never forge an owner session.
   body:=body||jsonb_build_object('management_group_id',s.management_group_id);
   result:=portal_private.submission_action(u,'user.submission.save',body);
   if result ? 'error' then return result;end if;
   insert into portal_private.admin_audit_log(admin_id,action,target_id) values(a.id,action,s.id);
   return result;
  end if;
  return portal_private.admin_action_before_groups(a,action,body);
 end if;
 insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata) values(a.id,action,g.id,jsonb_strip_nulls(jsonb_build_object('user_id',u.id,'admin_id',target_admin.id,'operation',body->>'operation')));
 return jsonb_build_object('ok',true,'group',to_jsonb(g),'user_id',u.id);
end $$;

-- The reports wrapper has administrative paths before admin_action. Guard the
-- public entrypoint as well, so a scoped administrator cannot reach those paths.
alter function public.portal_api(text,jsonb,text,text) rename to portal_api_before_groups;
create function public.portal_api(p_action text,p_body jsonb default '{}',p_token_hash text default null,p_new_token_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare checked jsonb;
begin
 if p_action like 'admin.%' and p_action not in ('admin.login','admin.me') then
  checked:=public.portal_api_before_groups('admin.me','{}',p_token_hash,null);
  if checked ? 'error' then return checked;end if;
  if checked->'admin'->>'role'='admin' and p_action not in ('admin.groups','admin.group.directory','admin.group.membership','admin.shared.games','admin.shared.game','admin.group.rename','admin.group.detail','admin.group.member','admin.group.account.create','admin.submissions',
   'admin.submission.prepare','admin.submission.complete','admin.submission.download','admin.submission.repair','admin.submission.repair_complete','admin.submission.thumbnail','admin.submission.unpublish','admin.submission.tags','admin.submission.save') then return '{"error":"forbidden"}';end if;
 end if;
 return public.portal_api_before_groups(p_action,p_body,p_token_hash,p_new_token_hash);
end $$;
revoke all on function public.portal_api_before_groups(text,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.portal_api(text,jsonb,text,text) to service_role;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
-- Changing a group's privacy policy immediately also protects older public URLs.
alter function public.portal_catalog() rename to portal_catalog_before_groups;
create function public.portal_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(v order by ord),'[]') from jsonb_array_elements(public.portal_catalog_before_groups()) with ordinality x(v,ord)
 join portal_private.game_submissions s on s.public_slug=v->>'slug'
 where not exists(select 1 from portal_private.groups g where g.id=s.management_group_id and (not g.active or g.restrict_sharing));
$$;
alter function public.portal_public_game(text) rename to portal_public_game_before_groups;
create function public.portal_public_game(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select public.portal_public_game_before_groups(p_slug) from portal_private.game_submissions s where s.public_slug=p_slug
 and not exists(select 1 from portal_private.groups g where g.id=s.management_group_id and (not g.active or g.restrict_sharing));
$$;
revoke all on function public.portal_catalog_before_groups(),public.portal_public_game_before_groups(text) from public,anon,authenticated,service_role;
revoke all on function public.portal_catalog(),public.portal_public_game(text) from public,anon,authenticated;
grant execute on function public.portal_catalog(),public.portal_public_game(text) to service_role;
commit;
