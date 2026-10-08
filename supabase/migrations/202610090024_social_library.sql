begin;
-- No identity lists are exposed, including to administrators and game authors.
create table portal_private.game_likes (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references portal_private.game_submissions(id) on delete cascade,
 user_id uuid references portal_private.users(id) on delete cascade,
 admin_id uuid references portal_private.admin_users(id) on delete cascade,
 created_at timestamptz not null default now(),
 check(num_nonnulls(user_id,admin_id)=1), unique(user_id,game_id), unique(admin_id,game_id)
);
create index game_likes_game on portal_private.game_likes(game_id);
create table portal_private.game_playlists (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references portal_private.users(id) on delete cascade,
 admin_id uuid references portal_private.admin_users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100),
 share_token text unique check(share_token ~ '^[a-f0-9]{48}$'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(num_nonnulls(user_id,admin_id)=1)
);
create index playlists_user on portal_private.game_playlists(user_id);
create index playlists_admin on portal_private.game_playlists(admin_id);
create table portal_private.playlist_items (
 id uuid primary key default gen_random_uuid(),
 playlist_id uuid not null references portal_private.game_playlists(id) on delete cascade,
 game_id uuid not null references portal_private.game_submissions(id) on delete cascade,
 sort_order integer not null default 0, created_at timestamptz not null default now(),
 unique(playlist_id,game_id)
);
create index playlist_items_game on portal_private.playlist_items(game_id);
create table portal_private.creator_follows (
 id uuid primary key default gen_random_uuid(),
 creator_id uuid not null references portal_private.users(id) on delete cascade,
 user_id uuid references portal_private.users(id) on delete cascade,
 admin_id uuid references portal_private.admin_users(id) on delete cascade,
 created_at timestamptz not null default now(),
 check(num_nonnulls(user_id,admin_id)=1),check(user_id is distinct from creator_id),
 unique(user_id,creator_id),unique(admin_id,creator_id)
);
create index creator_follows_creator on portal_private.creator_follows(creator_id);
alter table portal_private.game_likes enable row level security;
alter table portal_private.game_playlists enable row level security;
alter table portal_private.playlist_items enable row level security;
alter table portal_private.creator_follows enable row level security;
revoke all on portal_private.game_likes,portal_private.game_playlists,portal_private.playlist_items,portal_private.creator_follows from public,anon,authenticated,service_role;

-- Reuse the same live access checks as the player; never return storage keys,
-- a private title, slug, audience or author identity for an inaccessible entry.
create function portal_private.library_game(gid uuid,u portal_private.users,a portal_private.admin_users) returns jsonb language plpgsql set search_path='' as $$
declare s portal_private.game_submissions; result jsonb; own_preview boolean:=false;
begin
 select * into s from portal_private.game_submissions where id=gid;
 if s.id is null then return '{"unavailable":true}';end if;
 result:=public.portal_public_game(s.public_slug);
 if result is null and u.id is not null then
  if s.user_id=u.id and s.package_storage_key is not null and s.status in ('draft','pending','rejected','approved') then
   own_preview:=true;result:='{}';
  else result:=portal_private.submission_action(u,'user.shared.game',jsonb_build_object('slug',s.public_slug))->'game';end if;
 elsif result is null and a.id is not null then
  result:=portal_private.admin_action(a,'admin.shared.game',jsonb_build_object('slug',s.public_slug))->'game';
 end if;
 if result is null then return '{"unavailable":true}';end if;
 return jsonb_build_object('title',s.title,'engine',s.engine,'slug',s.public_slug,'tags',portal_private.submission_view(s)->'tags',
  'own_preview_id',case when own_preview then s.id else null end);
end $$;

alter function public.portal_api(text,jsonb,text,text) rename to portal_api_before_social;
create function public.portal_api(p_action text,p_body jsonb default '{}',p_token_hash text default null,p_new_token_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare checked jsonb; u portal_private.users; a portal_private.admin_users;
 s portal_private.game_submissions; l portal_private.game_playlists; result jsonb; items jsonb;
 gid uuid; count_items integer; ids uuid[]; page_offset integer;
begin
 if p_action not like 'social.%' then return public.portal_api_before_social(p_action,p_body,p_token_hash,p_new_token_hash);end if;
 if p_token_hash is not null then
  checked:=public.portal_api_before_social('user.me','{}',p_token_hash,null);
  if checked->>'error'='forbidden' then checked:=public.portal_api_before_social('admin.me','{}',p_token_hash,null);end if;
  if checked ? 'error' then return checked;end if;
  if checked ? 'user' then select * into u from portal_private.users where id=(checked->'user'->>'id')::uuid for update;
  elsif checked ? 'admin' then select * into a from portal_private.admin_users where id=(checked->'admin'->>'id')::uuid for update;
  else return '{"error":"unauthorized"}';end if;
 elsif p_action not in ('social.game','social.list.shared') then return '{"error":"unauthorized"}';end if;

 if p_action in ('social.game','social.like','social.follow') then
  -- Removal by an owned opaque row ID remains possible after game access is lost.
  if p_action='social.like' and p_body->>'liked'='false' and p_body ? 'like_id' then
   delete from portal_private.game_likes where id=(p_body->>'like_id')::uuid and (user_id=u.id or admin_id=a.id);
   return '{"ok":true}';
  elsif p_action='social.follow' and p_body->>'followed'='false' and p_body ? 'follow_id' then
   delete from portal_private.creator_follows where id=(p_body->>'follow_id')::uuid and (user_id=u.id or admin_id=a.id);
   return '{"ok":true}';
  end if;
  select * into s from portal_private.game_submissions where public_slug=p_body->>'slug';
  if s.id is null or portal_private.library_game(s.id,u,a)->>'unavailable'='true' then return '{"error":"not_found"}';end if;
  if p_action='social.like' then
   if p_body->>'liked'='true' then
    if not exists(select 1 from portal_private.game_likes where game_id=s.id and (user_id=u.id or admin_id=a.id)) then
     if (select count(*) from portal_private.game_likes where user_id=u.id or admin_id=a.id)>=1000 then return '{"error":"limit_reached"}';end if;
     insert into portal_private.game_likes(game_id,user_id,admin_id) values(s.id,u.id,a.id) on conflict do nothing;
    end if;
   elsif p_body->>'liked'='false' then delete from portal_private.game_likes where game_id=s.id and (user_id=u.id or admin_id=a.id);
   else return '{"error":"invalid_request"}';end if;
  elsif p_action='social.follow' then
   if s.user_id=u.id then return '{"error":"invalid_request"}';end if;
   if not exists(select 1 from portal_private.users r where r.id=s.user_id and portal_private.available(r)) then return '{"error":"not_found"}';end if;
   if p_body->>'followed'='true' then
    if not exists(select 1 from portal_private.creator_follows where creator_id=s.user_id and (user_id=u.id or admin_id=a.id)) then
     if (select count(*) from portal_private.creator_follows where user_id=u.id or admin_id=a.id)>=500 then return '{"error":"limit_reached"}';end if;
     insert into portal_private.creator_follows(creator_id,user_id,admin_id) values(s.user_id,u.id,a.id) on conflict do nothing;
    end if;
   elsif p_body->>'followed'='false' then delete from portal_private.creator_follows where creator_id=s.user_id and (user_id=u.id or admin_id=a.id);
   else return '{"error":"invalid_request"}';end if;
  end if;
  return jsonb_build_object('like_count',(select count(*) from portal_private.game_likes where game_id=s.id),
   'liked',exists(select 1 from portal_private.game_likes where game_id=s.id and (user_id=u.id or admin_id=a.id)),
   'followed',exists(select 1 from portal_private.creator_follows where creator_id=s.user_id and (user_id=u.id or admin_id=a.id)),
   'self',s.user_id=u.id,'creator',(select coalesce(nullif(r.display_name,''),r.username) from portal_private.users r where r.id=s.user_id),
   'saved_list_ids',coalesce((select jsonb_agg(p.id) from portal_private.game_playlists p join portal_private.playlist_items i on i.playlist_id=p.id and i.game_id=s.id where p.user_id=u.id or p.admin_id=a.id),'[]'));
 elsif p_action='social.likes' then
  select coalesce(jsonb_agg(portal_private.library_game(x.game_id,u,a)||jsonb_build_object('like_id',x.id) order by x.created_at desc,x.id),'[]') into items
   from portal_private.game_likes x where x.user_id=u.id or x.admin_id=a.id;
  return jsonb_build_object('games',items);
 elsif p_action='social.following' then
  page_offset:=greatest(0,least(coalesce((p_body->>'offset')::integer,0),500));
  select coalesce(jsonb_agg(jsonb_build_object('follow_id',f.id,'name',case when portal_private.available(r) then coalesce(nullif(r.display_name,''),r.username) else '利用できないアカウント' end,
   'games',case when portal_private.available(r) then coalesce((select jsonb_agg(v) from
    (select portal_private.library_game(gs.id,u,a) v from portal_private.game_submissions gs where gs.user_id=r.id order by gs.created_at desc limit 12) visible where v->>'unavailable' is distinct from 'true'),'[]') else '[]'::jsonb end) order by f.created_at desc,f.id),'[]') into items
   from (select * from portal_private.creator_follows where user_id=u.id or admin_id=a.id order by created_at desc,id limit 25 offset page_offset) f join portal_private.users r on r.id=f.creator_id;
  return jsonb_build_object('following',items,'has_more',(select count(*)>page_offset+25 from portal_private.creator_follows where user_id=u.id or admin_id=a.id));
 elsif p_action='social.lists' then
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'share_token',p.share_token,'item_count',(select count(*) from portal_private.playlist_items where playlist_id=p.id)) order by p.created_at,p.id),'[]') into items
   from portal_private.game_playlists p where p.user_id=u.id or p.admin_id=a.id;
  return jsonb_build_object('lists',items);
 elsif p_action='social.list.create' then
  if (select count(*) from portal_private.game_playlists where user_id=u.id or admin_id=a.id)>=50 then return '{"error":"limit_reached"}';end if;
  insert into portal_private.game_playlists(user_id,admin_id,name) values(u.id,a.id,btrim(p_body->>'name')) returning * into l;
  return jsonb_build_object('list',jsonb_build_object('id',l.id,'name',l.name));
 elsif p_action like 'social.list.%' then
  if p_action='social.list.shared' then
   if coalesce(p_body->>'share_token','') !~ '^[a-f0-9]{48}$' then return '{"error":"not_found"}';end if;
   select * into l from portal_private.game_playlists where share_token=p_body->>'share_token';
   if l.id is null or not (exists(select 1 from portal_private.users r where r.id=l.user_id and portal_private.available(r)) or exists(select 1 from portal_private.admin_users r where r.id=l.admin_id and r.active)) then return '{"error":"not_found"}';end if;
  else
   select * into l from portal_private.game_playlists where id=(p_body->>'list_id')::uuid and (user_id=u.id or admin_id=a.id) for update;
   if l.id is null then return '{"error":"not_found"}';end if;
  end if;
  if p_action in ('social.list.get','social.list.shared') then
   select coalesce(jsonb_agg(portal_private.library_game(i.game_id,u,a)||case when p_action='social.list.get' then jsonb_build_object('entry_id',i.id) else '{}'::jsonb end order by i.sort_order,i.created_at,i.id),'[]') into items from portal_private.playlist_items i where playlist_id=l.id;
   return jsonb_build_object('list',jsonb_build_object('name',l.name,'games',items)||case when p_action='social.list.get' then jsonb_build_object('id',l.id,'share_token',l.share_token) else '{}'::jsonb end);
  elsif p_action='social.list.update' then update portal_private.game_playlists set name=btrim(p_body->>'name'),updated_at=now() where id=l.id;
  elsif p_action='social.list.delete' then
   if p_body->>'confirmation' is distinct from 'delete' then return '{"error":"invalid_request"}';end if;
   delete from portal_private.game_playlists where id=l.id;
  elsif p_action='social.list.share' then
   if p_body->>'operation'='enable' then update portal_private.game_playlists set share_token=coalesce(share_token,encode(extensions.gen_random_bytes(24),'hex')),updated_at=now() where id=l.id returning * into l;
   elsif p_body->>'operation'='disable' then update portal_private.game_playlists set share_token=null,updated_at=now() where id=l.id returning * into l;
   else return '{"error":"invalid_request"}';end if;
   return jsonb_build_object('share_token',l.share_token);
  elsif p_action='social.list.item' then
   if p_body->>'operation'='remove' then delete from portal_private.playlist_items where playlist_id=l.id and id=(p_body->>'entry_id')::uuid;
   elsif p_body->>'operation'='add' then
    select id into gid from portal_private.game_submissions where public_slug=p_body->>'slug';
    if gid is null or portal_private.library_game(gid,u,a)->>'unavailable'='true' then return '{"error":"not_found"}';end if;
    if not exists(select 1 from portal_private.playlist_items where playlist_id=l.id and game_id=gid) then
     if (select count(*) from portal_private.playlist_items where playlist_id=l.id)>=500 then return '{"error":"limit_reached"}';end if;
     insert into portal_private.playlist_items(playlist_id,game_id,sort_order) values(l.id,gid,coalesce((select max(sort_order)+1 from portal_private.playlist_items where playlist_id=l.id),0));
    end if;
   else return '{"error":"invalid_request"}';end if;
  elsif p_action='social.list.order' then
   if jsonb_typeof(p_body->'entry_ids') is distinct from 'array' or jsonb_array_length(p_body->'entry_ids')>500 then return '{"error":"invalid_request"}';end if;
   select coalesce(array_agg(v::uuid),'{}') into ids from jsonb_array_elements_text(p_body->'entry_ids') x(v);
   select count(*) into count_items from portal_private.playlist_items where playlist_id=l.id;
   if cardinality(ids)<>count_items or (select count(distinct x) from unnest(ids) x)<>count_items or exists(select 1 from unnest(ids) x where not exists(select 1 from portal_private.playlist_items where playlist_id=l.id and id=x)) then return '{"error":"conflict"}';end if;
   update portal_private.playlist_items i set sort_order=o.ord::integer from unnest(ids) with ordinality o(id,ord) where i.playlist_id=l.id and i.id=o.id;
  else return '{"error":"invalid_request"}';end if;
  return '{"ok":true}';
 end if;
 return '{"error":"invalid_request"}';
end $$;
revoke all on function public.portal_api_before_social(text,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.portal_api(text,jsonb,text,text) to service_role;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
commit;
