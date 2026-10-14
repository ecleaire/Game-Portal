begin;
-- Existing works keep their current publication state; only new works require a source.
alter table portal_private.game_submissions
 add column project_required boolean not null default false,
 add column project_drive_id text,
 add column project_name text,
 add column project_size bigint check(project_size between 1 and 52428800),
 add column project_revision uuid,
 add column project_updated_at timestamptz;
alter table portal_private.game_submissions alter column project_required set default true;

create function portal_private.project_info(s portal_private.game_submissions) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('project_required',s.project_required,'project_file',case when s.project_drive_id is not null then
 jsonb_build_object('name',s.project_name,'size',s.project_size,'revision',s.project_revision,'updated_at',s.project_updated_at) else null end);
$$;
create function portal_private.track_project_file() returns trigger language plpgsql set search_path='' as $$
begin
 if new.project_drive_id is not null then
 insert into portal_private.game_files(game_id,bucket,key) values(new.id,'drive',new.project_drive_id) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger track_project_file after insert or update on portal_private.game_submissions for each row execute function portal_private.track_project_file();

alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_projects;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; s portal_private.game_submissions; items jsonb;
begin
 if action in ('user.submission.prepare','user.submission.complete') then
  select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
  if s.id is not null and s.project_required and s.project_drive_id is null then return '{"error":"project_required"}';end if;
 end if;
 result:=portal_private.submission_action_before_projects(u,action,body);
 if result ? 'error' then return result;end if;
 if action='user.submissions' then
  select coalesce(jsonb_agg(v||portal_private.project_info(g) order by ord),'[]') into items
  from jsonb_array_elements(result->'submissions') with ordinality x(v,ord)
  join portal_private.game_submissions g on g.id=(v->>'id')::uuid and g.user_id=u.id;
  result:=jsonb_set(result,'{submissions}',items);
 elsif result ? 'submission' and action like 'user.submission.%' then
  select * into s from portal_private.game_submissions where id=(result->'submission'->>'id')::uuid and user_id=u.id;
  if s.id is not null then result:=jsonb_set(result,'{submission}',result->'submission'||portal_private.project_info(s));end if;
 end if;
 return result;
end $$;
alter function portal_private.admin_action(portal_private.admin_users,text,jsonb) rename to admin_action_before_projects;
create function portal_private.admin_action(a portal_private.admin_users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; items jsonb;
begin
 result:=portal_private.admin_action_before_projects(a,action,body);
 if action='admin.submissions' and not result ? 'error' then
  select coalesce(jsonb_agg(v||case when g.visibility<>'draft' then portal_private.project_info(g) else '{}'::jsonb end order by ord),'[]') into items
  from jsonb_array_elements(result->'submissions') with ordinality x(v,ord)
  join portal_private.game_submissions g on g.id=(v->>'id')::uuid;
  result:=jsonb_set(result,'{submissions}',items);
 end if;
 return result;
end $$;

-- Dedicated server-only API reuses portal_api authentication, BAN/KICK locks and terms checks.
create function public.portal_project_file(p_action text,p_body jsonb,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare checked jsonb; s portal_private.game_submissions; u portal_private.users; a portal_private.admin_users;
 revision uuid; file_id text; name_value text; size_value bigint;
begin
 if p_action not in ('prepare','complete','download') then return '{"error":"invalid_request"}';end if;
 checked:=public.portal_api('user.me','{}',p_token_hash,null);
 if checked->>'error'='forbidden' then
  checked:=public.portal_api('admin.me','{}',p_token_hash,null);
  if checked ? 'error' then return checked;end if;
  select * into a from portal_private.admin_users where id=(checked->'admin'->>'id')::uuid;
 else
  if checked ? 'error' then return checked;end if;
  select * into u from portal_private.users where id=(checked->'user'->>'id')::uuid;
 end if;
 select * into s from portal_private.game_submissions where id=(p_body->>'submission_id')::uuid for update;
 if s.id is null then return '{"error":"not_found"}';end if;
 if u.id is not null then
  if s.user_id<>u.id then return '{"error":"not_found"}';end if;
  if p_action<>'download' and (u.role not in ('uploader','trusted_uploader') or s.status not in ('uploading','draft','pending','approved','rejected')) then return '{"error":"forbidden"}';end if;
 else
  if p_action<>'download' then return '{"error":"forbidden"}';end if;
  if s.visibility='draft' or not portal_private.manages_game(a,s) then return '{"error":"not_found"}';end if;
 end if;
 if p_action='download' then
  if s.project_drive_id is null then return '{"error":"not_found"}';end if;
  return jsonb_build_object('file_id',s.project_drive_id,'name',s.project_name);
 end if;
 if p_action='prepare' then return jsonb_build_object('engine',s.engine,'previous_revision',coalesce(s.project_revision::text,''));end if;
 revision:=(p_body->>'revision')::uuid; file_id:=p_body->>'file_id';name_value:=p_body->>'name';size_value:=(p_body->>'size')::bigint;
 if revision is null or file_id is null or file_id !~ '^[A-Za-z0-9_-]{1,200}$' or name_value is null or length(name_value)>180
  or name_value !~* '\.(zip|sb3)$' or name_value ~ '[[:cntrl:]\\/]' or size_value is null or size_value not between 1 and 52428800 then return '{"error":"invalid_project"}';end if;
 if coalesce(s.project_revision::text,'') is distinct from p_body->>'previous_revision' then return '{"error":"conflict"}';end if;
 update portal_private.game_submissions set project_drive_id=file_id,project_name=name_value,project_size=size_value,
 project_revision=revision,project_updated_at=now(),updated_at=now(),
 status=case when status='approved' and visibility<>'draft' and u.role<>'trusted_uploader' then 'pending' else status end
 where id=s.id returning * into s;
 return jsonb_build_object('submission',portal_private.submission_view(s)||portal_private.project_info(s));
exception when invalid_text_representation or numeric_value_out_of_range then return '{"error":"invalid_request"}';
end $$;
revoke all on function portal_private.project_info(portal_private.game_submissions),portal_private.track_project_file(),
 portal_private.submission_action_before_projects(portal_private.users,text,jsonb),portal_private.submission_action(portal_private.users,text,jsonb),
 portal_private.admin_action_before_projects(portal_private.admin_users,text,jsonb),portal_private.admin_action(portal_private.admin_users,text,jsonb),
 public.portal_project_file(text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.portal_project_file(text,jsonb,text) to service_role;
commit;
