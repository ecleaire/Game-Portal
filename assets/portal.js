import { config } from './config.js';

const root = document.querySelector('#portal');
const message = document.querySelector('#message');
const adminMode = document.body.dataset.page === 'admin';
// Tokens live only in this document. Existing games share the Pages origin, so never
// put privileged credentials in localStorage/sessionStorage or a readable cookie.
let session = null;
let selected = null;
let offset = 0;
let auditBefore;
let busy = false;
const errors = {
  invalid_credentials: 'ユーザー名またはパスワードを確認してください。',
  unauthorized: 'セッションが終了しました。再度ログインしてください。',
  forbidden: 'この操作を行う権限がありません。',
  rate_limited: '試行回数の上限です。15分後に再試行してください。',
  conflict: 'そのユーザー名は使用されています。',
  invalid_request: '入力を確認してください。ユーザー名は英数字・_ の3〜32文字、パスワードは12文字以上・UTF-8で72バイト以内です。',
  password_limit: '代替パスワードは最大5件です。',
  not_found: '対象が見つかりません。画面を更新してください。',
  unavailable: 'サーバーに接続できません。設定を確認し、しばらくして再試行してください。',
};
function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function notice(text) { message.textContent = text; }
async function run(task) {
  if (busy) return;
  busy = true;
  notice('処理中…');
  root.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await task(); }
  catch (error) { notice(errors[error.message] ?? '通信または処理に失敗しました。'); }
  finally { busy = false; root.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
}
async function api(action, data = {}) {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal`, {
    method: 'POST', cache: 'no-store', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}),
      ...(session ? { 'X-Portal-Session': session.token } : {}) },
    body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    if (response.status === 401) { session = null; login(); }
    throw new Error(result.error ?? 'unavailable');
  }
  return result;
}
function button(parent, text, task, danger = false) {
  const b = el('button', text, { type: 'button' });
  if (danger) b.className = 'danger';
  b.addEventListener('click', () => run(task)); parent.append(b); return b;
}
function section(title, parent = root) {
  const s = el('section', null); s.append(el('h2', title)); parent.append(s); return s;
}
function field(name, title, type = 'text', options = {}) { return { name, title, type, ...options }; }
const username = () => field('username', 'ユーザー名', 'text', { autocomplete: 'username', pattern: '[A-Za-z0-9_]{3,32}', maxlength: '32' });
const password = (name = 'password', title = 'パスワード', fresh = true) => field(name, title, 'password', {
  autocomplete: fresh ? 'new-password' : 'current-password', ...(fresh ? { minlength: '12' } : {}), maxlength: '72',
});
const role = () => field('role', 'ユーザー権限', 'select', { choices: [['player', '一般ユーザー'], ['uploader', '投稿可能ユーザー']] });
function form(parent, fields, submitText, submit) {
  const f = el('form', null);
  for (const { name, title, type, choices, optional, value, ...attrs } of fields) {
    const label = el('label', title);
    const input = type === 'select' ? el('select', null, { name }) : el('input', null, { name, type, ...attrs });
    if (choices) for (const [key, title] of choices) input.append(el('option', title, { value: key }));
    if (!optional) input.required = true;
    if (value !== undefined) input.value = value;
    label.append(input); f.append(label);
  }
  f.append(el('button', submitText, { type: 'submit' }));
  f.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(f));
    // Remove plaintext from input controls immediately, including failed requests.
    f.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; });
    run(() => submit(data));
  });
  parent.append(f); return f;
}
function login() {
  root.replaceChildren();
  const s = section(adminMode ? '管理者ログイン' : 'ユーザーログイン');
  s.append(el('p', 'アカウントは管理者が作成します。メールアドレスは不要です。', { class: 'muted' }));
  s.append(el('p', '安全のためログイン状態はこの画面内だけで保持します。再読み込み・別ページへの移動後は再ログインしてください。', { class: 'muted' }));
  form(s, [username(), password('password', 'パスワード', false)], 'ログイン', async data => {
    session = await api(adminMode ? 'admin.login' : 'user.login', data);
    if (adminMode) { offset = 0; selected = null; await dashboard(); } else await account();
    notice('ログインしました。');
  });
}
function logoutButton(parent) {
  button(parent, 'ログアウト', async () => {
    try { await api('logout'); }
    finally { session = null; login(); notice('ログアウトしました。'); }
  });
}
async function account() {
  const { user } = await api('user.me');
  root.replaceChildren();
  const s = section('アカウント');
  s.append(el('p', `${user.username} / ${user.role} / ${user.status}`));
  logoutButton(s);
  form(s, [{ ...username(), value: user.username }], 'ユーザー名を変更', async data => {
    await api('user.rename', data); await account(); notice('ユーザー名を変更しました。');
  });
  form(s, [password('current_password', '現在の本人用パスワード', false), password('password', '新しい本人用パスワード')], 'パスワードを変更', async data => {
    await api('user.password', data); session = null; login(); notice('パスワードを変更しました。再ログインしてください。');
  });
  section('投稿したゲーム').append(el('p', 'ゲーム投稿・審査機能はPhase 3で提供予定です。現在は投稿を受け付けていません。', { class: 'muted' }));
}
async function dashboard() {
  const [{ admin }, { users }] = await Promise.all([api('admin.me'), api('admin.users', { offset })]);
  root.replaceChildren();
  const top = section(`管理画面 — ${admin.username}`);
  logoutButton(top);
  const create = section('ユーザー作成');
  form(create, [username(), password('password', '初期の本人用パスワード'), role()], '作成', async data => {
    await api('admin.create', data); await dashboard(); notice('ユーザーを作成しました。');
  });
  const list = section('ユーザー一覧');
  list.append(el('p', `${offset + 1}件目から表示（最大100件）`, { class: 'muted' }));
  if (!users.length) list.append(el('p', 'ユーザーがいません。'));
  for (const user of users) {
    const row = el('div', null, { class: 'row' });
    row.append(el('p', `${user.username} / ${user.role} / ${user.status}${user.banned ? ' / BAN中' : ''}`));
    button(row, '管理', async () => { selected = user.id; await dashboard(); notice('対象ユーザーを選択しました。'); document.querySelector('#selected-user')?.scrollIntoView(); });
    list.append(row);
  }
  const pages = el('div', null, { class: 'actions' });
  if (offset > 0) button(pages, '前の100件', async () => { offset = Math.max(0, offset - 100); await dashboard(); notice('一覧を更新しました。'); });
  if (users.length === 100) button(pages, '次の100件', async () => { offset += 100; await dashboard(); notice('一覧を更新しました。'); });
  button(pages, '更新', async () => { await dashboard(); notice('更新しました。'); }); list.append(pages);
  const user = users.find(u => u.id === selected);
  if (user) await manage(user);
  const audit = section('管理操作の監査ログ');
  button(audit, '最新の100件', async () => { auditBefore = undefined; await showAudit(audit); notice('監査ログを表示しました。'); });
}
async function manage(user) {
  const s = section(`${user.username} の管理`); s.id = 'selected-user';
  s.append(el('p', `状態: ${user.status} / BAN: ${user.banned ? user.banned_until ?? '永久' : 'なし'}`));
  if (user.ban_reason) s.append(el('p', `理由: ${user.ban_reason}`));
  const change = async (action, data = {}) => {
    await api(action, { ...data, user_id: user.id }); await dashboard(); notice('変更を保存しました。');
  };
  form(s, [{ ...username(), value: user.username }], '名前を変更', data => change('admin.rename', data));
  form(s, [{ ...role(), value: user.role }], '権限を変更', data => change('admin.role', data));
  const actions = el('div', null, { class: 'actions' }); s.append(actions);
  button(actions, 'KICK（全端末をログアウト）', async () => {
    if (confirm(`${user.username} の全セッションを失効させますか？再ログインは可能です。`)) await change('admin.kick'); else notice('キャンセルしました。');
  }, true);
  button(actions, user.status === 'disabled' ? 'アカウントを再有効化' : 'アカウントを無効化', async () => {
    if (confirm(`${user.username} のアカウント状態を変更しますか？無効化すると全セッションが失効します。`)) await change(user.status === 'disabled' ? 'admin.enable' : 'admin.disable'); else notice('キャンセルしました。');
  }, true);
  if (user.banned) button(actions, 'BANを解除', () => change('admin.unban'));
  s.append(el('h3', 'BAN')); s.append(el('p', '期限が空欄なら永久BANです。BAN時は全セッションが失効します。', { class: 'muted' }));
  form(s, [field('banned_until', '期限（端末のローカル時刻・省略で永久）', 'datetime-local', { optional: true }), field('reason', '理由', 'text', { maxlength: '500', optional: true })], 'BANする', async data => {
    if (!confirm(`${user.username} を${data.banned_until ? '期限付き' : '永久'}BANしますか？`)) { notice('キャンセルしました。'); return; }
    await change('admin.ban', { ...data, banned_until: data.banned_until ? new Date(data.banned_until).toISOString() : null });
  });
  s.append(el('h3', '管理者追加の代替パスワード'));
  s.append(el('p', '最大5件。ラベルにはパスワードを記入しないでください。本人用パスワードはここから変更できません。', { class: 'muted' }));
  const { passwords } = await api('admin.passwords', { user_id: user.id });
  for (const p of passwords) {
    const row = el('div', null, { class: 'row' }); row.append(el('p', `${p.label || 'ラベルなし'} / ${p.created_at}`));
    button(row, '削除・失効', async () => {
      if (confirm('この代替パスワードと、それによるセッションを失効させますか？')) await change('admin.password.revoke', { password_id: p.id }); else notice('キャンセルしました。');
    }, true); s.append(row);
  }
  form(s, [field('label', 'ラベル（秘密情報を入力しない）', 'text', { maxlength: '80', optional: true }), password()], '代替パスワードを追加', data => change('admin.password.add', data));
}
async function showAudit(parent) {
  const { events } = await api('admin.audit', auditBefore ? { before_id: auditBefore } : {});
  parent.querySelector('.audit-results')?.remove();
  const results = el('div', null, { class: 'audit-results' });
  if (!events.length) results.append(el('p', 'ログがありません。'));
  for (const event of events) results.append(el('pre', `${event.created_at} ${event.action}\n管理者: ${event.admin_id}\n対象: ${event.target_id}\n${JSON.stringify(event.metadata)}`, { class: 'row' }));
  if (events.length === 100) button(results, '過去の100件', async () => { auditBefore = events.at(-1).id; await showAudit(parent); notice('過去の監査ログを表示しました。'); });
  parent.append(results);
}

if (document.body.dataset.page === 'upload') {
  section('ゲーム投稿').append(el('p', '投稿機能は準備中です。Phase 3で認証・投稿権限を確認するバックエンド経由でZIPを保管します。Google Driveは公開ゲームのホスティングには使用しません。'));
} else if (!config.supabaseUrl) {
  section('認証サービスは未設定です').append(el('p', '管理者がSupabaseの設定を完了すると利用できます。公開済みゲームは引き続き遊べます。'));
} else login();

// A failed/expired session stops account/admin actions; KICK is noticed while idle too.
setInterval(async () => {
  if (!session || busy || document.hidden) return;
  try { await api(adminMode ? 'admin.me' : 'user.me'); }
  catch (error) { notice(errors[error.message] ?? 'セッション確認に失敗しました。'); }
}, 60000);
window.addEventListener('pagehide', () => { session = null; root.replaceChildren(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
