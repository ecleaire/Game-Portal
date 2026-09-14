import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Allowlist the publishable tree. Backend code, tests and env files never enter Pages.
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist');
await mkdir(out, { recursive: true });
// Fail on stale output rather than risk publishing leftovers from a previous build.
if ((await readdir(out)).length) throw new Error('dist must be empty. Remove only dist/ before rebuilding.');
for (const entry of ['index.html', 'game.html', 'games.json', 'assets', 'games', 'login', 'account', 'admin', 'upload']) {
  await cp(join(root, entry), join(out, entry), {
    recursive: true,
    filter: source => !/(^|[\\/])\.[^\\/]+/.test(source.slice(root.length)) && !source.endsWith('config.local.js'),
  });
}
const supabaseUrl = process.env.SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
if (supabaseUrl) {
  const parsed = new URL(supabaseUrl);
  if (parsed.origin !== supabaseUrl || !(parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) {
    throw new Error('SUPABASE_URL must be an HTTPS origin (or localhost).');
  }
}
if (anonKey) {
  // Only a publishable key or legacy anon JWT is permitted in a public artifact.
  if (!anonKey.startsWith('sb_publishable_')) {
    let claims;
    try { claims = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString()); } catch { /* reject below */ }
    if (claims?.role !== 'anon') throw new Error('SUPABASE_ANON_KEY must be a public anon/publishable key.');
  }
}
await writeFile(join(out, 'assets/config.js'), `export const config = Object.freeze(${JSON.stringify({ supabaseUrl, anonKey })});\n`);
await writeFile(join(out, '.nojekyll'), '');
console.log('Static site built in dist/. Only public configuration was included.');
