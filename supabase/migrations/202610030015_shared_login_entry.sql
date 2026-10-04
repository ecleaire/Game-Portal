begin;

-- One UI entry, separate credential tables and session domains. Admin names
-- take precedence; never retry their password against a normal user account.
alter function public.portal_api(text,jsonb,text,text) rename to portal_api_separate_domains;
create function public.portal_api(p_action text, p_body jsonb default '{}', p_token_hash text default null,
  p_new_token_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare domain_action text := p_action;
begin
  if p_action='portal.login' then
    if exists(select 1 from portal_private.admin_users where username=lower(btrim(p_body->>'username'))) then
      domain_action:='admin.login';
    else
      domain_action:='user.login';
    end if;
  end if;
  return public.portal_api_separate_domains(domain_action,p_body,p_token_hash,p_new_token_hash);
end $$;
revoke all on function public.portal_api_separate_domains(text,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.portal_api(text,jsonb,text,text) to service_role;

commit;
