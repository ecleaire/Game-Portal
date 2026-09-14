// Node 22+. Load credentials from an ignored, permission-restricted env file.
// Do not use command-line arguments, SQL editor literals, or debug logging for secrets.
const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key,
  INITIAL_ADMIN_USERNAME: username, INITIAL_ADMIN_PASSWORD: password } = process.env;
if (!url || !key || !username || !password) {
  console.error('Required environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD');
  process.exit(1);
}
if (!url.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
  console.error('Use HTTPS, or localhost for development.'); process.exit(1);
}
try {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/portal_bootstrap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ p_username: username, p_password: password }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('setup failed');
  console.log('Initial super admin created. Remove the bootstrap password from your local environment/file.');
} catch {
  console.error('Setup failed. Check the migrations, server-only environment and whether an administrator already exists.');
  process.exitCode = 1;
}
