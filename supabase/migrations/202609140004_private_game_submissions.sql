begin;

-- ZIP packages are never exposed through PostgREST.  Drive IDs are identifiers
-- for the server only; the browser receives only the submission state.
create table portal_private.game_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references portal_private.users(id),
  title text not null check (char_length(title) between 1 and 120),
  engine text not null check (engine in ('godot','scratch','other')),
  description text not null check (char_length(description) <= 4000),
  version text not null check (char_length(version) between 1 and 80),
  controls text not null check (char_length(controls) <= 2000),
  status text not null default 'uploading' check (status in ('uploading','pending','approved','rejected','unpublished')),
  drive_file_id text unique,
  package_name text,
  package_size bigint check (package_size is null or package_size between 1 and 52428800),
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table portal_private.game_submissions enable row level security;
revoke all on portal_private.game_submissions from public, anon, authenticated, service_role;
create index game_submissions_user_created on portal_private.game_submissions(user_id, created_at desc);
create index game_submissions_status_created on portal_private.game_submissions(status, created_at desc);

create function portal_private.submission_view(s portal_private.game_submissions, include_storage boolean default false) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',s.id,'user_id',s.user_id,'title',s.title,'engine',s.engine,'description',s.description,
    'version',s.version,'controls',s.controls,'status',s.status,'review_reason',s.review_reason,
    'package_name',s.package_name,'package_size',s.package_size,'created_at',s.created_at,'updated_at',s.updated_at,
    'drive_file_id',case when include_storage then s.drive_file_id end));
$$;

create function portal_private.submission_action(u portal_private.users, action text, body jsonb) returns jsonb
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
  if action = 'user.submission.prepare' then
    select * into s from portal_private.game_submissions where id = (body->>'submission_id')::uuid and user_id = u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if u.role <> 'uploader' then return '{"error":"forbidden"}'; end if;
    if s.status <> 'uploading' then return '{"error":"conflict"}'; end if;
    return jsonb_build_object('submission_id',s.id);
  end if;
  -- This action is invoked only by the Edge Function after it has uploaded the
  -- ZIP to Drive.  It is deliberately omitted from the browser action allowlist.
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

-- Only the server-side Edge Function has service_role and can call these paths.
create or replace function public.portal_api(p_action text, p_body jsonb default '{}', p_token_hash text default null,
  p_new_token_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u portal_private.users; a portal_private.admin_users; s portal_private.sessions; pw portal_private.user_passwords;
  n text; found_password uuid; valid boolean := false; exp timestamptz;
begin
  if p_action in ('user.login','admin.login') then
    if not portal_private.throttle(p_action || ':global',100) then return '{"error":"rate_limited"}'; end if;
    n := lower(btrim(coalesce(p_body->>'username','')));
    if n !~ '^[a-z0-9_]{3,32}$' or p_body->>'password' is null or octet_length(p_body->>'password') > 72 then return '{"error":"invalid_credentials"}'; end if;
    if not portal_private.throttle(p_action || ':' || n,10) then return '{"error":"rate_limited"}'; end if;
    if p_new_token_hash is null or p_new_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'missing token digest' using errcode = '22023'; end if;
    if p_action = 'admin.login' then
      select * into a from portal_private.admin_users where username=n for update;
      if a.id is not null then valid := extensions.crypt(p_body->>'password',a.password_hash)=a.password_hash and a.active;
      else perform extensions.crypt(p_body->>'password','$2a$12$000000000000000000000.'); end if;
      if not valid then return '{"error":"invalid_credentials"}'; end if;
      exp:=now()+interval '1 hour'; insert into portal_private.sessions(token_hash,admin_id,expires_at) values(p_new_token_hash,a.id,exp);
      return jsonb_build_object('expires_at',exp,'admin',jsonb_build_object('id',a.id,'username',a.username,'role',a.role));
    end if;
    select * into u from portal_private.users where username=n for update;
    if u.id is not null then for pw in select * from portal_private.user_passwords where user_id=u.id and revoked_at is null order by created_at,id loop
      if extensions.crypt(p_body->>'password',pw.password_hash)=pw.password_hash then found_password:=pw.id; end if; end loop;
    else perform extensions.crypt(p_body->>'password','$2a$12$000000000000000000000.'); end if;
    if found_password is null or not portal_private.available(u) then return '{"error":"invalid_credentials"}'; end if;
    exp:=now()+interval '8 hours'; insert into portal_private.sessions(token_hash,user_id,password_id,expires_at) values(p_new_token_hash,u.id,found_password,exp);
    return jsonb_build_object('expires_at',exp,'user',portal_private.user_view(u));
  end if;
  select * into s from portal_private.sessions where token_hash=p_token_hash;
  if s.user_id is not null then select * into u from portal_private.users where id=s.user_id for update;
  elsif s.admin_id is not null then select * into a from portal_private.admin_users where id=s.admin_id for update;
  else return '{"error":"unauthorized"}'; end if;
  select * into s from portal_private.sessions where token_hash=p_token_hash and revoked_at is null and expires_at>now();
  if s.id is null or (u.id is not null and not portal_private.available(u)) or (a.id is not null and not a.active) then return '{"error":"unauthorized"}'; end if;
  if p_action='logout' then update portal_private.sessions set revoked_at=now() where id=s.id; return '{"ok":true}'; end if;
  if p_action like 'user.%' then
    if u.id is null then return '{"error":"forbidden"}'; end if;
    if p_action='user.me' then return jsonb_build_object('user',portal_private.user_view(u)); end if;
    if p_action='user.rename' then update portal_private.users set username=portal_private.username(p_body->>'username'),updated_at=now() where id=u.id returning * into u; return jsonb_build_object('user',portal_private.user_view(u)); end if;
    if p_action='user.password' then
      select * into pw from portal_private.user_passwords where user_id=u.id and type='user' and revoked_at is null;
      if not portal_private.throttle('password:' || u.id,10) then return '{"error":"rate_limited"}'; end if;
      if p_body->>'current_password' is null or octet_length(p_body->>'current_password')>72 or extensions.crypt(p_body->>'current_password',pw.password_hash)<>pw.password_hash then return '{"error":"invalid_credentials"}'; end if;
      n:=portal_private.password_hash(p_body->>'password'); update portal_private.user_passwords set revoked_at=now() where id=pw.id;
      insert into portal_private.user_passwords(user_id,password_hash,type) values(u.id,n,'user'); update portal_private.sessions set revoked_at=now() where user_id=u.id and revoked_at is null;
      update portal_private.users set updated_at=now() where id=u.id; return '{"ok":true,"reauthenticate":true}';
    end if;
    if p_action like 'user.submission.%' or p_action='user.submissions' then return portal_private.submission_action(u,p_action,p_body); end if;
    return '{"error":"unknown_action"}';
  end if;
  if a.id is null then return '{"error":"forbidden"}'; end if;
  return portal_private.admin_action(a,p_action,p_body);
end $$;

commit;
