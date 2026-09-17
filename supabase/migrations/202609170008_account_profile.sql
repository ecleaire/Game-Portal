begin;

-- Profile data is deliberately limited to a display name and a fixed local icon.
-- Arbitrary image URLs and uploads are not accepted or stored in the account profile.
alter table portal_private.users add column display_name text;
alter table portal_private.users add column avatar_key text not null default 'gamepad';
alter table portal_private.users add constraint users_display_name_check
  check (display_name is null or (char_length(display_name) between 1 and 40 and display_name !~ '[[:cntrl:]]'));
alter table portal_private.users add constraint users_avatar_key_check
  check (avatar_key in ('gamepad','star','rocket','puzzle','palette','lightning','cat','fox','panda'));

create function portal_private.display_name(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare n text := btrim(p);
begin
  if n is null or char_length(n) not between 1 and 40 or n ~ '[[:cntrl:]]' then
    raise exception 'display name must contain 1-40 non-control characters' using errcode = '22023';
  end if;
  return n;
end $$;

create function portal_private.avatar_key(p text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p not in ('gamepad','star','rocket','puzzle','palette','lightning','cat','fox','panda') then
    raise exception 'invalid avatar key' using errcode = '22023';
  end if;
  return p;
end $$;

create or replace function portal_private.user_view(u portal_private.users) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',u.id,'username',u.username,'display_name',coalesce(u.display_name,u.username),
    'avatar_key',u.avatar_key,'role',u.role,'status',u.status,
    'banned',u.is_banned and (u.banned_until is null or u.banned_until > now()),
    'banned_until',u.banned_until,'ban_reason',u.ban_reason,'created_at',u.created_at,'updated_at',u.updated_at);
$$;

-- Recreate portal_api after adding the profile action. This also refreshes the
-- cached PL/pgSQL plan for the submission review wrapper from migration 005.
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
    if p_action='user.profile' then
      update portal_private.users
        set display_name=portal_private.display_name(p_body->>'display_name'),
            avatar_key=portal_private.avatar_key(p_body->>'avatar_key'), updated_at=now()
        where id=u.id returning * into u;
      return jsonb_build_object('user',portal_private.user_view(u));
    end if;
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



