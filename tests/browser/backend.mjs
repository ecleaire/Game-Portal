// TEST ONLY: actual Edge handler + actual SQL, replacing PostgREST transport with PGlite.
// No real credentials, no external connections, no test bypass in production code.
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHandler } from '../../supabase/functions/portal/handler.mjs';

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec('create role anon; create role authenticated; create role service_role;');
const dir = new URL('../../supabase/migrations/', import.meta.url);
for (const name of (await readdir(dir)).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
await db.query('select public.portal_bootstrap($1,$2)', ['browser_owner', 'browser-test-admin-only']);
const imageObjects = new Map();
const handler = createHandler({
  url: 'http://127.0.0.1:54321', serviceKey: 'browser-test-server-only',
  pepper: 'browser-test-only-pepper-not-for-production', allowedOrigins: 'http://127.0.0.1:4173',
  fetcher: async (_url, options) => {
    if (_url.includes('/storage/v1/object/portal-thumbnails')) {
      if (options.method === 'DELETE') { for (const key of JSON.parse(options.body).prefixes) imageObjects.delete(key); return Response.json({}); }
      const key = decodeURIComponent(_url.split('/portal-thumbnails/')[1]);
      if (options.method === 'POST') { imageObjects.set(key, { bytes: options.body, type: options.headers['Content-Type'] }); return Response.json({}); }
      const file = imageObjects.get(key); return file ? new Response(file.bytes, { headers: { 'Content-Type': file.type } }) : new Response(null, { status: 404 });
    }
    const p = JSON.parse(options.body);
    try {
      if (_url.endsWith('/rpc/portal_tags') || _url.endsWith('/rpc/portal_catalog')) {
        const fn = _url.endsWith('/portal_tags') ? 'portal_tags' : 'portal_catalog';
        const { rows } = await db.query(`select public.${fn}() as result`);
        return Response.json(rows[0].result);
      }
      const { rows } = await db.query('select public.portal_api($1,$2::jsonb,$3,$4) as result',
        [p.p_action, JSON.stringify(p.p_body), p.p_token_hash, p.p_new_token_hash]);
      return Response.json(rows[0].result);
    } catch (error) { return Response.json({ code: error.code }, { status: 400 }); }
  },
});
createServer(async (req, res) => {
  if (req.url === '/health') { res.writeHead(200).end('ready'); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const response = await handler(new Request(`http://127.0.0.1:54321${req.url}`, {
    method: req.method, headers: req.headers,
    ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
  }));
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
}).listen(54321, '127.0.0.1', () => console.log('Test database ready'));
