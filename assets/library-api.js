import { config } from './config.js';
import { userSessionKey, adminSessionKey } from './navigation.js?v=20261009b';
export const currentSession = () => sessionStorage.getItem(userSessionKey) || sessionStorage.getItem(adminSessionKey);
export async function social(action, data = {}) {
  if (!config.supabaseUrl) throw new Error('unavailable');
  const session = currentSession();
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal`, {
    method: 'POST', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}), ...(session ? { 'X-Portal-Session': session } : {}) },
    body: JSON.stringify({ action, data }),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || 'unavailable');
  return result;
}
export function node(tag, text = '', attributes = {}) {
  const element = document.createElement(tag); element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
export function errorText(error) {
  return ({ unauthorized: 'ログインし直してください。', not_found: '対象が見つからないか、閲覧権限がありません。',
    limit_reached: '保存できる上限に達しました。不要な項目を削除してください。', conflict: '別の画面で変更されています。ページを更新してください。',
    invalid_request: '入力内容を確認してください。', forbidden: 'この操作は許可されていません。' })[error.message] || '接続できませんでした。しばらくして再試行してください。';
}
export function gameLink(game, root = '../') {
  return node('a', game.title, { href: game.own_preview_id ? `${root}account/?game=${encodeURIComponent(game.own_preview_id)}` : `${root}game.html?slug=${encodeURIComponent(game.slug)}`, class: 'library-game-link' });
}
