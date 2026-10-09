begin;
alter table portal_private.users drop constraint users_avatar_key_check;
alter table portal_private.users add constraint users_avatar_key_check check (avatar_key in (
 'gamepad','star','rocket','puzzle','palette','lightning','cat','fox','panda','dog','rabbit','bear','penguin','owl','frog','turtle','whale','octopus','robot','ghost','dragon','alien','crown','gem','moon','sun','flower','clover','tree','planet','icecream','pizza','ball','dice','headphones','book'));
create or replace function portal_private.avatar_key(p text) returns text language plpgsql immutable set search_path='' as $$
begin
 if p is null or p not in ('gamepad','star','rocket','puzzle','palette','lightning','cat','fox','panda','dog','rabbit','bear','penguin','owl','frog','turtle','whale','octopus','robot','ghost','dragon','alien','crown','gem','moon','sun','flower','clover','tree','planet','icecream','pizza','ball','dice','headphones','book') then
  raise exception 'invalid avatar key' using errcode='22023';
 end if;
 return p;
end $$;
revoke all on function portal_private.avatar_key(text) from public,anon,authenticated,service_role;
commit;
