import { config } from './config.js';
import { checkWebGameZip, unpackPrivateZip, privatePreviewDocument } from './private-preview.js?v=20260929a';
import { packageWebFiles } from './zip-upload.js?v=20260929a';
import { sendUpload, uploadWithRecovery } from './upload-request.js?v=20261003a';

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
let submissionOffset = 0;
let auditBefore;
let busy = false;
let formMessage = null;
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
  upload_timeout: '保存完了を確認できませんでした。アカウントの投稿一覧で状態を確認してください。「ZIP未保存」の場合は、同じゲームの編集画面から再送信できます。',
  upload_network: '送信中に接続が途切れました。投稿一覧で保存状態を確認してください。未保存なら、接続を確認して再送信してください。',
  upload_response: 'サーバーから保存結果を受け取れませんでした。投稿一覧で保存状態を確認してください。',
  drive_unavailable: '投稿用のGoogle Driveに接続できません。管理者がGoogle Drive API、サービスアカウント、投稿先フォルダーの共有設定を確認してください。',
  drive_shared_drive_required: 'サービスアカウントではマイドライブへ保存できません。管理者が共有ドライブ、または所有者OAuth認証を設定してください。',
  drive_permission_denied: '投稿保管フォルダーに保存・移動する権限がありません。管理者がGoogle Driveの権限を確認してください。',
  drive_quota_exceeded: 'Google Driveの保存容量が不足しています。管理者が保管先と空き容量を確認してください。',
  drive_reconnect_required: 'Google Driveの所有者認証が失効しています。管理者が認証をやり直してください。',
  invalid_preview: 'ZIP内のHTMLまたはゲームファイルを確認してください。',
  invalid_upload: 'ZIP形式・ファイル構成またはサイズを確認してください（最大50MB）。',
  web_export_required: 'ブラウザーで遊べるHTMLが見つかりません。Godotの「Web」書き出しで生成したHTML・.js・.wasm・.pckをまとめてください。「PCK/ZIP」書き出しだけではプレイできません。',
  invalid_thumbnail: 'サムネイルはPNG・JPEG・WebPの5MB以下を選んでください。',
  storage_unavailable: '公開用の保管先に接続できません。管理者にSupabase Storageの設定確認を依頼してください。',
  preview_unsupported: 'このブラウザーはZIPプレビューに対応していません。ブラウザーを更新してください。',
};
function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function notice(text) { (formMessage?.isConnected ? formMessage : message).textContent = text; }
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
    link.hidden = !session || adminMode;
    link.href = link.dataset.accountHref;
    link.onclick = null;
  });
}
async function run(task, activeForm = null) {
  if (busy) return;
  busy = true;
  formMessage = activeForm?.querySelector('.upload-status') ?? null;
  if (formMessage) message.textContent = '';
  notice('処理中…');
  const controls = [...root.querySelectorAll('button, input, select, textarea')].map(control => [control, control.disabled]);
  controls.forEach(([control]) => { control.disabled = true; });
  activeForm?.setAttribute('aria-busy', 'true');
  try { await task(); }
  catch (error) { notice(errors[error.message] ?? '通信または処理に失敗しました。'); }
  finally {
    busy = false;
    controls.forEach(([control, disabled]) => { control.disabled = disabled; });
    activeForm?.removeAttribute('aria-busy');
  }
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
function section(title, parent = root, className = '') {
  const s = el('section', null); if (className) s.className = className;
  s.append(el('h2', title)); parent.append(s); return s;
}
function field(name, title, type = 'text', options = {}) { return { name, title, type, ...options }; }
const username = () => field('username', 'ユーザー名', 'text', { autocomplete: 'username', pattern: '[A-Za-z0-9_]{3,32}', maxlength: '32' });
const password = (name = 'password', title = 'パスワード', fresh = true) => field(name, title, 'password', {
  autocomplete: fresh ? 'new-password' : 'current-password', minlength: '5', maxlength: '72',
});
const role = (allowTrusted = false) => field('role', 'ユーザー権限', 'select', { choices: [
  ['player', '一般ユーザー'], ['uploader', '投稿可能ユーザー'],
  ...(allowTrusted ? [['trusted_uploader', '信頼済み投稿者（審査省略）']] : []),
] });
const avatars = [
  ['gamepad', '🎮 ゲームパッド'], ['star', '⭐ スター'], ['rocket', '🚀 ロケット'],
  ['puzzle', '🧩 パズル'], ['palette', '🎨 パレット'], ['lightning', '⚡ ライトニング'],
  ['cat', '🐱 ねこ'], ['fox', '🦊 きつね'], ['panda', '🐼 パンダ'],
];
const avatarGlyph = key => ({ gamepad: '🎮', star: '⭐', rocket: '🚀', puzzle: '🧩', palette: '🎨', lightning: '⚡', cat: '🐱', fox: '🦊', panda: '🐼' }[key] ?? '🎮');
const roleLabel = value => ({ player: '一般ユーザー', uploader: '投稿可能ユーザー', trusted_uploader: '信頼済み投稿者' }[value] ?? value);
const accountStatusLabel = value => ({ active: '利用中', disabled: '無効' }[value] ?? value);
function visibilityGuidance(formElement, help) {
  const visibility = formElement.elements.visibility;
  const dateLabel = formElement.elements.published_at?.closest('label');
  const update = () => {
    const draft = visibility.value === 'draft';
    if (dateLabel) {
      dateLabel.hidden = draft;
      formElement.elements.published_at.disabled = draft;
    }
    help.textContent = draft ? '自分だけが閲覧・プレイできます。管理者の審査には送られません。'
      : visibility.value === 'unlisted' ? '承認後、URLを知る人だけが閲覧できます。ゲーム一覧には表示されません。'
        : '承認後、誰でも閲覧でき、サイトのゲーム一覧に表示されます。';
  };
  visibility.addEventListener('change', update); update();
}
function form(parent, fields, submitText, submit) {
  const f = el('form', null);
  for (const { name, title, type, choices, optional, value, ...attrs } of fields) {
    const label = el('label', title);
    const input = type === 'select' ? el('select', null, { name })
      : type === 'textarea' ? el('textarea', null, { name, ...attrs }) : el('input', null, { name, type, ...attrs });
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
    run(() => submit(data), f);
  });
  parent.append(f); return f;
}
function login() {
  syncLoginLink();
  root.replaceChildren();
  const s = section(adminMode ? '管理者ログイン' : 'ユーザーログイン');
  s.append(el('p', adminMode ? '管理者アカウントでログインして、投稿の審査とユーザー管理を行います。'
    : 'ゲームの投稿や、自分の作品の管理にはログインが必要です。', { class: 'muted' }));
  form(s, [username(), password('password', 'パスワード', false)], 'ログイン', async data => {
    saveSession(await api(adminMode ? 'admin.login' : 'user.login', data));
    syncLoginLink();
    if (adminMode) { offset = 0; selected = null; await dashboard(); }
    else if (uploadMode) await upload();
    else if (accountMode) await account();
    else { location.href = '../account/'; return; }
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
  const [{ user }, { submissions }] = await Promise.all([api('user.me'), api('user.submissions')]);
  root.replaceChildren();
  const gameId = new URLSearchParams(location.search).get('game');
  if (gameId) {
    const game = submissions.find(item => item.id === gameId);
    if (game) { submissionEditor(game); return; }
    notice('ゲームが見つかりません。投稿一覧を表示します。');
  }
  const s = section('アカウント', root, 'account-summary');
  const overview = el('div', null, { class: 'account-overview' });
  overview.append(el('span', avatarGlyph(user.avatar_key), { class: 'avatar', 'aria-hidden': 'true' }));
  const details = el('div', null);
  details.append(el('p', user.display_name, { class: 'account-name' }));
  details.append(el('p', `ログイン用ユーザー名: ${user.username}`, { class: 'muted' }));
  details.append(el('p', `権限: ${roleLabel(user.role)} / 状態: ${accountStatusLabel(user.status)}`, { class: 'muted' }));
  if (user.created_at) details.append(el('p', `登録日: ${new Date(user.created_at).toLocaleDateString('ja-JP')}`, { class: 'muted' }));
  overview.append(details); s.append(overview);
  logoutButton(s);
  const gamesSection = section('投稿したゲーム', root, 'account-games');
  const gameActions = el('div', null, { class: 'actions' });
  gameActions.append(el('a', '新しいゲームを投稿する →', { href: '../upload/', class: 'editor-back' }));
  gamesSection.append(gameActions);
  if (!submissions.length) gamesSection.append(el('p', '投稿したゲームはまだありません。上のリンクから最初の作品を投稿できます。', { class: 'muted' }));
  else {
    const list = el('div', null, { class: 'submission-list' });
    for (const game of submissions) submissionCard(list, game);
    gamesSection.append(list);
  }
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
}
function statusBadge(game) {
  const badges = el('div', null, { class: 'badge-row' });
  const status = el('span', statusLabel(game.status), { class: `status-badge${['uploading','pending'].includes(game.status) ? ' is-warning' : ['rejected','unpublished'].includes(game.status) ? ' is-danger' : ''}` });
  badges.append(status, el('span', visibilityLabel(game.visibility), { class: 'visibility-badge' }));
  return badges;
}
function thumbnailOrFallback(parent, game) {
  parent.append(el('div', game.title.slice(0, 2).toUpperCase(), { class: 'summary-fallback', 'aria-hidden': 'true' }));
  if (game.has_thumbnail) showSubmissionThumbnail(parent, game.id, 'user');
}
function submissionCard(parent, game) {
  const card = el('article', null, { class: 'row submission-summary' });
  const art = el('div', null); thumbnailOrFallback(art, game); card.append(art);
  const details = el('div', null);
  details.append(statusBadge(game), el('h3', game.title));
  details.append(el('p', `${game.engine.toUpperCase()} · バージョン ${game.version}`, { class: 'muted' }));
  if (game.status === 'uploading') details.append(el('p', 'ファイルの再送が必要です。', { class: 'muted' }));
  details.append(el('a', '管理・編集する →', { href: `./?game=${encodeURIComponent(game.id)}` }));
  card.append(details); parent.append(card);
}
function submissionEditor(game) {
  const editor = section('投稿したゲームの管理', root, 'submission-editor');
  editor.append(el('a', '← 投稿一覧に戻る', { href: './', class: 'editor-back' }));
  const hero = el('div', null, { class: 'editor-hero' });
  const art = el('div', null); thumbnailOrFallback(art, game);
  const details = el('div', null); details.append(statusBadge(game), el('h2', game.title));
  details.append(el('p', `${game.engine.toUpperCase()} · バージョン ${game.version}`, { class: 'muted' }));
  if (game.status === 'uploading') details.append(el('p', 'ゲームファイルの保存が完了していません。下のフォームから再送できます。', { class: 'muted' }));
  if (game.review_reason) details.append(el('p', `審査メモ: ${game.review_reason}`, { class: 'muted' }));
  if (game.status === 'approved' && game.visibility !== 'draft' && game.published_at && !game.is_published)
    details.append(el('p', `公開予定: ${new Date(game.published_at).toLocaleString('ja-JP')}`, { class: 'muted' }));
  hero.append(art, details); editor.append(hero);
  const quick = el('div', null, { class: 'editor-actions' });
  if (game.is_published) quick.append(el('a', '公開ページを開く・共有する ↗', { href: `../game.html?slug=${encodeURIComponent(game.public_slug)}`, class: 'editor-back' }));
  if (['draft', 'pending', 'approved', 'rejected'].includes(game.status)) button(quick, '自分だけでプレイ', () => previewSubmission(game.id));
  editor.append(quick);
  const grid = el('div', null, { class: 'editor-grid' }); editor.append(grid);
  const editable = ['uploading', 'draft', 'pending', 'rejected', 'approved'].includes(game.status);
  if (editable) {
    const basics = section('基本情報を編集', grid);
    if (game.status === 'approved') basics.append(el('p', '保存すると公開ページの情報にも反映されます。ゲームファイルは変更されません。', { class: 'muted' }));
    form(basics, [
      field('title', 'ゲーム名', 'text', { value: game.title, maxlength: '120' }),
      field('engine', 'エンジン', 'select', { value: game.engine, choices: [['godot','Godot'],['scratch','Scratch / TurboWarp'],['other','その他']] }),
      field('description', '説明（任意）', 'textarea', { value: game.description, maxlength: '4000', rows: '5', optional: true }),
      field('version', 'バージョン', 'text', { value: game.version, maxlength: '80' }),
      field('controls', '操作説明（任意）', 'textarea', { value: game.controls, maxlength: '2000', rows: '3', optional: true }),
    ], game.status === 'rejected' ? '修正して再審査へ' : '変更を保存', async data => {
      await api('user.submission.update', { ...data, submission_id: game.id }); await account(); notice(game.status === 'rejected' ? '修正を再審査へ送りました。' : '投稿情報を更新しました。');
    }).classList.add('stacked-form');
  } else {
    const basics = section('基本情報', grid);
    basics.append(el('p', game.description || '説明はありません。', { class: 'muted' }));
    basics.append(el('p', game.controls ? `操作方法: ${game.controls}` : '操作方法は未設定です。', { class: 'muted' }));
    basics.append(el('p', '公開停止中のため編集できません。', { class: 'muted' }));
  }
  if (!['unpublished'].includes(game.status)) {
    const visibility = section('公開設定', grid);
    const help = el('p', '', { class: 'muted' }); visibility.append(help);
    const visibilityForm = form(visibility, [
      field('visibility', '公開範囲', 'select', { value: game.visibility, choices: visibilityChoices }),
      field('published_at', '公開日時（空欄で即時）', 'datetime-local', {
        value: game.published_at ? localDateTime(game.published_at) : '', optional: true }),
    ], '公開設定を保存', async data => {
      await api('user.submission.visibility', { submission_id: game.id, visibility: data.visibility,
        published_at: data.published_at ? new Date(data.published_at).toISOString() : '' });
      await account(); notice('公開設定を保存しました。');
    });
    visibilityForm.classList.add('stacked-form');
    visibilityGuidance(visibilityForm, help);
  }
  if (game.status === 'uploading') {
    const retry = section('ゲームファイルを再送', grid);
    retry.append(el('p', 'Web書き出しZIPを選び直してください。保存が完了するまでは審査・プレイできません。', { class: 'muted' }));
    const retryForm = form(retry, [], 'ファイルを再送する', async () => {
      const file = retryForm.elements.package?.files?.[0];
      await uploadPackage(game.id, file, account);
    });
    retryForm.classList.add('stacked-form');
    retryForm.append(el('p', '', { class: 'message upload-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }));
    const packageLabel = el('label', 'ゲームZIP（最大50MB）');
    const packageInput = el('input', null, { type: 'file', name: 'package', accept: '.zip,application/zip', required: 'required' });
    packageLabel.append(packageInput);
    retryForm.querySelector('button[type=submit]').before(packageLabel);
  }
  if (['uploading', 'draft', 'pending', 'rejected', 'approved'].includes(game.status)) {
    const withdraw = section('投稿を取り下げる', grid);
    withdraw.append(el('p', '取り下げると、この投稿は公開・審査の対象から外れます。', { class: 'muted' }));
    button(withdraw, '投稿を取り下げる', async () => {
    if (!confirm(`「${game.title}」を取り下げますか？`)) { notice('キャンセルしました。'); return; }
    await api('user.submission.withdraw', { submission_id: game.id }); location.href = './';
    }, true);
  }
}
const visibilityChoices = [['draft', '下書き（自分だけ）'], ['unlisted', '限定公開（URLを知る人）'], ['public', '公開（一覧に表示）']];
const visibilityLabel = value => ({ draft: '下書き', unlisted: '限定公開', public: '公開' }[value] ?? value);
const statusLabel = value => ({ uploading: 'ZIP未保存', draft: '下書き', pending: '審査待ち',
  approved: '承認済み', rejected: '却下', unpublished: '公開停止' }[value] ?? value);
function localDateTime(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
async function previewSubmission(submissionId) {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal/preview-package`, { method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': session.token },
    body: JSON.stringify({ submission_id: submissionId }), signal: AbortSignal.timeout(90000) });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error ?? 'unavailable'); }
  const files = await unpackPrivateZip(await response.arrayBuffer());
  const frame = el('iframe', null, { title: '非公開ゲームプレビュー', sandbox: 'allow-scripts', referrerpolicy: 'no-referrer' });
  frame.className = 'private-preview'; frame.srcdoc = privatePreviewDocument(files);
  root.replaceChildren();
  const heading = section('自分だけでプレイ');
  heading.append(el('a', '← ゲームの管理に戻る', { href: `./?game=${encodeURIComponent(submissionId)}`, class: 'editor-back' }));
  root.append(frame); notice('このゲームは本人専用の隔離された画面で実行しています。');
}
async function showSubmissionThumbnail(parent, submissionId, mode) {
  try {
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal/submission-thumbnail`, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json',
        ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': session.token },
      body: JSON.stringify({ submission_id: submissionId, mode }) });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const image = el('img', null, { class: 'thumbnail-preview', alt: 'ゲームサムネイル', src: url });
    image.onload = () => URL.revokeObjectURL(url);
    const fallback = parent.querySelector('.summary-fallback');
    if (fallback) fallback.replaceWith(image); else parent.prepend(image);
  } catch { /* Thumbnail is optional; metadata and moderation remain usable. */ }
}
async function dashboard() {
  const [{ admin }, { users }, { submissions }] = await Promise.all([api('admin.me'), api('admin.users', { offset }), api('admin.submissions', { offset: submissionOffset })]);
  root.replaceChildren();
  const top = section(`管理画面 — ${admin.username}`);
  top.append(el('p', `このページの表示: ユーザー ${users.length}件 · 投稿 ${submissions.length}件 · 審査待ち ${submissions.filter(game => game.status === 'pending').length}件`, { class: 'muted' }));
  const jumps = el('div', null, { class: 'actions dashboard-jumps' });
  jumps.append(el('a', '投稿の審査へ ↓', { href: '#reviews' }), el('a', 'ユーザー一覧へ ↓', { href: '#users' }));
  top.append(jumps);
  logoutButton(top);
  button(top, '投稿保管を確認', checkStorageHealth);
  const create = section('ユーザー作成');
  form(create, [username(), password('password', '初期の本人用パスワード'), role(admin.role === 'super_admin')], '作成', async data => {
    await api('admin.create', data); await dashboard(); notice('ユーザーを作成しました。');
  });
  if (admin.role === 'super_admin') {
    const administrators = section('審査管理者を作成');
    administrators.append(el('p', '作成した管理者は投稿の承認・却下を行えます。管理者アカウントの作成と信頼済み投稿者の指定はsuper adminだけが行えます。', { class: 'muted' }));
    form(administrators, [username(), password('password', '初期管理者パスワード')], '管理者を作成', async data => {
      await api('admin.admin.create', data); await dashboard(); notice('審査管理者を作成しました。');
    });
  }
  const list = section('ユーザー一覧', root, 'admin-users');
  list.id = 'users';
  list.append(el('p', `${offset + 1}件目から表示（最大100件）`, { class: 'muted' }));
  if (!users.length) list.append(el('p', 'ユーザーがいません。'));
  for (const user of users) {
    const row = el('div', null, { class: 'row' });
    row.append(el('h3', user.username), el('p', `${roleLabel(user.role)} · ${user.banned ? 'BAN中' : accountStatusLabel(user.status)}`, { class: 'muted' }));
    button(row, '管理', async () => { selected = user.id; await dashboard(); notice('対象ユーザーを選択しました。'); document.querySelector('#selected-user')?.scrollIntoView(); });
    list.append(row);
  }
  const pages = el('div', null, { class: 'actions' });
  if (offset > 0) button(pages, '前の100件', async () => { offset = Math.max(0, offset - 100); await dashboard(); notice('一覧を更新しました。'); });
  if (users.length === 100) button(pages, '次の100件', async () => { offset += 100; await dashboard(); notice('一覧を更新しました。'); });
  button(pages, '更新', async () => { await dashboard(); notice('更新しました。'); }); list.append(pages);
  const user = users.find(u => u.id === selected);
  if (user) await manage(user, admin.role === 'super_admin');
  const reviews = section('ゲーム投稿の審査', root, 'admin-reviews');
  reviews.id = 'reviews';
  reviews.append(el('p', `${submissionOffset + 1}件目から表示（最大100件）。下書きは投稿者本人だけに表示します。`, { class: 'muted' }));
  if (!submissions.length) reviews.append(el('p', '投稿はありません。'));
  for (const game of submissions) {
    const row = el('div', null, { class: 'row' });
    row.append(statusBadge(game), el('h3', game.title));
    row.append(el('p', `投稿者: ${game.username} · ${game.engine.toUpperCase()} · バージョン ${game.version}`, { class: 'muted' }));
    if (game.is_published) row.append(el('a', '公開ページ', { href: `../game.html?slug=${encodeURIComponent(game.public_slug)}` }));
    if (game.status === 'uploading') row.append(el('p', 'ZIP未保管。投稿者がWeb書き出しZIPを再送するまで審査・公開できません。', { class: 'muted' }));
    if (game.description) row.append(el('p', game.description, { class: 'muted' }));
    if (game.review_reason) row.append(el('p', `審査メモ: ${game.review_reason}`, { class: 'muted' }));
    if (game.status === 'approved' && !game.package_ready) button(row, '配信用ファイルを準備', () => repairPublication(game.id));
    if (['pending', 'approved', 'rejected'].includes(game.status)) button(row, 'ZIPを安全にダウンロード', () => downloadSubmission(game.id));
    if (game.status === 'pending') {
      button(row, '承認して公開設定を反映', () => reviewSubmission(game.id, 'approved'));
      button(row, '却下', async () => {
        const reason = prompt('却下理由（任意・500文字まで）', '');
        if (reason !== null) await reviewSubmission(game.id, 'rejected', reason);
      }, true);
    }
    if (game.status === 'approved') button(row, '公開を停止', async () => {
      const reason = prompt('公開停止の理由（任意・500文字まで）', '');
      if (reason === null) return;
      await api('admin.submission.unpublish', { submission_id: game.id, reason });
      await dashboard(); notice('公開を停止しました。');
    }, true);
    reviews.append(row);
  }
  const reviewPages = el('div', null, { class: 'actions' });
  if (submissionOffset > 0) button(reviewPages, '前の100件', async () => { submissionOffset -= 100; await dashboard(); });
  if (submissions.length === 100) button(reviewPages, '次の100件', async () => { submissionOffset += 100; await dashboard(); });
  button(reviewPages, '投稿一覧を更新', dashboard); reviews.append(reviewPages);
  const audit = section('管理操作の監査ログ', root, 'admin-audit');
  button(audit, '最新の100件', async () => { auditBefore = undefined; await showAudit(audit); notice('監査ログを表示しました。'); });
}
async function manage(user, allowTrusted = false) {
  const s = section(`${user.username} の管理`); s.id = 'selected-user';
  s.append(el('p', `アカウント状態: ${user.status}`, { class: 'muted' }));
  const change = async (action, data = {}) => {
    await api(action, { ...data, user_id: user.id }); await dashboard(); notice('変更を保存しました。');
  };
  form(s, [{ ...username(), value: user.username }], '名前を変更', data => change('admin.rename', data));
  form(s, [{ ...role(allowTrusted), value: user.role }], '権限を変更', data => change('admin.role', data));
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

async function uploadPackage(submissionId, file, refresh = upload, thumbnail = null) {
    if (!file) throw new Error('invalid_request');
    await checkWebGameZip(file);
    notice('ゲームファイルを送信中…0%');
    const body = new FormData(); body.set('submission_id', submissionId); body.set('package', file);
    if (thumbnail?.size) body.set('thumbnail', thumbnail);
    const started = Date.now(); let progress = 0; let checking = false;
    const showProgress = () => notice(checking ? '保存結果を確認中…' : progress === 100
      ? `ファイル送信完了。サーバーで保存中…（${Math.floor((Date.now() - started) / 1000)}秒経過）この画面を閉じずにお待ちください。`
      : `ゲームファイルを送信中…${progress === null ? '' : `${progress}% `}（${Math.floor((Date.now() - started) / 1000)}秒経過）`);
    const timer = setInterval(showProgress, 1000);
    let submission;
    try {
      submission = await uploadWithRecovery(() => sendUpload(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal/upload`, {
        body, headers: { ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': session.token },
        onProgress: value => { progress = value; showProgress(); },
      }), () => { checking = true; notice('保存結果を確認中…'); return api('user.submissions'); }, submissionId);
    } finally { clearInterval(timer); }
    if (refresh) await refresh(); notice(submission?.status === 'draft' ? '下書きに保存しました。自分だけがプレイできます。' : submission?.status === 'approved'
      ? '非公開で保管しました。信頼済み投稿者のため審査を省略しました。'
      : '非公開で保管しました。審査待ちです。');
    return submission;
}
function uploadComplete(submission) {
  root.replaceChildren();
  const done = section('投稿が完了しました');
  done.append(el('p', submission?.status === 'draft' ? '下書きに保存しました。自分だけが閲覧・プレイできます。審査には送られていません。'
    : submission?.status === 'approved' ? '審査を省略して保存しました。公開設定と公開日時に従って表示されます。'
    : 'ゲームを保存し、管理者の審査へ送りました。承認後、公開設定が反映されます。'));
  done.append(el('p', '投稿したゲームは、アカウント画面からいつでも確認・編集できます。', { class: 'muted' }));
  const actions = el('div', null, { class: 'actions' });
  actions.append(el('a', '投稿したゲームを管理・プレイ →', { href: `../account/?game=${encodeURIComponent(submission.id)}`, class: 'editor-back' }));
  button(actions, '別のゲームを投稿', upload);
  done.append(actions);
  notice('投稿が完了しました。');
  window.scrollTo(0, 0);
}
async function checkStorageHealth() {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal/storage-health`, { method: 'POST', credentials: 'omit',
    headers: { ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': session.token }, signal: AbortSignal.timeout(90000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error ?? 'drive_unavailable');
  notice('保管フォルダーの接続と保存・移動権限を確認しました。実際の保存はZIP投稿で確認してください。');
}
async function reviewSubmission(submissionId, decision, reason = '') {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal/review`, { method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': session.token },
    body: JSON.stringify({ submission_id: submissionId, decision, reason }), signal: AbortSignal.timeout(30000) });
  const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error ?? 'unavailable');
  await dashboard(); notice(decision === 'approved' ? '承認しました。公開設定と日時に従って表示されます。' : '却下しました。');
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
  if (!['uploader', 'trusted_uploader'].includes(user.role)) { s.append(el('p', 'このアカウントには投稿権限がありません。管理者に投稿可能ユーザーへの変更を依頼してください。')); return; }
  s.append(el('p', 'ゲーム情報・公開設定・ファイルをこの画面で入力して保存します。', { class: 'muted' }));
  const flow = el('div', null, { class: 'upload-flow', 'aria-label': '投稿の流れ' });
  for (const step of ['1 作品情報', '2 公開設定', '3 ファイル選択']) flow.append(el('span', step));
  s.append(flow);
  const guide = el('details', null, { class: 'export-guide' });
  guide.append(el('summary', 'GodotのWeb書き出し・ZIP作成手順'));
  const steps = el('ol', null);
  for (const step of [
    'Godotでプロジェクトを開き、「プロジェクト」→「エクスポート」を選びます。',
    '「追加」から「Web」を選びます。書き出しテンプレートを求められたら、Godotの画面に沿ってインストールします。',
    'Godot 4.7.2ではWebプリセットの「Thread Support」をオフにし、「Extensions Support」も使わないならオフにします。',
    '「プロジェクトをエクスポート」で空のフォルダーへ書き出します。HTML名はindex.htmlでもjump.htmlでも構いません。生成後に名前を変更しないでください。',
    'HTML・同名の.js・.wasm・.pck・画像など、書き出されたファイル一式をZIPにするか、この画面へまとめてドラッグ＆ドロップします。ZIP内に1つの親フォルダーがあっても受け付けます。',
    '「PCK/ZIPのエクスポート」だけではブラウザーで遊べません。必ず「プロジェクトをエクスポート」でWeb一式を作成してください。',
  ]) steps.append(el('li', step));
  guide.append(steps);
  s.append(guide);
  const turboGuide = el('details', null, { class: 'export-guide' });
  turboGuide.append(el('summary', 'Scratch / TurboWarpのHTML書き出し・投稿手順'));
  const packagerLink = el('p', null);
  packagerLink.append(el('a', 'TurboWarp Packagerを開く ↗', {
    href: 'https://packager.turbowarp.org/', target: '_blank', rel: 'noopener noreferrer',
  }));
  turboGuide.append(packagerLink);
  const turboSteps = el('ol', null);
  for (const step of [
    'TurboWarp Packagerを開き、Scratch作品のURL、または保存した.sb3ファイルを読み込みます。',
    '画面サイズや操作ボタンなどを設定し、出力形式で「Plain HTML」（HTML）を選びます。',
    'パッケージを作成して、生成された.htmlファイルをダウンロードします。',
    'ダウンロードしたHTMLをブラウザーで開き、ゲームが動くことを確認します。',
    'この投稿フォームのエンジンを「Scratch / TurboWarp」にし、HTMLをファイル選択欄へドラッグ＆ドロップするか、「ファイルを選択」から選びます。ZIPにする必要はなく、HTML名もindex.htmlでなくて構いません。',
    'ゲーム情報と公開範囲を設定し、「ゲームを投稿」を押します。',
  ]) turboSteps.append(el('li', step));
  turboGuide.append(turboSteps, el('p', 'ZIP形式で書き出した場合は、HTMLと関連ファイルが入ったZIPをそのまま選べます。.sb3やWindows用の実行ファイルではなく、ブラウザー用のHTMLまたはZIPを投稿してください。', { class: 'muted' }));
  s.append(turboGuide);
  let pendingSubmissionId, selectedFiles = [], thumbnailUrl;
  const submissionForm = form(s, [field('title', 'ゲーム名', 'text', { maxlength: '120' }),
    field('engine', 'エンジン', 'select', { choices: [['godot','Godot'],['scratch','Scratch / TurboWarp'],['other','その他']] }),
    field('description', '説明（任意）', 'text', { maxlength: '4000', optional: true }),
    field('version', 'バージョン', 'text', { value: '1.0.0', maxlength: '80' }),
    field('controls', '操作説明（任意）', 'text', { maxlength: '2000', optional: true }),
    field('visibility', '公開範囲', 'select', { value: 'draft', choices: visibilityChoices }),
    field('published_at', '公開日時（空欄で即時公開）', 'datetime-local', { optional: true }),
  ], 'ゲームを投稿', async data => {
    const thumbnail = submissionForm.elements.thumbnail?.files?.[0];
    delete data.package; delete data.thumbnail;
    data.published_at = data.published_at ? new Date(data.published_at).toISOString() : '';
    const file = await packageWebFiles(selectedFiles);
    await checkWebGameZip(file);
    if (!pendingSubmissionId) { const { submission } = await api('user.submission.create', data); pendingSubmissionId = submission.id; }
    const completed = await uploadPackage(pendingSubmissionId, file, null, thumbnail);
    pendingSubmissionId = null;
    uploadComplete(completed);
  });
  submissionForm.classList.add('stacked-form');
  submissionForm.append(el('p', '', { class: 'message upload-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }));
  const visibilityHelp = el('p', '', { class: 'muted' });
  submissionForm.elements.visibility.closest('label').append(visibilityHelp);
  visibilityGuidance(submissionForm, visibilityHelp);
  const thumbnailLabel = el('label', 'ゲームサムネイル（任意・5MB以下）');
  const thumbnailInput = el('input', null, { type: 'file', name: 'thumbnail', accept: 'image/png,image/jpeg,image/webp' });
  const thumbnailPreview = el('img', null, { class: 'thumbnail-preview', alt: 'サムネイルのプレビュー', hidden: '' });
  thumbnailInput.addEventListener('change', () => {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    const image = thumbnailInput.files?.[0];
    if (image && image.size <= 5242880 && ['image/png','image/jpeg','image/webp'].includes(image.type)) {
      thumbnailUrl = URL.createObjectURL(image); thumbnailPreview.src = thumbnailUrl; thumbnailPreview.hidden = false;
    } else { thumbnailPreview.hidden = true; if (image) notice(errors.invalid_thumbnail); }
  });
  thumbnailLabel.append(thumbnailInput, thumbnailPreview);
  submissionForm.prepend(thumbnailLabel);
  const dropZone = el('div', null, { class: 'upload-dropzone' });
  dropZone.append(el('strong', 'ゲームファイルをドラッグ＆ドロップ'));
  dropZone.append(el('p', 'ZIPファイル1つ、またはWeb書き出しの複数ファイルを選べます。最大50MB。', { class: 'muted' }));
  const packageInput = el('input', null, { type: 'file', name: 'package', multiple: '',
    'aria-label': 'ゲームファイルを選択' });
  const selection = el('p', 'ファイルはまだ選択されていません', { class: 'muted' });
  const setFiles = files => { if (busy) return; selectedFiles = [...files]; selection.textContent = selectedFiles.length
    ? selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length}ファイルを選択中` : 'ファイルはまだ選択されていません'; };
  packageInput.addEventListener('change', () => setFiles(packageInput.files));
  dropZone.addEventListener('dragover', event => { event.preventDefault(); if (!busy) dropZone.classList.add('is-dragging'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
  dropZone.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('is-dragging'); setFiles(event.dataTransfer.files); });
  dropZone.append(packageInput, selection);
  submissionForm.querySelector('button[type=submit]').before(dropZone);
  const { submissions } = await api('user.submissions');
  const history = section('投稿履歴');
  if (!submissions.length) history.append(el('p', '投稿はまだありません。'));
  for (const game of submissions) {
    const row = el('div', null, { class: 'row' });
    if (game.has_thumbnail) showSubmissionThumbnail(row, game.id, 'user');
    row.append(statusBadge(game), el('h3', game.title));
    row.append(el('p', `${game.engine.toUpperCase()} · バージョン ${game.version}`, { class: 'muted' }));
    const link = el('a', '管理・編集する →', { href: `../account/?game=${encodeURIComponent(game.id)}`, class: 'editor-back' }); row.append(link); history.append(row);
  }
}
async function repairPublication(submissionId) {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/portal/publish-package`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json',
      ...(config.anonKey ? { apikey: config.anonKey } : {}), 'X-Portal-Session': session.token },
    body: JSON.stringify({ submission_id: submissionId }), signal: AbortSignal.timeout(90000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error ?? 'unavailable');
  await dashboard(); notice('配信用ファイルを準備しました。公開設定と日時が反映されます。');
}

async function start() {
  if (!config.supabaseUrl) {
    if (uploadMode) section('投稿サービスは未設定です').append(el('p', '管理者がSupabaseと非公開保管領域を設定すると利用できます。'));
    else section('認証サービスは未設定です').append(el('p', '管理者がSupabaseの設定を完了すると利用できます。公開済みゲームは引き続き遊べます。'));
    return;
  }
  if (!restoreSession()) { login(); return; }
  syncLoginLink();
  if (location.hash === '#logout') { await logout(); return; }
  try {
    if (adminMode) { await api('admin.me'); offset = 0; selected = null; await dashboard(); }
    else {
      await api('user.me');
      if (uploadMode) await upload();
      else if (accountMode) await account();
      else location.replace('../account/');
    }
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
