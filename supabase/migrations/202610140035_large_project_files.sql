begin;
alter table portal_private.game_submissions drop constraint game_submissions_project_size_check;
alter table portal_private.game_submissions add constraint game_submissions_project_size_check check(project_size between 1 and 524288000);
-- Keep all established source-file authorization and CAS logic, changing only its size bound.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.portal_project_file(text,jsonb,text)'::regprocedure);
 if strpos(definition,'size_value not between 1 and 52428800')=0 then raise exception 'Unexpected source API definition';end if;
 execute replace(definition,'size_value not between 1 and 52428800','size_value not between 1 and 524288000');
end $$;
create table portal_private.project_transfers (
 revision uuid primary key, game_id uuid not null references portal_private.game_submissions(id) on delete cascade,
 name text not null, size bigint not null check(size between 1 and 524288000), engine text not null,
 upload_url text not null, previous_revision text not null, received bigint not null default 0,
 file_id text, expires_at timestamptz not null default now()+interval '2 hours'
);
alter table portal_private.project_transfers enable row level security;
revoke all on portal_private.project_transfers from public,anon,authenticated,service_role;
create function public.portal_project_transfer(p_action text,p_body jsonb,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prepared jsonb; item portal_private.project_transfers; result jsonb; r uuid; g uuid; offset_value bigint;
begin
 if p_action not in ('prepare','create','get','advance','finish') then return '{"error":"invalid_request"}';end if;
 prepared:=public.portal_project_file('prepare',p_body,p_token_hash);
 if prepared ? 'error' then return prepared;end if;
 r:=(p_body->>'revision')::uuid;g:=(p_body->>'submission_id')::uuid;
 if r is null then return '{"error":"invalid_request"}';end if;
 if p_action='prepare' then return prepared;end if;
 if p_action='create' then
  if (p_body->>'size')::bigint not between 1 and 524288000 or p_body->>'size' is null
   or length(p_body->>'name') not between 1 and 180 or p_body->>'name' !~* '\.(zip|sb3)$' or p_body->>'name' ~ '[[:cntrl:]\\/]'
   or p_body->>'upload_url' not like 'https://www.googleapis.com/upload/drive/v3/files?%' then return '{"error":"invalid_project"}';end if;
  if not portal_private.throttle('project-transfer:'||g::text,20) then return '{"error":"rate_limited"}';end if;
  insert into portal_private.project_transfers(revision,game_id,name,size,engine,upload_url,previous_revision)
  values(r,g,p_body->>'name',(p_body->>'size')::bigint,prepared->>'engine',p_body->>'upload_url',prepared->>'previous_revision') on conflict do nothing;
 end if;
 select * into item from portal_private.project_transfers where revision=r and game_id=g and expires_at>now() for update;
 if item.revision is null then return '{"error":"not_found"}';end if;
 if p_action='advance' then
  offset_value:=(p_body->>'offset')::bigint;
  if offset_value is null or offset_value<item.received or offset_value>item.size then return '{"error":"conflict"}';end if;
  if offset_value=item.size and coalesce(p_body->>'file_id','') !~ '^[A-Za-z0-9_-]{1,200}$' then return '{"error":"invalid_project"}';end if;
  update portal_private.project_transfers set received=offset_value,file_id=nullif(p_body->>'file_id','') where revision=r returning * into item;
  if item.file_id is not null then insert into portal_private.game_files(game_id,bucket,key) values(g,'drive',item.file_id) on conflict do nothing;end if;
 end if;
 if p_action='finish' then
  if item.file_id is null or item.received<>item.size or item.engine is distinct from prepared->>'engine' then return '{"error":"conflict"}';end if;
  result:=public.portal_project_file('complete',jsonb_build_object('submission_id',g,'revision',r,'previous_revision',item.previous_revision,'file_id',item.file_id,'name',item.name,'size',item.size::text),p_token_hash);
  if not result ? 'error' then delete from portal_private.project_transfers where revision=r;end if;
  return result;
 end if;
 return jsonb_build_object('upload_url',item.upload_url,'offset',item.received,'size',item.size,'name',item.name,'engine',item.engine,'file_id',item.file_id);
exception when invalid_text_representation or numeric_value_out_of_range then return '{"error":"invalid_request"}';
end $$;
revoke all on function public.portal_project_transfer(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.portal_project_transfer(text,jsonb,text) to service_role;
commit;
