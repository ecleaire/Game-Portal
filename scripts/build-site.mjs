import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { brand } from '../assets/brand.js';

// Allowlist the publishable tree. Backend code, tests and env files never enter Pages.
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist');
await mkdir(out, { recursive: true });
// Fail on stale output rather than risk publishing leftovers from a previous build.
if ((await readdir(out)).length) throw new Error('dist must be empty. Remove only dist/ before rebuilding.');
for (const entry of ['index.html', 'game.html', 'games.json', 'assets', 'games', 'login', 'account', 'admin', 'upload', 'faq', 'terms', 'privacy', 'library', 'profile', 'rights']) {
  await cp(join(root, entry), join(out, entry), {
    recursive: true,
    filter: source => !/(^|[\\/])\.[^\\/]+/.test(source.slice(root.length)) && !source.endsWith('config.local.js'),
  });
}
if (![brand.name,brand.eyebrow].every(value=>typeof value==='string'&&value.trim()&&value.length<=80&&!/[\r\n]/.test(value))) throw new Error('Invalid public brand configuration');
const escapeHtml = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const renamed=brand.name!=='GAME PORTAL'||brand.eyebrow!=='MY GAME LIBRARY';
const brandRevision=createHash('sha256').update(JSON.stringify(brand)).digest('hex').slice(0,12);
const freshBrandAssets=text=>renamed?text.replace(/\?v=([\da-z]+)/g,`?v=$1-${brandRevision}`):text;
// Brand static pages at build time, including titles, footer and accessibility text.
// Game exports and internal identifiers are never renamed.
for (const page of ['index.html','game.html',...['login','account','admin','upload','faq','terms','privacy','library','profile','rights'].map(route=>`${route}/index.html`)]) {
  const path=join(out,page);const html=await readFile(path,'utf8');
  await writeFile(path,freshBrandAssets(html.replaceAll('GAME PORTAL',escapeHtml(brand.name)).replaceAll('MY GAME LIBRARY',escapeHtml(brand.eyebrow))));
}
if(renamed)for(const name of await readdir(join(out,'assets')))if(name.endsWith('.js')) {
  const path=join(out,'assets',name);await writeFile(path,freshBrandAssets(await readFile(path,'utf8')));
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
