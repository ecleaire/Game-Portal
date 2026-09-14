import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Pages artifact preserves games and excludes backend, local config and secrets', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'portal-build-test-'));
  try {
    const root = new URL('../', import.meta.url);
    for (const entry of ['scripts', 'index.html', 'game.html', 'games.json', 'games', 'assets', 'login', 'account', 'admin', 'upload']) {
      await cp(new URL(entry, root), join(temp, entry), { recursive: true });
    }
    await writeFile(join(temp, '.env'), 'NOT_A_REAL_SECRET=must-not-publish');
    await writeFile(join(temp, 'assets/config.local.js'), 'must-not-publish');
    await writeFile(join(temp, 'assets/.env'), 'must-not-publish');
    const env = { ...process.env, SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: 'must-not-publish' };
    const build = () => spawnSync(process.execPath, ['scripts/build-site.mjs'], { cwd: temp, env, encoding: 'utf8' });
    assert.equal(build().status, 0);
    const entries = await readdir(join(temp, 'dist'));
    assert.ok(!entries.includes('scripts')); assert.ok(!entries.includes('.env'));
    assert.ok(!(await readdir(join(temp, 'dist/assets'))).some(n => n === '.env' || n === 'config.local.js'));
    assert.ok(!(await readFile(join(temp, 'dist/assets/config.js'), 'utf8')).includes('must-not-publish'));
    const games = JSON.parse(await readFile(join(temp, 'dist/games.json'), 'utf8'));
    for (const game of games) {
      assert.deepEqual(await readFile(join(temp, 'dist', game.path)), await readFile(new URL(game.path, root)));
    }
    assert.deepEqual(await readFile(join(temp, 'dist/game.html')), await readFile(new URL('game.html', root)));
    assert.notEqual(build().status, 0, 'stale output must fail closed');
    // This is a newly created, OS temporary fixture owned by this test.
    await rm(join(temp, 'dist'), { recursive: true });
    env.SUPABASE_ANON_KEY = `test.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.test`;
    assert.notEqual(build().status, 0, 'service role key must not publish');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
