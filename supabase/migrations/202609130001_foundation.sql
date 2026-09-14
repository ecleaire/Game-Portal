begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema portal_private;
revoke all on schema portal_private from public, anon, authenticated, service_role;
alter default privileges in schema portal_private revoke execute on functions from public;

create table portal_private.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
  role text not null default 'player' check (role in ('player', 'uploader')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  is_banned boolean not null default false,
  banned_until timestamptz,
  ban_reason text check (length(ban_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table portal_private.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
  password_hash text not null,
  role text not null check (role in ('super_admin', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table portal_private.user_passwords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references portal_private.users(id),
  password_hash text not null,
  type text not null check (type in ('user', 'admin_added')),
  label text check (length(label) <= 80),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index one_user_password on portal_private.user_passwords(user_id)
  where type = 'user' and revoked_at is null;
create index active_passwords on portal_private.user_passwords(user_id) where revoked_at is null;
create table portal_private.sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid references portal_private.users(id),
  admin_id uuid references portal_private.admin_users(id),
  password_id uuid references portal_private.user_passwords(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check ((user_id is not null and admin_id is null and password_id is not null)
      or (user_id is null and admin_id is not null and password_id is null))
);
create index sessions_user on portal_private.sessions(user_id);
create table portal_private.login_limits (
  key text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
create table portal_private.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references portal_private.admin_users(id),
  action text not null,
  target_id uuid,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
create function portal_private.immutable_audit() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'audit log is append-only'; end $$;
create trigger immutable_audit before update or delete or truncate
  on portal_private.admin_audit_log for each statement execute function portal_private.immutable_audit();

-- No browser/PostgREST access to private data, even if a schema is accidentally exposed.
alter table portal_private.users enable row level security;
alter table portal_private.admin_users enable row level security;
alter table portal_private.user_passwords enable row level security;
alter table portal_private.sessions enable row level security;
alter table portal_private.login_limits enable row level security;
alter table portal_private.admin_audit_log enable row level security;
revoke all on all tables in schema portal_private from public, anon, authenticated, service_role;

create function portal_private.password_hash(p text) returns text
language plpgsql set search_path = '' as $$
begin
  -- bcrypt's byte limit must be enforced before hashing; never silently truncate.
  if p is null or length(p) < 12 or octet_length(p) > 72 then
    raise exception 'password must be at least 12 characters and at most 72 UTF-8 bytes' using errcode = '22023';
  end if;
  return extensions.crypt(p, extensions.gen_salt('bf', 12));
end $$;
create function portal_private.username(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare n text := lower(btrim(p));
begin
  if n is null or n !~ '^[a-z0-9_]{3,32}$' then
    raise exception 'username must contain 3-32 ASCII letters, numbers or underscores' using errcode = '22023';
  end if;
  return n;
end $$;
create function portal_private.available(u portal_private.users) returns boolean
language sql stable set search_path = '' as $$
  select u.status = 'active' and not (u.is_banned and (u.banned_until is null or u.banned_until > now()));
$$;
create function portal_private.user_view(u portal_private.users) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',u.id,'username',u.username,'role',u.role,'status',u.status,
    'banned',u.is_banned and (u.banned_until is null or u.banned_until > now()),
    'banned_until',u.banned_until,'ban_reason',u.ban_reason,'created_at',u.created_at,'updated_at',u.updated_at);
$$;
-- Atomic counters persist on failed logins because those paths RETURN, never RAISE.
create function portal_private.throttle(k text, maximum integer) returns boolean
language plpgsql set search_path = '' as $$
declare n integer;
begin
  insert into portal_private.login_limits as l values (k, now(), 1)
  on conflict (key) do update set
    attempts = case when l.window_start <= now() - interval '15 minutes' then 1 else l.attempts + 1 end,
    window_start = case when l.window_start <= now() - interval '15 minutes' then now() else l.window_start end
  returning attempts into n;
  return n <= maximum;
end $$;

-- Privileged CLI-only bootstrap. No HTTP bootstrap route or reusable bootstrap secret.
create function public.portal_bootstrap(p_username text, p_password text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare aid uuid;
begin
  perform pg_advisory_xact_lock(1847373921);
  if exists(select 1 from portal_private.admin_users) then
    raise exception 'initial administrator already exists' using errcode = '22023';
  end if;
  insert into portal_private.admin_users(username,password_hash,role)
    values (portal_private.username(p_username),portal_private.password_hash(p_password),'super_admin') returning id into aid;
  insert into portal_private.admin_audit_log(admin_id,action,target_id) values(aid,'admin.bootstrap',aid);
  return aid;
end $$;

create function public.portal_api(p_action text, p_body jsonb default '{}', p_token_hash text default null,
  p_new_token_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u portal_private.users;
  a portal_private.admin_users;
  s portal_private.sessions;
  pw portal_private.user_passwords;
  n text;
  found_password uuid;
  valid boolean := false;
  exp timestamptz;
begin
  if p_action in ('user.login','admin.login') then
    -- Separate global budgets protect bcrypt work and bound attacker-created limiter rows.
    if not portal_private.throttle(p_action || ':global',100) then
      return jsonb_build_object('error','rate_limited');
    end if;
    n := lower(btrim(coalesce(p_body->>'username','')));
    if n !~ '^[a-z0-9_]{3,32}$' or p_body->>'password' is null
       or octet_length(p_body->>'password') > 72 then return '{"error":"invalid_credentials"}'; end if;
    if not portal_private.throttle(p_action || ':' || n,10) then return '{"error":"rate_limited"}'; end if;
    if p_new_token_hash is null or p_new_token_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'missing token digest' using errcode = '22023';
    end if;
    if p_action = 'admin.login' then
      select * into a from portal_private.admin_users where username = n for update;
      if a.id is not null then
        valid := extensions.crypt(p_body->>'password',a.password_hash) = a.password_hash and a.active;
      else
        perform extensions.crypt(p_body->>'password', '$2a$12$000000000000000000000.');
      end if;
      if not valid then return '{"error":"invalid_credentials"}'; end if;
      exp := now() + interval '1 hour';
      insert into portal_private.sessions(token_hash,admin_id,expires_at) values(p_new_token_hash,a.id,exp);
      return jsonb_build_object('expires_at',exp,'admin',jsonb_build_object('id',a.id,'username',a.username,'role',a.role));
    end if;
    -- Lock user BEFORE password checks/session creation to serialize with BAN/KICK/revocation.
    select * into u from portal_private.users where username = n for update;
    if u.id is not null then
      for pw in select * from portal_private.user_passwords where user_id = u.id and revoked_at is null order by created_at,id loop
        if extensions.crypt(p_body->>'password',pw.password_hash) = pw.password_hash then found_password := pw.id; end if;
      end loop;
    else
      perform extensions.crypt(p_body->>'password', '$2a$12$000000000000000000000.');
    end if;
    if found_password is null or not portal_private.available(u) then return '{"error":"invalid_credentials"}'; end if;
    exp := now() + interval '8 hours';
    insert into portal_private.sessions(token_hash,user_id,password_id,expires_at)
      values(p_new_token_hash,u.id,found_password,exp);
    return jsonb_build_object('expires_at',exp,'user',portal_private.user_view(u));
  end if;

  -- Initial lookup only identifies which principal to lock. Re-read session AFTER locking.
  select * into s from portal_private.sessions where token_hash = p_token_hash;
  if s.user_id is not null then
    select * into u from portal_private.users where id = s.user_id for update;
  elsif s.admin_id is not null then
    select * into a from portal_private.admin_users where id = s.admin_id for update;
  else return '{"error":"unauthorized"}'; end if;
  select * into s from portal_private.sessions where token_hash = p_token_hash and revoked_at is null and expires_at > now();
  if s.id is null then return '{"error":"unauthorized"}'; end if;
  if (u.id is not null and not portal_private.available(u)) or (a.id is not null and not a.active) then
    return '{"error":"unauthorized"}';
  end if;
  if p_action = 'logout' then
    update portal_private.sessions set revoked_at = now() where id = s.id;
    return '{"ok":true}';
  end if;
  if p_action like 'user.%' then
    if u.id is null then return '{"error":"forbidden"}'; end if;
    if p_action = 'user.me' then return jsonb_build_object('user',portal_private.user_view(u)); end if;
    if p_action = 'user.rename' then
      update portal_private.users set username = portal_private.username(p_body->>'username'),updated_at = now() where id = u.id returning * into u;
      return jsonb_build_object('user',portal_private.user_view(u));
    end if;
    if p_action = 'user.password' then
      -- Require the actual user-managed password, not an alternate, to replace it.
      select * into pw from portal_private.user_passwords where user_id = u.id and type = 'user' and revoked_at is null;
      if not portal_private.throttle('password:' || u.id,10) then return '{"error":"rate_limited"}'; end if;
      if p_body->>'current_password' is null or octet_length(p_body->>'current_password') > 72 then return '{"error":"invalid_credentials"}'; end if;
      if extensions.crypt(p_body->>'current_password',pw.password_hash) <> pw.password_hash then return '{"error":"invalid_credentials"}'; end if;
      n := portal_private.password_hash(p_body->>'password');
      update portal_private.user_passwords set revoked_at = now() where id = pw.id;
      insert into portal_private.user_passwords(user_id,password_hash,type) values(u.id,n,'user');
      update portal_private.sessions set revoked_at = now() where user_id = u.id and revoked_at is null;
      update portal_private.users set updated_at = now() where id = u.id;
      return '{"ok":true,"reauthenticate":true}';
    end if;
    return '{"error":"unknown_action"}';
  end if;
  -- Phase 2 handler is separately replaceable, but never callable by browser roles.
  if a.id is null then return '{"error":"forbidden"}'; end if;
  return portal_private.admin_action(a, p_action, p_body);
end $$;

revoke all on all functions in schema portal_private from public, anon, authenticated, service_role;
revoke all on function public.portal_api(text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.portal_bootstrap(text,text) from public, anon, authenticated;
grant execute on function public.portal_api(text,jsonb,text,text) to service_role;
grant execute on function public.portal_bootstrap(text,text) to service_role;
commit;
