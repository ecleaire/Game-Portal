begin;
create table portal_private.policy_versions (
 policy_key text not null check(policy_key='terms'), version text primary key check(length(version) between 1 and 80),
 effective_at date not null, is_current boolean not null default false
);
create unique index one_current_policy on portal_private.policy_versions(policy_key) where is_current;
insert into portal_private.policy_versions values('terms','2026-10-08','2026-10-08',true);
create table portal_private.terms_acceptances (
 user_id uuid not null references portal_private.users(id) on delete cascade,
 terms_version text not null references portal_private.policy_versions(version),
 accepted_at timestamptz not null default now(), primary key(user_id,terms_version)
);
create table portal_private.submission_confirmations (
 submission_id uuid primary key references portal_private.game_submissions(id) on delete cascade,
 terms_version text not null references portal_private.policy_versions(version), confirmed_at timestamptz not null default now()
);
alter table portal_private.policy_versions enable row level security;
alter table portal_private.terms_acceptances enable row level security;
alter table portal_private.submission_confirmations enable row level security;
revoke all on portal_private.policy_versions,portal_private.terms_acceptances,portal_private.submission_confirmations from public,anon,authenticated,service_role;

alter function public.portal_api(text,jsonb,text,text) rename to portal_api_before_terms;
create function public.portal_api(p_action text,p_body jsonb default '{}',p_token_hash text default null,p_new_token_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; policy portal_private.policy_versions; u portal_private.users; pw portal_private.user_passwords;
 n text; found_password uuid; exp timestamptz; accepted timestamptz;
begin
 if p_action='policy.current' then
  select * into policy from portal_private.policy_versions where policy_key='terms' and is_current;
  if policy.version is null then return '{"error":"unavailable"}';end if;
  return jsonb_build_object('terms',jsonb_build_object('version',policy.version,'effective_at',policy.effective_at,'url','/Game-Portal/terms/'));
 end if;
 if p_action='user.login' or (p_action='portal.login' and not exists(select 1 from portal_private.admin_users where username=lower(btrim(p_body->>'username')))) then
  -- Preserve the original budgets, password verification, user lock and BAN rules.
  if not portal_private.throttle('user.login:global',100) then return '{"error":"rate_limited"}';end if;
  n:=lower(btrim(coalesce(p_body->>'username','')));
  if n !~ '^[a-z0-9_]{3,32}$' or p_body->>'password' is null or octet_length(p_body->>'password')>72 then return '{"error":"invalid_credentials"}';end if;
  if not portal_private.throttle('user.login:'||n,10) then return '{"error":"rate_limited"}';end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'missing token digest' using errcode='22023';end if;
  select * into u from portal_private.users where username=n for update;
  if u.id is not null then
   for pw in select * from portal_private.user_passwords where user_id=u.id and revoked_at is null order by created_at,id loop
    if extensions.crypt(p_body->>'password',pw.password_hash)=pw.password_hash then found_password:=pw.id;end if;
   end loop;
  else perform extensions.crypt(p_body->>'password','$2a$12$000000000000000000000.');end if;
  if found_password is null or not portal_private.available(u) then return '{"error":"invalid_credentials"}';end if;
  select * into policy from portal_private.policy_versions where policy_key='terms' and is_current for share;
  if policy.version is null then return '{"error":"unavailable"}';end if;
  if p_body->'terms_accepted' is distinct from 'true'::jsonb then return '{"error":"terms_required"}';end if;
  if p_body->>'terms_version' is distinct from policy.version then return '{"error":"terms_outdated"}';end if;
  insert into portal_private.terms_acceptances(user_id,terms_version) values(u.id,policy.version) on conflict do nothing;
  select accepted_at into accepted from portal_private.terms_acceptances where user_id=u.id and terms_version=policy.version;
  exp:=now()+interval '8 hours';
  insert into portal_private.sessions(token_hash,user_id,password_id,expires_at) values(p_new_token_hash,u.id,found_password,exp);
  return jsonb_build_object('expires_at',exp,'user',portal_private.user_view(u),'terms',jsonb_build_object('version',policy.version,'accepted_at',accepted));
 end if;
 if p_action='user.submission.create' then
  result:=public.portal_api_before_terms('user.me','{}',p_token_hash,null);
  if result ? 'error' then return result;end if;
  select * into u from portal_private.users where id=(result->'user'->>'id')::uuid for update;
  select * into policy from portal_private.policy_versions where policy_key='terms' and is_current for share;
  if policy.version is null then return '{"error":"unavailable"}';end if;
  if not exists(select 1 from portal_private.terms_acceptances where user_id=u.id and terms_version=policy.version) then return '{"error":"terms_required"}';end if;
  if p_body->>'terms_version' is distinct from policy.version then return '{"error":"terms_outdated"}';end if;
  if p_body->>'rights_confirmed' is distinct from 'yes' then return '{"error":"terms_required"}';end if;
  result:=public.portal_api_before_terms(p_action,p_body,p_token_hash,p_new_token_hash);
  if not result ? 'error' then insert into portal_private.submission_confirmations(submission_id,terms_version) values((result->'submission'->>'id')::uuid,policy.version);end if;
  return result;
 end if;
 return public.portal_api_before_terms(p_action,p_body,p_token_hash,p_new_token_hash);
end $$;
revoke all on function public.portal_api_before_terms(text,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.portal_api(text,jsonb,text,text) to service_role;
commit;
