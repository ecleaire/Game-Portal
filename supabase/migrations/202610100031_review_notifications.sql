begin;
create table portal_private.review_notifications (
 id uuid primary key default extensions.gen_random_uuid(),
 user_id uuid not null references portal_private.users(id) on delete cascade,
 game_id uuid not null references portal_private.game_submissions(id) on delete cascade,
 title text not null, status text not null, reason text,
 created_at timestamptz not null default now(), read_at timestamptz
);
create index review_notifications_owner on portal_private.review_notifications(user_id,created_at desc);
alter table portal_private.review_notifications enable row level security;
revoke all on portal_private.review_notifications from public,anon,authenticated,service_role;
create function portal_private.notify_review() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status in ('approved','rejected','unpublished') and old.status is distinct from new.status
 and new.visibility<>'draft' and (old.status in ('pending','rejected','approved','unpublished') or new.status='unpublished') then
  insert into portal_private.review_notifications(user_id,game_id,title,status,reason)
   values(new.user_id,new.id,new.title,new.status,new.review_reason);
 end if;
 return new;
end $$;
create trigger notify_review after update on portal_private.game_submissions for each row execute function portal_private.notify_review();
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_notifications;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; notices jsonb;
begin
 result:=portal_private.submission_action_before_notifications(u,action,body);
 if result ? 'error' then return result;end if;
 if action='user.submissions' then
  -- The existing authenticated listing is also the inbox. Reading never accepts a user ID.
  if body ? 'read_notification_id' then
   update portal_private.review_notifications set read_at=coalesce(read_at,now())
    where id::text=body->>'read_notification_id' and user_id=u.id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'game_id',game_id,'title',title,'status',status,
   'reason',reason,'created_at',created_at,'read_at',read_at) order by created_at desc,id),'[]') into notices
   from (select * from portal_private.review_notifications where user_id=u.id order by created_at desc,id limit 100) n;
  return result||jsonb_build_object('notifications',notices);
 end if;
 return result;
end $$;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
commit;
