begin;
create function portal_private.admin_action(a portal_private.admin_users, action text, body jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  u portal_private.users;
  target uuid;
  pid uuid;
  result jsonb;
  metadata jsonb := '{}';
  until_at timestamptz;
begin
  if action = 'admin.me' then
    return jsonb_build_object('admin',jsonb_build_object('id',a.id,'username',a.username,'role',a.role));
  end if;
  if action = 'admin.users' then
    select coalesce(jsonb_agg(portal_private.user_view(t)),'[]') into result from (
      select * from portal_private.users order by created_at,id limit 100 offset greatest(0,least(coalesce((body->>'offset')::integer,0),1000000))
    ) t;
    return jsonb_build_object('users', result);
  end if;
  if action = 'admin.audit' then
    select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (
      select * from portal_private.admin_audit_log where id < coalesce((body->>'before_id')::bigint,9223372036854775807)
      order by id desc limit 100
    ) t;
    return jsonb_build_object('events',result);
  end if;
  if action = 'admin.create' then
    insert into portal_private.users(username,role)
      values(portal_private.username(body->>'username'),coalesce(body->>'role','player')) returning * into u;
    insert into portal_private.user_passwords(user_id,password_hash,type)
      values(u.id,portal_private.password_hash(body->>'password'),'user');
  else
    target := (body->>'user_id')::uuid;
    select * into u from portal_private.users where id = target for update;
    if u.id is null then return '{"error":"not_found"}'; end if;
    if action = 'admin.passwords' then
      select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'label',p.label,'created_at',p.created_at) order by p.created_at),'[]')
        into result from portal_private.user_passwords p where user_id = u.id and type = 'admin_added' and revoked_at is null;
      return jsonb_build_object('passwords',result);
    elsif action = 'admin.rename' then
      metadata := jsonb_build_object('previous_username',u.username,'username',portal_private.username(body->>'username'));
      update portal_private.users set username = portal_private.username(body->>'username') where id = u.id;
    elsif action = 'admin.role' then
      -- Ordinary user roles never confer administration rights.
      update portal_private.users set role = body->>'role' where id = u.id;
      metadata := jsonb_build_object('role',body->>'role');
    elsif action = 'admin.password.add' then
      if (select count(*) from portal_private.user_passwords where user_id = u.id and type = 'admin_added' and revoked_at is null) >= 5 then
        return '{"error":"password_limit"}';
      end if;
      insert into portal_private.user_passwords(user_id,password_hash,type,label)
        values(u.id,portal_private.password_hash(body->>'password'),'admin_added',body->>'label') returning id into pid;
      -- Labels are intentionally excluded from audit metadata: never log credential input.
      metadata := jsonb_build_object('password_id',pid);
    elsif action = 'admin.password.revoke' then
      update portal_private.user_passwords set revoked_at = now()
        where id = (body->>'password_id')::uuid and user_id = u.id and type = 'admin_added' and revoked_at is null returning id into pid;
      if pid is null then return '{"error":"not_found"}'; end if;
      update portal_private.sessions set revoked_at = now() where password_id = pid and revoked_at is null;
      metadata := jsonb_build_object('password_id',pid);
    elsif action = 'admin.kick' then
      update portal_private.sessions set revoked_at = now() where user_id = u.id and revoked_at is null;
    elsif action = 'admin.ban' then
      until_at := nullif(body->>'banned_until','')::timestamptz;
      if until_at is not null and (not isfinite(until_at) or until_at <= now()) then
        raise exception 'ban expiration must be in the future' using errcode = '22023';
      end if;
      update portal_private.users set is_banned = true,banned_until = until_at,ban_reason = body->>'reason' where id = u.id;
      update portal_private.sessions set revoked_at = now() where user_id = u.id and revoked_at is null;
      metadata := jsonb_build_object('banned_until',until_at,'reason',body->>'reason');
    elsif action = 'admin.unban' then
      update portal_private.users set is_banned = false,banned_until = null,ban_reason = null where id = u.id;
    elsif action = 'admin.disable' then
      update portal_private.users set status = 'disabled' where id = u.id;
      update portal_private.sessions set revoked_at = now() where user_id = u.id and revoked_at is null;
    elsif action = 'admin.enable' then
      update portal_private.users set status = 'active' where id = u.id;
    else return '{"error":"unknown_action"}'; end if;
    update portal_private.users set updated_at = now() where id = u.id returning * into u;
  end if;
  insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata) values(a.id,action,u.id,metadata);
  return jsonb_build_object('user',portal_private.user_view(u));
end $$;
revoke all on function portal_private.admin_action(portal_private.admin_users,text,jsonb) from public,anon,authenticated,service_role;
commit;
