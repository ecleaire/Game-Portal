// Valid source metadata for tests focused on existing publication behavior.
// Project-specific tests exercise missing files, binary validation and real HTTP uploads.
export async function attachProjectFixture(db, id, hash) {
  const existing = (await db.query('select project_drive_id from portal_private.game_submissions where id=$1',[id])).rows[0];
  if (existing?.project_drive_id) return;
  const prepared = (await db.query("select public.portal_project_file('prepare',$1::jsonb,$2) result", [JSON.stringify({submission_id:id}),hash])).rows[0].result;
  if (prepared.error) return;
  await db.query("select public.portal_project_file('complete',$1::jsonb,$2)", [JSON.stringify({submission_id:id,
    revision:crypto.randomUUID(),previous_revision:prepared.previous_revision,file_id:`project-${id}`,name:'source.zip',size:'100'}),hash]);
}
