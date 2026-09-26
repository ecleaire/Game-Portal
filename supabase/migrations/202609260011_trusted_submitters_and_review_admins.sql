begin;

-- A trusted uploader may skip the human review queue. The package remains in
-- private Drive storage and still requires the normal publication procedure.
alter table portal_private.users drop constraint if exists users_role_check;
alter table portal_private.users add constraint users_role_check
  check (role in ('player','uploader','trusted_uploader'));

alter function portal_private.admin_action(portal_private.admin_users,text,jsonb) rename to admin_action_phase4;
create function portal_private.admin_action(a portal_private.admin_users, action text, body jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare created portal_private.admin_users;
begin
  if action in ('admin.create','admin.role') and coalesce(body->>'role','') = 'trusted_uploader' and a.role <> 'super_admin' then
    return '{"error":"forbidden"}';
  end if;
  if action = 'admin.admin.create' then
    if a.role <> 'super_admin' then return '{"error":"forbidden"}'; end if;
    insert into portal_private.admin_users(username,password_hash,role)
      values(portal_private.username(body->>'username'),portal_private.password_hash(body->>'password'),'admin') returning * into created;
    insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata)
      values(a.id,'admin.admin.create',created.id,jsonb_build_object('username',created.username,'role',created.role));
    return jsonb_build_object('admin',jsonb_build_object('id',created.id,'username',created.username,'role',created.role));
  end if;
  return portal_private.admin_action_phase4(a,action,body);
end $$;
revoke all on function portal_private.admin_action(portal_private.admin_users,text,jsonb) from public,anon,authenticated,service_role;

alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_phase4;
create function portal_private.submission_action(u portal_private.users, action text, body jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s portal_private.game_submissions;
begin
  if action = 'user.submission.create' then
    if u.role not in ('uploader','trusted_uploader') then return '{"error":"forbidden"}'; end if;
    insert into portal_private.game_submissions(user_id,title,engine,description,version,controls)
      values(u.id,btrim(body->>'title'),body->>'engine',coalesce(body->>'description',''),btrim(body->>'version'),coalesce(body->>'controls','')) returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  if action = 'user.submission.prepare' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if u.role not in ('uploader','trusted_uploader') then return '{"error":"forbidden"}'; end if;
    if s.status <> 'uploading' then return '{"error":"conflict"}'; end if;
    return jsonb_build_object('submission_id',s.id);
  end if;
  if action = 'user.submission.complete' then
    select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
    if s.id is null then return '{"error":"not_found"}'; end if;
    if s.status <> 'uploading' then return '{"error":"conflict"}'; end if;
    update portal_private.game_submissions
      set status=case when u.role='trusted_uploader' then 'approved' else 'pending' end,
          drive_file_id=body->>'drive_file_id',package_name=body->>'package_name',package_size=(body->>'package_size')::bigint,
          review_reason=case when u.role='trusted_uploader' then '信頼済み投稿者により審査を省略' else null end,updated_at=now()
      where id=s.id returning * into s;
    return jsonb_build_object('submission',portal_private.submission_view(s));
  end if;
  return portal_private.submission_action_phase4(u,action,body);
end $$;
revoke all on function portal_private.submission_action(portal_private.users,text,jsonb) from public,anon,authenticated,service_role;

-- Rebind the entrypoint after replacing the delegated action functions.
create or replace function public.portal_api(p_action text, p_body jsonb default '{}', p_token_hash text default null,
  p_new_token_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u portal_private.users; a portal_private.admin_users; s portal_private.sessions; pw portal_private.user_passwords;
  n text; found_password uuid; valid boolean := false; exp timestamptz;
begin
  if p_action in ('user.login','admin.login') then
    if not portal_private.throttle(p_action || ':global',100) then return '{"error":"rate_limited"}'; end if;
    n:=lower(btrim(coalesce(p_body->>'username','')));
    if n !~ '^[a-z0-9_]{3,32}$' or p_body->>'password' is null or octet_length(p_body->>'password')>72 then return '{"error":"invalid_credentials"}'; end if;
    if not portal_private.throttle(p_action || ':' || n,10) then return '{"error":"rate_limited"}'; end if;
    if p_new_token_hash is null or p_new_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'missing token digest' using errcode='22023'; end if;
    if p_action='admin.login' then
      select * into a from portal_private.admin_users where username=n for update;
      if a.id is not null then valid:=extensions.crypt(p_body->>'password',a.password_hash)=a.password_hash and a.active; else perform extensions.crypt(p_body->>'password','$2a$12$000000000000000000000.'); end if;
      if not valid then return '{"error":"invalid_credentials"}'; end if;
      exp:=now()+interval '1 hour'; insert into portal_private.sessions(token_hash,admin_id,expires_at) values(p_new_token_hash,a.id,exp);
      return jsonb_build_object('expires_at',exp,'admin',jsonb_build_object('id',a.id,'username',a.username,'role',a.role));
    end if;
    select * into u from portal_private.users where username=n for update;
    if u.id is not null then for pw in select * from portal_private.user_passwords where user_id=u.id and revoked_at is null order by created_at,id loop if extensions.crypt(p_body->>'password',pw.password_hash)=pw.password_hash then found_password:=pw.id; end if; end loop; else perform extensions.crypt(p_body->>'password','$2a$12$000000000000000000000.'); end if;
    if found_password is null or not portal_private.available(u) then return '{"error":"invalid_credentials"}'; end if;
    exp:=now()+interval '8 hours'; insert into portal_private.sessions(token_hash,user_id,password_id,expires_at) values(p_new_token_hash,u.id,found_password,exp);
    return jsonb_build_object('expires_at',exp,'user',portal_private.user_view(u));
  end if;
  select * into s from portal_private.sessions where token_hash=p_token_hash;
  if s.user_id is not null then select * into u from portal_private.users where id=s.user_id for update; elsif s.admin_id is not null then select * into a from portal_private.admin_users where id=s.admin_id for update; else return '{"error":"unauthorized"}'; end if;
  select * into s from portal_private.sessions where token_hash=p_token_hash and revoked_at is null and expires_at>now();
  if s.id is null or (u.id is not null and not portal_private.available(u)) or (a.id is not null and not a.active) then return '{"error":"unauthorized"}'; end if;
  if p_action='logout' then update portal_private.sessions set revoked_at=now() where id=s.id; return '{"ok":true}'; end if;
  if p_action like 'user.%' then
    if u.id is null then return '{"error":"forbidden"}'; end if;
    if p_action='user.me' then return jsonb_build_object('user',portal_private.user_view(u)); end if;
    if p_action='user.rename' then update portal_private.users set username=portal_private.username(p_body->>'username'),updated_at=now() where id=u.id returning * into u; return jsonb_build_object('user',portal_private.user_view(u)); end if;
    if p_action='user.profile' then update portal_private.users set display_name=portal_private.display_name(p_body->>'display_name'),avatar_key=portal_private.avatar_key(p_body->>'avatar_key'),updated_at=now() where id=u.id returning * into u; return jsonb_build_object('user',portal_private.user_view(u)); end if;
    if p_action='user.password' then select * into pw from portal_private.user_passwords where user_id=u.id and type='user' and revoked_at is null; if not portal_private.throttle('password:' || u.id,10) then return '{"error":"rate_limited"}'; end if; if p_body->>'current_password' is null or octet_length(p_body->>'current_password')>72 or extensions.crypt(p_body->>'current_password',pw.password_hash)<>pw.password_hash then return '{"error":"invalid_credentials"}'; end if; n:=portal_private.password_hash(p_body->>'password'); update portal_private.user_passwords set revoked_at=now() where id=pw.id; insert into portal_private.user_passwords(user_id,password_hash,type) values(u.id,n,'user'); update portal_private.sessions set revoked_at=now() where user_id=u.id and revoked_at is null; update portal_private.users set updated_at=now() where id=u.id; return '{"ok":true,"reauthenticate":true}'; end if;
    return portal_private.submission_action(u,p_action,p_body);
  end if;
  if a.id is null then return '{"error":"forbidden"}'; end if;
  return portal_private.admin_action(a,p_action,p_body);
end $$;

commit;
