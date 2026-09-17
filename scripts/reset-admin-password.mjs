const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_USERNAME', 'ADMIN_RESET_PASSWORD'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);

const username = process.env.ADMIN_USERNAME.trim().toLowerCase();
const password = process.env.ADMIN_RESET_PASSWORD;
if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new Error('ADMIN_USERNAME must be 3-32 lowercase letters, digits, or underscores');
if (password.length < 5 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('ADMIN_RESET_PASSWORD must be 5-72 UTF-8 bytes');

const endpoint = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/portal_reset_admin_password`;
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
  body: JSON.stringify({ p_username: username, p_password: password }),
});
if (!response.ok) throw new Error(`Password reset failed (${response.status})`);
console.log('Administrator password reset completed. All administrator sessions were revoked.');
