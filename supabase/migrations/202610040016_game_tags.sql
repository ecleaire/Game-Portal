begin;
create table portal_private.tags (
 id uuid primary key default extensions.gen_random_uuid(),
 name text not null check(char_length(btrim(name)) between 1 and 40),
 slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug)<=80),
 category text not null check(char_length(btrim(category)) between 1 and 40),
 sort_order integer not null default 0, is_active boolean not null default true,
 created_at timestamptz not null default now()
);
create table portal_private.game_tags (
 game_id uuid not null references portal_private.game_submissions(id) on delete cascade,
 tag_id uuid not null references portal_private.tags(id), created_at timestamptz not null default now(),
 primary key(game_id,tag_id)
);
create index game_tags_tag on portal_private.game_tags(tag_id,game_id);
alter table portal_private.tags enable row level security;
alter table portal_private.game_tags enable row level security;
revoke all on portal_private.tags,portal_private.game_tags from public,anon,authenticated,service_role;

create function portal_private.tag_limit() returns trigger language plpgsql set search_path='' as $$
begin
 perform 1 from portal_private.game_submissions where id=new.game_id for update;
 if (select count(*) from portal_private.game_tags where game_id=new.game_id)>=8 then raise exception 'tag_limit'; end if;
 return new;
end $$;
create trigger game_tags_limit before insert on portal_private.game_tags for each row execute function portal_private.tag_limit();

create function portal_private.game_tag_view(g uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(t) order by t.category,t.sort_order,t.name),'[]')
 from portal_private.game_tags gt join portal_private.tags t on t.id=gt.tag_id where gt.game_id=g;
$$;
create function public.portal_tags() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(t) order by t.category,t.sort_order,t.name),'[]') from portal_private.tags t where is_active;
$$;
revoke all on function public.portal_tags() from public,anon,authenticated;
grant execute on function public.portal_tags() to service_role;

-- Existing inactive links may be retained; they cannot be added to another game.
create function portal_private.valid_tags(ids jsonb,g uuid) returns boolean language plpgsql set search_path='' as $$
begin
 if ids is null or jsonb_typeof(ids) is distinct from 'array' then return false; end if;
 if jsonb_array_length(ids)>8 then return false; end if;
 if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[a-f0-9-]{36}$') then return false; end if;
 if (select count(distinct v) from jsonb_array_elements_text(ids) v)<>jsonb_array_length(ids) then return false; end if;
 return not exists(select 1 from jsonb_array_elements_text(ids) v where not exists(
  select 1 from portal_private.tags t where t.id::text=v and (t.is_active or exists(
   select 1 from portal_private.game_tags gt where gt.game_id=g and gt.tag_id=t.id))));
end $$;
create function portal_private.set_game_tags(g uuid,ids jsonb) returns void language plpgsql set search_path='' as $$
begin
 delete from portal_private.game_tags where game_id=g;
 insert into portal_private.game_tags(game_id,tag_id) select g,v::uuid from jsonb_array_elements_text(ids) v;
end $$;

alter function portal_private.submission_view(portal_private.game_submissions,boolean) rename to submission_view_before_tags;
create function portal_private.submission_view(s portal_private.game_submissions,include_storage boolean default false) returns jsonb language sql stable set search_path='' as $$
 select portal_private.submission_view_before_tags(s,include_storage)||jsonb_build_object('tags',portal_private.game_tag_view(s.id));
$$;
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_tags;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare g uuid; result jsonb; s portal_private.game_submissions;
begin
 if action in ('user.submission.create','user.submission.update') and body ? 'tag_ids' then
  if action='user.submission.update' then
   select id into g from portal_private.game_submissions where id=(body->>'submission_id')::uuid and user_id=u.id for update;
   if g is null then return '{"error":"not_found"}'; end if;
  end if;
  -- Serialize tag deactivation with selection validation and insertion.
  perform 1 from portal_private.tags for share;
  if not portal_private.valid_tags(body->'tag_ids',g) then return '{"error":"invalid_tags"}'; end if;
 end if;
 result:=portal_private.submission_action_before_tags(u,action,body);
 if action in ('user.submission.create','user.submission.update') and body ? 'tag_ids' and not result ? 'error' then
  g:=(result->'submission'->>'id')::uuid;
  perform portal_private.set_game_tags(g,body->'tag_ids');
  select * into s from portal_private.game_submissions where id=g;
  return jsonb_build_object('submission',portal_private.submission_view(s));
 end if;
 return result;
end $$;

alter function portal_private.admin_action(portal_private.admin_users,text,jsonb) rename to admin_action_before_tags;
create function portal_private.admin_action(a portal_private.admin_users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare t portal_private.tags; s portal_private.game_submissions; result jsonb;
begin
 if action='admin.tags' then
  select coalesce(jsonb_agg(to_jsonb(x) order by category,sort_order,name),'[]') into result from
   (select tg.*,(select count(*) from portal_private.game_tags gt where gt.tag_id=tg.id) as game_count from portal_private.tags tg) x;
  return jsonb_build_object('tags',result);
 end if;
 if action in ('admin.tag.create','admin.tag.update') then
  if coalesce(body->>'is_active','') not in ('true','false') or coalesce(body->>'sort_order','') !~ '^-?[0-9]{1,6}$'
   or char_length(btrim(coalesce(body->>'name',''))) not between 1 and 40
   or char_length(btrim(coalesce(body->>'category',''))) not between 1 and 40
   or coalesce(body->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(body->>'slug')>80 then return '{"error":"invalid_tag"}'; end if;
  if exists(select 1 from portal_private.tags where slug=body->>'slug' and (action='admin.tag.create' or id::text<>body->>'tag_id')) then return '{"error":"tag_conflict"}'; end if;
  if action='admin.tag.create' then
   insert into portal_private.tags(name,slug,category,sort_order,is_active) values(btrim(body->>'name'),body->>'slug',btrim(body->>'category'),(body->>'sort_order')::integer,(body->>'is_active')::boolean) returning * into t;
  else
   update portal_private.tags set name=btrim(body->>'name'),slug=body->>'slug',category=btrim(body->>'category'),sort_order=(body->>'sort_order')::integer,is_active=(body->>'is_active')::boolean where id=(body->>'tag_id')::uuid returning * into t;
   if t.id is null then return '{"error":"not_found"}'; end if;
  end if;
  insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata) values(a.id,action,t.id,to_jsonb(t));
  return jsonb_build_object('tag',to_jsonb(t));
 end if;
 if action='admin.submission.tags' then
  select * into s from portal_private.game_submissions where id=(body->>'submission_id')::uuid and visibility<>'draft' for update;
  if s.id is null then return '{"error":"not_found"}'; end if;
  perform 1 from portal_private.tags for share;
  if not body ? 'tag_ids' or not portal_private.valid_tags(body->'tag_ids',s.id) then return '{"error":"invalid_tags"}'; end if;
  perform portal_private.set_game_tags(s.id,body->'tag_ids');
  update portal_private.game_submissions set updated_at=now() where id=s.id returning * into s;
  insert into portal_private.admin_audit_log(admin_id,action,target_id,metadata) values(a.id,action,s.id,jsonb_build_object('tag_ids',body->'tag_ids'));
  return jsonb_build_object('submission',portal_private.submission_view(s));
 end if;
 return portal_private.admin_action_before_tags(a,action,body);
end $$;

alter function public.portal_catalog() rename to portal_catalog_before_tags;
create function public.portal_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(v||jsonb_build_object('tags',portal_private.game_tag_view(s.id)) order by ord),'[]')
 from jsonb_array_elements(public.portal_catalog_before_tags()) with ordinality x(v,ord)
 join portal_private.game_submissions s on s.public_slug=v->>'slug';
$$;
alter function public.portal_public_game(text) rename to portal_public_game_before_tags;
create function public.portal_public_game(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select public.portal_public_game_before_tags(p_slug)||jsonb_build_object('tags',portal_private.game_tag_view(s.id))
 from portal_private.game_submissions s where s.public_slug=p_slug;
$$;
revoke all on function public.portal_catalog_before_tags(),public.portal_public_game_before_tags(text) from public,anon,authenticated,service_role;
revoke all on function public.portal_catalog(),public.portal_public_game(text) from public,anon,authenticated;
grant execute on function public.portal_catalog(),public.portal_public_game(text) to service_role;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
-- Repeatable: retain administrator edits and inactive states.
insert into portal_private.tags(id,name,slug,category,sort_order) values
('6b61c4a0-1204-4000-8000-000000000001','アクション','action','ジャンル',0),
('6b61c4a0-1204-4000-8000-000000000002','アドベンチャー','adventure','ジャンル',1),
('6b61c4a0-1204-4000-8000-000000000003','RPG','rpg','ジャンル',2),
('6b61c4a0-1204-4000-8000-000000000004','シューティング','shooting','ジャンル',3),
('6b61c4a0-1204-4000-8000-000000000005','FPS','fps','ジャンル',4),
('6b61c4a0-1204-4000-8000-000000000006','TPS','tps','ジャンル',5),
('6b61c4a0-1204-4000-8000-000000000007','レース','racing','ジャンル',6),
('6b61c4a0-1204-4000-8000-000000000008','パズル','puzzle','ジャンル',7),
('6b61c4a0-1204-4000-8000-000000000009','リズム','rhythm','ジャンル',8),
('6b61c4a0-1204-4000-8000-00000000000a','スポーツ','sports','ジャンル',9),
('6b61c4a0-1204-4000-8000-00000000000b','シミュレーション','simulation','ジャンル',10),
('6b61c4a0-1204-4000-8000-00000000000c','ストラテジー','strategy','ジャンル',11),
('6b61c4a0-1204-4000-8000-00000000000d','ホラー','horror','ジャンル',12),
('6b61c4a0-1204-4000-8000-00000000000e','脱出ゲーム','escape','ジャンル',13),
('6b61c4a0-1204-4000-8000-00000000000f','プラットフォーマー','platformer','ジャンル',14),
('6b61c4a0-1204-4000-8000-000000000010','ミニゲーム','minigame','ジャンル',15),
('6b61c4a0-1204-4000-8000-000000000011','サンドボックス','sandbox','ジャンル',16),
('6b61c4a0-1204-4000-8000-000000000012','教育','education','ジャンル',17),
('6b61c4a0-1204-4000-8000-000000000013','その他','genre-other','ジャンル',18),
('6b61c4a0-1204-4000-8000-000000000014','1人用','single-player','プレイ形式',0),
('6b61c4a0-1204-4000-8000-000000000015','2人用','two-player','プレイ形式',1),
('6b61c4a0-1204-4000-8000-000000000016','複数人','multiplayer','プレイ形式',2),
('6b61c4a0-1204-4000-8000-000000000017','対戦','versus','プレイ形式',3),
('6b61c4a0-1204-4000-8000-000000000018','協力','co-op','プレイ形式',4),
('6b61c4a0-1204-4000-8000-000000000019','PvP','pvp','プレイ形式',5),
('6b61c4a0-1204-4000-8000-00000000001a','PvE','pve','プレイ形式',6),
('6b61c4a0-1204-4000-8000-00000000001b','ターン制','turn-based','プレイ形式',7),
('6b61c4a0-1204-4000-8000-00000000001c','リアルタイム','real-time','プレイ形式',8),
('6b61c4a0-1204-4000-8000-00000000001d','2D','2d','画面・視点',0),
('6b61c4a0-1204-4000-8000-00000000001e','2.5D','2-5d','画面・視点',1),
('6b61c4a0-1204-4000-8000-00000000001f','3D','3d','画面・視点',2),
('6b61c4a0-1204-4000-8000-000000000020','一人称','first-person','画面・視点',3),
('6b61c4a0-1204-4000-8000-000000000021','三人称','third-person','画面・視点',4),
('6b61c4a0-1204-4000-8000-000000000022','見下ろし','top-down','画面・視点',5),
('6b61c4a0-1204-4000-8000-000000000023','横スクロール','side-scrolling','画面・視点',6),
('6b61c4a0-1204-4000-8000-000000000024','縦スクロール','vertical-scrolling','画面・視点',7),
('6b61c4a0-1204-4000-8000-000000000025','キーボード','keyboard','操作',0),
('6b61c4a0-1204-4000-8000-000000000026','マウス','mouse','操作',1),
('6b61c4a0-1204-4000-8000-000000000027','ゲームパッド','gamepad','操作',2),
('6b61c4a0-1204-4000-8000-000000000028','タッチ操作','touch','操作',3),
('6b61c4a0-1204-4000-8000-000000000029','スコアアタック','score-attack','ゲームの特徴',0),
('6b61c4a0-1204-4000-8000-00000000002a','タイムアタック','time-attack','ゲームの特徴',1),
('6b61c4a0-1204-4000-8000-00000000002b','ステージ制','stages','ゲームの特徴',2),
('6b61c4a0-1204-4000-8000-00000000002c','エンドレス','endless','ゲームの特徴',3),
('6b61c4a0-1204-4000-8000-00000000002d','探索','exploration','ゲームの特徴',4),
('6b61c4a0-1204-4000-8000-00000000002e','収集','collection','ゲームの特徴',5),
('6b61c4a0-1204-4000-8000-00000000002f','育成','raising','ゲームの特徴',6),
('6b61c4a0-1204-4000-8000-000000000030','クラフト','crafting','ゲームの特徴',7),
('6b61c4a0-1204-4000-8000-000000000031','建築','building','ゲームの特徴',8),
('6b61c4a0-1204-4000-8000-000000000032','謎解き','riddles','ゲームの特徴',9),
('6b61c4a0-1204-4000-8000-000000000033','ボス戦','boss-battles','ゲームの特徴',10),
('6b61c4a0-1204-4000-8000-000000000034','ランダム生成','procedural','ゲームの特徴',11),
('6b61c4a0-1204-4000-8000-000000000035','物理演算','physics','ゲームの特徴',12),
('6b61c4a0-1204-4000-8000-000000000036','高難易度','hard','ゲームの特徴',13),
('6b61c4a0-1204-4000-8000-000000000037','カジュアル','casual','ゲームの特徴',14),
('6b61c4a0-1204-4000-8000-000000000038','短時間プレイ','short-play','ゲームの特徴',15),
('6b61c4a0-1204-4000-8000-000000000039','かわいい','cute','雰囲気・デザイン',0),
('6b61c4a0-1204-4000-8000-00000000003a','かっこいい','cool','雰囲気・デザイン',1),
('6b61c4a0-1204-4000-8000-00000000003b','シンプル','simple','雰囲気・デザイン',2),
('6b61c4a0-1204-4000-8000-00000000003c','コメディ','comedy','雰囲気・デザイン',3),
('6b61c4a0-1204-4000-8000-00000000003d','ダーク','dark','雰囲気・デザイン',4),
('6b61c4a0-1204-4000-8000-00000000003e','ファンタジー','fantasy','雰囲気・デザイン',5),
('6b61c4a0-1204-4000-8000-00000000003f','SF','sci-fi','雰囲気・デザイン',6),
('6b61c4a0-1204-4000-8000-000000000040','和風','japanese','雰囲気・デザイン',7),
('6b61c4a0-1204-4000-8000-000000000041','近未来','near-future','雰囲気・デザイン',8),
('6b61c4a0-1204-4000-8000-000000000042','レトロ','retro','雰囲気・デザイン',9),
('6b61c4a0-1204-4000-8000-000000000043','ピクセルアート','pixel-art','雰囲気・デザイン',10),
('6b61c4a0-1204-4000-8000-000000000044','Godot','godot','開発環境',0),
('6b61c4a0-1204-4000-8000-000000000045','Scratch','scratch','開発環境',1),
('6b61c4a0-1204-4000-8000-000000000046','TurboWarp','turbowarp','開発環境',2),
('6b61c4a0-1204-4000-8000-000000000047','Unity','unity','開発環境',3),
('6b61c4a0-1204-4000-8000-000000000048','その他','engine-other','開発環境',4),
('6b61c4a0-1204-4000-8000-000000000049','PC向け','pc','対応環境',0),
('6b61c4a0-1204-4000-8000-00000000004a','スマホ対応','mobile','対応環境',1),
('6b61c4a0-1204-4000-8000-00000000004b','タブレット対応','tablet','対応環境',2),
('6b61c4a0-1204-4000-8000-00000000004c','フルスクリーン対応','fullscreen','対応環境',3),
('6b61c4a0-1204-4000-8000-00000000004d','オフライン対応','offline','対応環境',4)
on conflict do nothing;

commit;
