begin;

-- Lower the product password minimum without weakening bcrypt's byte-limit guard.
create or replace function portal_private.password_hash(p text) returns text
language plpgsql set search_path = '' as $$
begin
  if p is null or length(p) < 5 or octet_length(p) > 72 then
    raise exception 'password must be at least 5 characters and at most 72 UTF-8 bytes' using errcode = '22023';
  end if;
  return extensions.crypt(p, extensions.gen_salt('bf', 12));
end $$;

commit;
