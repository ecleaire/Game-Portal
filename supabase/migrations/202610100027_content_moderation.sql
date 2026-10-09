begin;
-- Rules are private configuration, never a browser-editable blacklist.
create function portal_private.content_normalize(value text) returns text language sql immutable set search_path='' as $$
 select lower(translate(normalize(coalesce(value,''),NFKC), U&'\200B\200C\200D\2060\FEFF',''));
$$;
create table portal_private.content_rules (
 id uuid primary key default gen_random_uuid(), term text not null check(char_length(term) between 1 and 80),
 normalized text not null unique, match_mode text not null check(match_mode in ('substring','word')),
 category text not null check(category in ('abuse','discrimination','sexual','custom')),
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table portal_private.content_rules enable row level security;
revoke all on portal_private.content_rules from public,anon,authenticated,service_role;
-- A small initial set avoids banning neutral game-related words or identities.
insert into portal_private.content_rules(term,normalized,match_mode,category)
 select term,portal_private.content_normalize(term),mode,category from (values
 ('死ね','substring','abuse'),('ぶっ殺す','substring','abuse'),('殺してやる','substring','abuse'),
 ('劣等民族','substring','discrimination'),('nigger','word','discrimination'),
 ('強姦','substring','sexual'),('レイプ','substring','sexual'),('児童ポルノ','substring','sexual'),
 ('ちんこ','substring','sexual'),('まんこ','substring','sexual'),('fuck','word','abuse'),('cunt','word','sexual')
 ) seed(term,mode,category) on conflict(normalized) do nothing;

create function portal_private.check_content(value text,field_name text,allow_urls boolean default false) returns void
language plpgsql set search_path='' as $$
declare n text:=portal_private.content_normalize(value); compact text; rule record; words text[];
begin
 compact:=regexp_replace(n,'[[:space:][:punct:]]','','g');
 words:=regexp_split_to_array(n,'[^a-z0-9]+');
 for rule in select * from portal_private.content_rules where is_active loop
  if (rule.match_mode='substring' and strpos(compact,regexp_replace(rule.normalized,'[[:space:][:punct:]]','','g'))>0)
    or (rule.match_mode='word' and rule.normalized=any(words)) then
   raise exception using errcode='PT001',message='content_blocked',detail=field_name;
  end if;
 end loop;
 -- Common links, bare domains, email addresses, and IPv4 URLs. This is not a
 -- guarantee against every obfuscation, and is not a substitute for safe output.
 if not allow_urls and (
  n ~ '(https?|ftp|javascript|data)[[:space:]]*:' or n ~ 'www[[:space:]]*\.'
  or n ~ '(^|[^a-z0-9])[a-z0-9][a-z0-9.-]*\.(com|org|net|edu|gov|jp|io|co|dev|app|xyz|info|biz|me|tv|gg|ai|uk|de|fr|cn|ru|us|online|site)([^a-z0-9]|$)'
  or n ~ '(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([/:]|$)'
 ) then raise exception using errcode='PT002',message='url_not_allowed',detail=field_name;end if;
end $$;
create function portal_private.moderate_fields() returns trigger language plpgsql set search_path='' as $$
declare key text; next jsonb:=to_jsonb(new); previous jsonb;
begin
 if tg_op='UPDATE' then previous:=to_jsonb(old);end if;
 foreach key in array tg_argv loop
  if tg_op='INSERT' or next->key is distinct from previous->key then
   perform portal_private.check_content(next->>key,key,key='credits');
  end if;
 end loop;
 return new;
end $$;
create trigger moderate_users before insert or update on portal_private.users for each row execute function portal_private.moderate_fields('username','display_name');
create trigger moderate_admins before insert or update on portal_private.admin_users for each row execute function portal_private.moderate_fields('username');
create trigger moderate_games before insert or update on portal_private.game_submissions for each row execute function portal_private.moderate_fields('title','description','controls','version','credits');
create trigger moderate_groups before insert or update on portal_private.groups for each row execute function portal_private.moderate_fields('name','description');
create trigger moderate_tags before insert or update on portal_private.tags for each row execute function portal_private.moderate_fields('name','slug','category');
create trigger moderate_lists before insert or update on portal_private.game_playlists for each row execute function portal_private.moderate_fields('name');

alter function public.portal_api(text,jsonb,text,text) rename to portal_api_before_moderation;
create function public.portal_api(p_action text,p_body jsonb default '{}',p_token_hash text default null,p_new_token_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare checked jsonb; rule portal_private.content_rules; t text; mode text; rule_category text; field_name text;
begin
 if p_action like 'admin.moderation.%' then
  checked:=public.portal_api_before_moderation('admin.me','{}',p_token_hash,null);
  if checked ? 'error' then return checked;end if;
  if checked->'admin'->>'role' is distinct from 'super_admin' then return '{"error":"forbidden"}';end if;
  if p_action='admin.moderation.list' then
   return jsonb_build_object('rules',(select coalesce(jsonb_agg(to_jsonb(r)-'normalized' order by r.category,r.term),'[]') from portal_private.content_rules r));
  end if;
  if p_action not in ('admin.moderation.create','admin.moderation.update') then return '{"error":"unknown_action"}';end if;
  t:=btrim(p_body->>'term');mode:=p_body->>'match_mode';rule_category:=p_body->>'category';
  if t is null or char_length(t) not between 1 and 80 or t ~ '[[:cntrl:]]' or regexp_replace(portal_private.content_normalize(t),'[[:space:][:punct:]]','','g')=''
   or mode is null or mode not in ('substring','word') or rule_category is null or rule_category not in ('abuse','discrimination','sexual','custom')
   or (mode='word' and portal_private.content_normalize(t) !~ '^[a-z0-9]+$') or p_body->>'is_active' is null or p_body->>'is_active' not in ('true','false')
   then return '{"error":"invalid_rule"}';end if;
  -- Serialize edits to enforce the total configuration limit and uniqueness.
  perform pg_advisory_xact_lock(1847373950);
  if p_action='admin.moderation.create' then
   if (select count(*) from portal_private.content_rules)>=1000 then return '{"error":"rule_limit"}';end if;
   insert into portal_private.content_rules(term,normalized,match_mode,category,is_active)
   values(t,portal_private.content_normalize(t),mode,rule_category,(p_body->>'is_active')::boolean) returning * into rule;
  else
   update portal_private.content_rules set term=t,normalized=portal_private.content_normalize(t),match_mode=mode,category=rule_category,is_active=(p_body->>'is_active')::boolean,updated_at=now()
   where id=(p_body->>'rule_id')::uuid returning * into rule;
   if rule.id is null then return '{"error":"not_found"}';end if;
  end if;
  insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata) values((checked->'admin'->>'id')::uuid,p_action,rule.id,jsonb_build_object('is_active',rule.is_active));
  return jsonb_build_object('rule',to_jsonb(rule)-'normalized');
 end if;
 return public.portal_api_before_moderation(p_action,p_body,p_token_hash,p_new_token_hash);
exception
 when sqlstate 'PT001' or sqlstate 'PT002' then
  get stacked diagnostics field_name=pg_exception_detail;
  -- The exception subtransaction rolls back all changes, including earlier
  -- metadata updates and audit entries. Never echo the submitted text or term.
  return jsonb_build_object('error',case when sqlstate='PT001' then 'content_blocked' else 'url_not_allowed' end,'field',field_name);
 when unique_violation then
  if p_action like 'admin.moderation.%' then return '{"error":"rule_conflict"}';end if;
  raise;
 when invalid_text_representation then
  if p_action like 'admin.moderation.%' then return '{"error":"invalid_rule"}';end if;
  raise;
end $$;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
revoke all on function public.portal_api_before_moderation(text,jsonb,text,text),public.portal_api(text,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.portal_api(text,jsonb,text,text) to service_role;
commit;
