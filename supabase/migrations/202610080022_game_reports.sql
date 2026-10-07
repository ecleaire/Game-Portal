begin;
create table portal_private.legacy_report_targets(game_id text primary key);
insert into portal_private.legacy_report_targets values('platformer-demo'),('scratch-demo');
create table portal_private.game_reports (
 id uuid primary key default extensions.gen_random_uuid(),
 game_id text not null, submission_id uuid references portal_private.game_submissions(id) on delete set null,
 category text not null check(category in ('rights','personal_data','inappropriate','payments','network','other')),
 detail text not null check(length(btrim(detail)) between 1 and 1000),
 created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','reviewed','resolved','dismissed'))
);
create index game_reports_pending on portal_private.game_reports(status,created_at);
alter table portal_private.game_reports enable row level security;
alter table portal_private.legacy_report_targets enable row level security;
revoke all on portal_private.game_reports,portal_private.legacy_report_targets from public,anon,authenticated,service_role;
alter function public.portal_api(text,jsonb,text,text) rename to portal_api_before_reports;
create function public.portal_api(p_action text,p_body jsonb default '{}',p_token_hash text default null,p_new_token_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; game jsonb; sid uuid; report portal_private.game_reports; aid uuid;
begin
 if p_action='report.create' then
  if jsonb_typeof(p_body->'game_id') is distinct from 'string' or length(p_body->>'game_id')>80
   or coalesce(p_body->>'category','') not in ('rights','personal_data','inappropriate','payments','network','other')
   or jsonb_typeof(p_body->'detail') is distinct from 'string' or length(btrim(p_body->>'detail')) not between 1 and 1000 then return '{"error":"invalid_request"}';end if;
  -- No IP, UA, account identity or other device identifiers are recorded for reports.
  if not portal_private.throttle('reports:global',100) then return '{"error":"rate_limited"}';end if;
  if p_body->>'game_id' ~ '^[a-f0-9]{36}$' then
   game:=public.portal_public_game(p_body->>'game_id');
   if game is null then
    result:=public.portal_api_before_reports('user.shared.game',jsonb_build_object('slug',p_body->>'game_id'),p_token_hash,null);
    if result ? 'error' then return '{"error":"not_found"}';end if;
    game:=result->'game';
   end if;
   if game is null then return '{"error":"not_found"}';end if;
   select id into sid from portal_private.game_submissions where public_slug=p_body->>'game_id';
  elsif not exists(select 1 from portal_private.legacy_report_targets where game_id=p_body->>'game_id') then return '{"error":"not_found"}';end if;
  if not portal_private.throttle('reports:'||(p_body->>'game_id'),20) then return '{"error":"rate_limited"}';end if;
  insert into portal_private.game_reports(game_id,submission_id,category,detail)
   values(p_body->>'game_id',sid,p_body->>'category',btrim(p_body->>'detail')) returning * into report;
  return jsonb_build_object('ok',true,'report_id',report.id);
 end if;
 if p_action in ('admin.reports','admin.report.update') then
  result:=public.portal_api_before_reports('admin.me','{}',p_token_hash,null);
  if result ? 'error' then return result;end if;
  aid:=(result->'admin'->>'id')::uuid;
  if coalesce(p_body->>'status','pending') not in ('all','pending','reviewed','resolved','dismissed') then return '{"error":"invalid_request"}';end if;
  if p_action='admin.reports' then
   return jsonb_build_object('reports',coalesce((select jsonb_agg(to_jsonb(r)) from
    (select * from portal_private.game_reports where coalesce(p_body->>'status','pending')='all' or status=coalesce(p_body->>'status','pending')
     order by created_at desc,id limit 100 offset greatest(0,coalesce((p_body->>'offset')::integer,0))) r),'[]'::jsonb));
  end if;
  if p_body->>'status' not in ('pending','reviewed','resolved','dismissed') then return '{"error":"invalid_request"}';end if;
  update portal_private.game_reports set status=p_body->>'status' where id=(p_body->>'report_id')::uuid returning * into report;
  if report.id is null then return '{"error":"not_found"}';end if;
  insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata) values(aid,'admin.report.update',report.id,jsonb_build_object('status',report.status));
  return jsonb_build_object('ok',true);
 end if;
 return public.portal_api_before_reports(p_action,p_body,p_token_hash,p_new_token_hash);
end $$;
revoke all on function public.portal_api_before_reports(text,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.portal_api(text,jsonb,text,text) to service_role;
commit;
