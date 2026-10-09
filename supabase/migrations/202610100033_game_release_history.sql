begin;
alter table portal_private.game_submissions add column release_notes text not null default '' check(char_length(release_notes)<=2000);
create trigger moderate_release_notes before insert or update on portal_private.game_submissions for each row execute function portal_private.moderate_fields('release_notes');
create table portal_private.game_releases (
 game_id uuid not null references portal_private.game_submissions(id) on delete cascade,
 version text not null, notes text not null default '', released_at timestamptz not null default now(),
 primary key(game_id,version)
);
alter table portal_private.game_releases enable row level security;
revoke all on portal_private.game_releases from public,anon,authenticated,service_role;
create function portal_private.record_release() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='approved' and new.package_storage_key is not null and new.visibility<>'draft' then
  insert into portal_private.game_releases(game_id,version,notes) values(new.id,new.version,new.release_notes)
   on conflict(game_id,version) do update set notes=excluded.notes;
 end if;
 return new;
end $$;
create trigger record_release after insert or update on portal_private.game_submissions for each row execute function portal_private.record_release();
-- Existing approved versions start the history at migration time. This is not a claimed original release date.
insert into portal_private.game_releases(game_id,version,notes)
 select id,version,release_notes from portal_private.game_submissions where status='approved' and visibility<>'draft' and package_storage_key is not null;
create function portal_private.release_history(game uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('version',version,'notes',notes,'released_at',released_at) order by released_at desc,version),'[]')
 from (select * from portal_private.game_releases where game_id=game order by released_at desc,version limit 100) r;
$$;
alter function portal_private.submission_view(portal_private.game_submissions,boolean) rename to submission_view_before_releases;
create function portal_private.submission_view(s portal_private.game_submissions,include_storage boolean default false) returns jsonb language sql stable set search_path='' as $$
 select portal_private.submission_view_before_releases(s,include_storage)||jsonb_build_object('release_notes',s.release_notes,'releases',portal_private.release_history(s.id));
$$;
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_releases;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; s portal_private.game_submissions;
begin
 if action not in ('user.submission.create','user.submission.update','user.submission.save') or not body ? 'release_notes' then
  return portal_private.submission_action_before_releases(u,action,body);
 end if;
 if jsonb_typeof(body->'release_notes') is distinct from 'string' or char_length(body->>'release_notes')>2000 then return '{"error":"invalid_request"}';end if;
 result:=portal_private.submission_action_before_releases(u,action,body);
 if result ? 'error' or not result ? 'submission' then return result;end if;
 update portal_private.game_submissions set release_notes=body->>'release_notes'
  where id=(result->'submission'->>'id')::uuid and user_id=u.id returning * into s;
 if s.id is null then return '{"error":"not_found"}';end if;
 return result||jsonb_build_object('submission',portal_private.submission_view(s));
end $$;
alter function public.portal_public_game(text) rename to portal_public_game_before_releases;
create function public.portal_public_game(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when v is null then null else v||jsonb_build_object('releases',portal_private.release_history(s.id)) end
 from public.portal_public_game_before_releases(p_slug) v left join portal_private.game_submissions s on s.public_slug=p_slug;
$$;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
revoke all on function public.portal_public_game_before_releases(text),public.portal_public_game(text) from public,anon,authenticated,service_role;
grant execute on function public.portal_public_game(text) to service_role;
commit;
