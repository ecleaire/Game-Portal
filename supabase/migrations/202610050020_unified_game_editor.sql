begin;
alter function portal_private.submission_action(portal_private.users,text,jsonb) rename to submission_action_before_editor_save;
create function portal_private.submission_action(u portal_private.users,action text,body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
 if action<>'user.submission.save' then return portal_private.submission_action_before_editor_save(u,action,body);end if;
 -- Both operations run in a subtransaction. Validation failures must not leave
 -- updated metadata, tags, or sharing permissions partially saved.
 begin
  result:=portal_private.submission_action_before_editor_save(u,'user.submission.update',body);
  if result ? 'error' then raise exception using errcode='P0002',message='editor_validation';end if;
  result:=portal_private.submission_action_before_editor_save(u,'user.submission.visibility',body);
  if result ? 'error' then raise exception using errcode='P0002',message='editor_validation';end if;
  return result;
 exception when sqlstate 'P0002' then return result;
 end;
end $$;
revoke all on all functions in schema portal_private from public,anon,authenticated,service_role;
commit;
