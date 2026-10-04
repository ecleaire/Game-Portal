import { config } from './config.js';

export const userSessionKey = 'game-portal.user.session.v1';
export const adminSessionKey = 'game-portal.admin.session.v1';
const valid = token => /^[a-f0-9]{64}$/.test(token ?? '');
let verifiedAdminToken = null;
export function hasAdminSession() {
  return valid(verifiedAdminToken) && verifiedAdminToken === sessionStorage.getItem(adminSessionKey);
}
export function confirmAdminSession(token) {
  verifiedAdminToken = valid(token) ? token : null;
  syncNavigation();
}
export function syncNavigation() {
  const user = valid(sessionStorage.getItem(userSessionKey));
  const admin = hasAdminSession();
  document.querySelectorAll('[data-portal-admin]').forEach(link => { link.hidden = !admin; });
  document.querySelectorAll('[data-portal-account]').forEach(link => { link.hidden = !user; });
  document.querySelectorAll('[data-portal-login]').forEach(link => {
    if (!link.dataset.loginHref) link.dataset.loginHref = link.href;
    link.textContent = user || admin ? 'ログアウト' : 'ログイン';
    link.href = user || admin ? new URL('#logout', link.dataset.loginHref).href : link.dataset.loginHref;
  });
}
async function sessionRequest(action, token) {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal`, {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': token },
    body: JSON.stringify({ action }), signal: AbortSignal.timeout(15000),
  });
  return { response, result: await response.json() };
}
export async function verifyAdminSession() {
  const token = sessionStorage.getItem(adminSessionKey);
  if (!valid(token) || !config.supabaseUrl) { confirmAdminSession(null); return false; }
  try {
    const { response, result } = await sessionRequest('admin.me', token);
    // An obsolete request must not overwrite a newer login or logout.
    if (sessionStorage.getItem(adminSessionKey) !== token) return hasAdminSession();
    if (response.ok && result.admin && ['admin','super_admin'].includes(result.admin.role)) {
      confirmAdminSession(token); return true;
    }
    if (response.status === 401 || response.status === 403) sessionStorage.removeItem(adminSessionKey);
  } catch { /* Fail closed on a network error; keep the token for a later retry. */ }
  if (sessionStorage.getItem(adminSessionKey) === token) confirmAdminSession(null);
  return hasAdminSession();
}
export async function logoutSessions() {
  const tokens = [...new Set([userSessionKey,adminSessionKey].map(key => sessionStorage.getItem(key)).filter(valid))];
  try {
    if (config.supabaseUrl) await Promise.allSettled(tokens.map(token => sessionRequest('logout', token)));
  } finally {
    sessionStorage.removeItem(userSessionKey); sessionStorage.removeItem(adminSessionKey);
    confirmAdminSession(null);
  }
}
syncNavigation();
export const navigationReady = verifyAdminSession();
setInterval(() => { if (!document.hidden) verifyAdminSession(); }, 60000);
window.addEventListener('pageshow', event => { if (event.persisted) { syncNavigation(); verifyAdminSession(); } });
