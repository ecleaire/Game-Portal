import { config } from './config.js';

const root = document.querySelector('#portal');
const message = document.querySelector('#message');
const adminMode = document.body.dataset.page === 'admin';
const uploadMode = document.body.dataset.page === 'upload';
const accountMode = document.body.dataset.page === 'account';
// An opaque token survives navigation only within this browser tab. It is always
// verified by the server before a protected action, so KICK/BAN takes effect at once.
// User and administrator sessions intentionally have separate storage keys.
const sessionKey = `game-portal.${adminMode ? 'admin' : 'user'}.session.v1`;
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
  invalid_request: '入力を確認してください。ユーザー名は英数字・_ の3〜32文字、パスワードは5文字以上・UTF-8で72バイト以内です。',
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
function saveSession(next) {
  session = next;
  if (next?.token && /^[a-f0-9]{64}$/.test(next.token)) sessionStorage.setItem(sessionKey, next.token);
  else sessionStorage.removeItem(sessionKey);
}
function clearSession() { saveSession(null); }
function restoreSession() {
  const token = sessionStorage.getItem(sessionKey);
  if (/^[a-f0-9]{64}$/.test(token ?? '')) session = { token };
  else sessionStorage.removeItem(sessionKey);
  return session;
}
function syncLoginLink() {
  document.querySelectorAll('a[data-portal-login], a[href$="/login/"]').forEach(link => {
    link.dataset.portalLogin = 'true';
    if (!link.dataset.loginHref) link.dataset.loginHref = link.href;
    if (session) {
      link.textContent = 'ログアウト';
      link.href = '#logout';
      link.onclick = event => { event.preventDefault(); run(logout); };
    } else {
      link.textContent = 'ログイン';
      link.href = link.dataset.loginHref;
      link.onclick = null;
    }
  });
  document.querySelectorAll('a[data-portal-account], a[href$="/account/"]').forEach(link => {
    if (!link.dataset.accountHref) link.dataset.accountHref = link.href;
    link.hidden = !session;
    link.href = link.dataset.accountHref;
    link.onclick = null;
  });
}
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
    if (response.status === 401) { clearSession(); login(); }
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
  autocomplete: fresh ? 'new-password' : 'current-password', minlength: '5', maxlength: '72',
});
const role = () => field('role', 'ユーザー権限', 'select', { choices: [['player', '一般ユーザー'], ['uploader', '投稿可能ユーザー']] });
const avatars = [
  ['gamepad', '🎮 ゲームパッド'], ['star', '⭐ スター'], ['rocket', '🚀 ロケット'],
  ['puzzle', '🧩 パズル'], ['palette', '🎨 パレット'], ['lightning', '⚡ ライトニング'],
  ['cat', '🐱 ねこ'], ['fox', '🦊 きつね'], ['panda', '🐼 パンダ'],
];
const avatarGlyph = key => ({ gamepad: '🎮', star: '⭐', rocket: '🚀', puzzle: '🧩', palette: '🎨', lightning: '⚡', cat: '🐱', fox: '🦊', panda: '🐼' }[key] ?? '🎮');
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
  syncLoginLink();
  root.replaceChildren();
  const s = section(adminMode ? '管理者ログイン' : 'ユーザーログイン');
  s.append(el('p', 'アカウントは管理者が作成します。メールアドレスは不要です。', { class: 'muted' }));
  s.append(el('p', 'ログイン状態は、このブラウザの同じタブ内でページを切り替えても維持されます。', { class: 'muted' }));
  form(s, [username(), password('password', 'パスワード', false)], 'ログイン', async data => {
    saveSession(await api(adminMode ? 'admin.login' : 'user.login', data));
    syncLoginLink();
    if (adminMode) { offset = 0; selected = null; await dashboard(); } else if (uploadMode) await upload(); else await account();
    notice('ログインしました。');
  });
}
async function logout() {
  try { await api('logout'); }
  finally { clearSession(); syncLoginLink(); login(); notice('ログアウトしました。'); }
}
function logoutButton(parent) {
  button(parent, 'ログアウト', logout);
}
async function account() {
  const { user } = await api('user.me');
  root.replaceChildren();
  const s = section('アカウント');
  const overview = el('div', null, { class: 'account-overview' });
  overview.append(el('span', avatarGlyph(user.avatar_key), { class: 'avatar', 'aria-hidden': 'true' }));
  const details = el('div', null);
  details.append(el('p', user.display_name, { class: 'account-name' }));
  details.append(el('p', `ログイン用ユーザー名: ${user.username}`, { class: 'muted' }));
  details.append(el('p', `権限: ${user.role} / 状態: ${user.status}`, { class: 'muted' }));
  if (user.created_at) details.append(el('p', `登録日: ${new Date(user.created_at).toLocaleDateString('ja-JP')}`, { class: 'muted' }));
  overview.append(details); s.append(overview);
  logoutButton(s);
  const profile = section('プロフィール');
  profile.append(el('p', '表示名とアイコンはゲーム投稿などで表示するための情報です。ログイン用ユーザー名やパスワードとは別に管理されます。', { class: 'muted' }));
  form(profile, [
    field('display_name', '表示名', 'text', { value: user.display_name, maxlength: '40', autocomplete: 'nickname' }),
    field('avatar_key', 'アイコン', 'select', { value: user.avatar_key, choices: avatars }),
  ], 'プロフィールを保存', async data => {
    await api('user.profile', data); await account(); notice('プロフィールを保存しました。');
  });
  const credentials = section('ログイン情報');
  credentials.append(el('p', 'ログイン用ユーザー名を変更すると、次回から新しい名前でログインします。', { class: 'muted' }));
  form(credentials, [{ ...username(), value: user.username, title: 'ログイン用ユーザー名' }], 'ログイン用ユーザー名を変更', async data => {
    await api('user.rename', data); await account(); notice('ユーザー名を変更しました。');
  });
  form(credentials, [password('current_password', '現在の本人用パスワード', false), password('password', '新しい本人用パスワード')], 'パスワードを変更', async data => {
    await api('user.password', data); clearSession(); login(); notice('パスワードを変更しました。再ログインしてください。');
  });
  const submissions = section('投稿したゲーム');
  const result = await api('user.submissions');
  if (!result.submissions.length) submissions.append(el('p', '投稿はまだありません。'));
  for (const game of result.submissions) submissions.append(el('p', `${game.title} / ${game.engine} / ${game.status} / ${game.created_at}`));
}
async function dashboard() {
  const [{ admin }, { users }, { submissions }] = await Promise.all([api('admin.me'), api('admin.users', { offset }), api('admin.submissions', { offset: 0 })]);
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
  const reviews = section('ゲーム投稿の審査');
  if (!submissions.length) reviews.append(el('p', '投稿はありません。'));
  for (const game of submissions) {
    const row = el('div', null, { class: 'row' });
    row.append(el('p', `${game.title} / 投稿者: ${game.username} / ${game.engine} / ${game.version} / ${game.status}`));
    if (game.description) row.append(el('p', game.description, { class: 'muted' }));
    if (game.review_reason) row.append(el('p', `審査メモ: ${game.review_reason}`, { class: 'muted' }));
    button(row, 'ZIPを安全にダウンロード', () => downloadSubmission(game.id));
    if (game.status === 'pending') {
      button(row, '承認（非公開で保管を継続）', () => reviewSubmission(game.id, 'approved'));
      button(row, '却下', async () => {
        const reason = prompt('却下理由（任意・500文字まで）', '');
        if (reason !== null) await reviewSubmission(game.id, 'rejected', reason);
      }, true);
    }
    reviews.append(row);
  }
  const audit = section('管理操作の監査ログ');
  button(audit, '最新の100件', async () => { auditBefore = undefined; await showAudit(audit); notice('監査ログを表示しました。'); });
}
async function manage(user) {
  const s = section(`${user.username} の管理`); s.id = 'selected-user';
  s.append(el('p', `アカウント状態: ${user.status}`, { class: 'muted' }));
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
  const ban = el('div', null, { class: `ban-panel${user.banned ? ' is-banned' : ''}` }); s.append(ban);
  ban.append(el('h3', user.banned ? '現在BAN中' : 'BAN設定'));
  ban.append(el('p', user.banned ? `BAN期限: ${user.banned_until ?? '永久'}${user.ban_reason ? ` / 理由: ${user.ban_reason}` : ''}` : 'BANすると、このユーザーはログインできず、すべてのセッションが直ちに失効します。', { class: 'muted' }));
  if (user.banned) {
    button(ban, 'BANを解除', () => change('admin.unban'));
  } else form(ban, [field('banned_until', '終了日時（空欄は永久BAN）', 'datetime-local', { optional: true }), field('reason', '理由（任意）', 'text', { maxlength: '500', optional: true })], 'BANする', async data => {
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

async function uploadPackage(submission) {
  root.replaceChildren();
  const s = section('ゲームZIPを保管'); logoutButton(s);
  s.append(el('p', `${submission.title} のZIPを選択してください。管理者専用のGoogle Drive保管領域へ送信します。公開されることはありません。`, { class: 'muted' }));
  const f = el('form', null); const label = el('label', 'ゲームZIP（最大50MB）');
  const input = el('input', null, { type: 'file', name: 'package', accept: '.zip,application/zip', required: 'required' });
  label.append(input); f.append(label); f.append(el('button', '非公開で保管', { type: 'submit' }));
  f.addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const file = input.files?.[0]; if (!file) throw new Error('invalid_request');
    const body = new FormData(); body.set('submission_id', submission.id); body.set('package', file);
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal/upload`, { method: 'POST', credentials: 'omit',
      headers: { ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': session.token }, body, signal: AbortSignal.timeout(120000) });
    const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error ?? 'unavailable');
    await upload(); notice('管理者専用の保管領域へ送信しました。審査待ちです。');
  }); });
  root.append(f);
}
async function reviewSubmission(submissionId, decision, reason = '') {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal/review`, { method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': session.token },
    body: JSON.stringify({ submission_id: submissionId, decision, reason }), signal: AbortSignal.timeout(30000) });
  const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error ?? 'unavailable');
  await dashboard(); notice(decision === 'approved' ? '承認しました。公開はまだ行われません。' : '却下しました。');
}
async function downloadSubmission(submissionId) {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal/download`, { method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': session.token },
    body: JSON.stringify({ submission_id: submissionId }), signal: AbortSignal.timeout(60000) });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error ?? 'unavailable'); }
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = el('a', '', { href: url, download: 'submission.zip' });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url); notice('ZIPをダウンロードしました。実行・展開前に隔離環境で確認してください。');
}
async function upload() {
  const { user } = await api('user.me'); root.replaceChildren();
  const s = section('ゲーム投稿'); logoutButton(s);
  if (user.role !== 'uploader') { s.append(el('p', 'このアカウントには投稿権限がありません。管理者に投稿可能ユーザーへの変更を依頼してください。')); return; }
  const steps = el('ol', null, { class: 'steps' });
  for (const text of ['ゲーム情報を入力', '次の画面でZIPを選択', '非公開で保管・管理者の審査を待つ']) steps.append(el('li', text));
  s.append(steps);
  s.append(el('h3', '1. ゲーム情報を入力'));
  s.append(el('p', '上から順番でなくても入力できます。説明と操作説明は任意です。', { class: 'muted' }));
  const submissionForm = form(s, [field('title', 'ゲーム名', 'text', { maxlength: '120' }), field('engine', 'エンジン', 'select', { choices: [['godot','Godot'],['scratch','Scratch / TurboWarp'],['other','その他']] }), field('description', '説明（任意）', 'text', { maxlength: '4000', optional: true }), field('version', 'バージョン', 'text', { value: '1.0.0', maxlength: '80' }), field('controls', '操作説明（任意）', 'text', { maxlength: '2000', optional: true })], 'ZIPを選択する', async data => {
    const { submission } = await api('user.submission.create', data); await uploadPackage(submission);
  });
  submissionForm.classList.add('stacked-form');
  const { submissions } = await api('user.submissions');
  const history = section('投稿履歴');
  if (!submissions.length) history.append(el('p', '投稿はまだありません。'));
  for (const game of submissions) history.append(el('p', `${game.title} / ${game.status} / ${game.created_at}`));
}

async function start() {
  if (!config.supabaseUrl) {
    if (uploadMode) section('投稿サービスは未設定です').append(el('p', '管理者がSupabaseと非公開保管領域を設定すると利用できます。'));
    else section('認証サービスは未設定です').append(el('p', '管理者がSupabaseの設定を完了すると利用できます。公開済みゲームは引き続き遊べます。'));
    return;
  }
  if (!restoreSession()) { login(); return; }
  try {
    if (adminMode) { await api('admin.me'); offset = 0; selected = null; await dashboard(); }
    else { await api('user.me'); if (uploadMode) await upload(); else await account(); }
  } catch (error) {
    clearSession();
    login();
    if (error.message !== 'unauthorized') notice(errors[error.message] ?? 'セッションの復元に失敗しました。');
  }
}
start();



// A failed/expired session stops account/admin actions; KICK is noticed while idle too.
setInterval(async () => {
  if (!session || busy || document.hidden) return;
  try { await api(adminMode ? 'admin.me' : 'user.me'); }
  catch (error) { notice(errors[error.message] ?? 'セッション確認に失敗しました。'); }
}, 60000);
