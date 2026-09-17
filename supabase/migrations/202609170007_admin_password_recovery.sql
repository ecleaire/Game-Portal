begin;

-- Recovery is deliberately server-side only. The Edge Function never exposes
-- this RPC, and a successful reset invalidates every existing admin session.
create function public.portal_reset_admin_password(p_username text, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare a portal_private.admin_users;
begin
  select * into a from portal_private.admin_users
    where username = portal_private.username(p_username) and role = 'super_admin' for update;
  if a.id is null then raise exception 'super administrator not found' using errcode = '22023'; end if;
  update portal_private.admin_users
    set password_hash = portal_private.password_hash(p_password), updated_at = now()
    where id = a.id;
  update portal_private.sessions set revoked_at = now()
    where admin_id = a.id and revoked_at is null;
  insert into portal_private.admin_audit_log(admin_id,action,target_id)
    values(a.id,'admin.password_recovery',a.id);
end $$;

revoke all on function public.portal_reset_admin_password(text,text) from public, anon, authenticated;
grant execute on function public.portal_reset_admin_password(text,text) to service_role;

commit;
