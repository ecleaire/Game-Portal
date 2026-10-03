import { config } from './config.js';
import { unpackPrivateZip, privatePreviewDocument } from './private-preview.js?v=20260929a';

const params = new URLSearchParams(location.search);
const frame = document.getElementById('gameFrame');
const shell = document.getElementById('playerShell');
const loading = document.getElementById('loading');
const status = document.getElementById('playerStatus');
const reloadButton = document.getElementById('reloadButton');
const fullscreenButton = document.getElementById('fullscreenButton');
const shareButton = document.getElementById('shareButton');
let loadingGame = false;
function showError(message) {
  loading.textContent = message; loading.hidden = false; loading.classList.add('is-error');
  frame.style.visibility = 'hidden'; shell.setAttribute('aria-busy', 'false');
  status.textContent = '読込に失敗'; reloadButton.disabled = false; loadingGame = false;
  if (document.getElementById('gameTitle').textContent === 'ゲームを読み込んでいます')
    document.getElementById('gameTitle').textContent = 'ゲームを開けませんでした';
}
function showGame(game) {
  document.title = `${game.title} | GAME PORTAL`;
  document.getElementById('gameTitle').textContent = game.title;
  frame.title = `${game.title} のゲーム画面`;
  document.getElementById('gameDescription').textContent = game.description || '';
  document.getElementById('descriptionCard').hidden = !game.description;
  document.getElementById('engineLabel').textContent = game.engine || '';
  document.getElementById('engineLabel').hidden = !game.engine;
  document.getElementById('controlsText').textContent = game.controls || 'ゲーム内の案内をご確認ください。';
  document.getElementById('versionText').textContent = game.version ? `v${game.version}` : '';
  document.getElementById('versionText').hidden = !game.version;
  shareButton.disabled = false;
}
async function publicPost(path, slug) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/portal/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}) },
    body: JSON.stringify({ slug }), signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'not_found' : 'unavailable');
  return response;
}
function setFrame(attribute, source) {
  frame.addEventListener('load', () => {
    loading.hidden = true; frame.style.visibility = 'visible'; shell.setAttribute('aria-busy', 'false');
    status.textContent = 'ゲームを表示しました'; reloadButton.disabled = false; fullscreenButton.disabled = false; loadingGame = false;
  }, { once: true });
  frame[attribute] = source;
}
async function load() {
  if (loadingGame) return;
  loadingGame = true; reloadButton.disabled = true; fullscreenButton.disabled = true;
  loading.textContent = 'ゲームを読み込んでいます…'; loading.hidden = false; loading.classList.remove('is-error');
  frame.style.visibility = 'hidden'; status.textContent = '読込中'; shell.setAttribute('aria-busy', 'true');
  const slug = params.get('slug');
  if (slug) {
    if (!config.supabaseUrl || !/^[a-f0-9]{36}$/.test(slug)) throw new Error('not_found');
    const { game } = await (await publicPost('public-game', slug)).json();
    if (!game) throw new Error('not_found');
    showGame(game);
    const archive = await (await publicPost('public-package', slug)).arrayBuffer();
    const files = await unpackPrivateZip(archive);
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    setFrame('srcdoc', privatePreviewDocument(files));
  } else {
    const response = await fetch('games.json');
    if (!response.ok) throw new Error('unavailable');
    const game = (await response.json()).find(item => item.id === params.get('id'));
    if (!game) throw new Error('not_found');
    showGame(game); setFrame('src', game.path);
  }
}
function openGame() {
  load().catch(error => showError(error.message === 'not_found' ? 'ゲームが見つからないか、公開前です。' : 'ゲームを読み込めませんでした。「再読み込み」で再試行できます。'));
}
openGame(); reloadButton.addEventListener('click', openGame);
function updateFullscreen() {
  const expanded = document.fullscreenElement === shell || shell.classList.contains('is-expanded');
  fullscreenButton.textContent = expanded ? '全画面を終了' : '全画面で遊ぶ';
  fullscreenButton.setAttribute('aria-pressed', String(expanded));
}
function exitExpanded() { shell.classList.remove('is-expanded'); document.body.classList.remove('player-expanded'); updateFullscreen(); }
fullscreenButton.addEventListener('click', async () => {
  if (shell.classList.contains('is-expanded')) { exitExpanded(); return; }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.fullscreenEnabled && shell.requestFullscreen) await shell.requestFullscreen();
    else throw new Error('unsupported');
  } catch {
    shell.classList.add('is-expanded'); document.body.classList.add('player-expanded');
  }
  updateFullscreen();
});
document.addEventListener('fullscreenchange', updateFullscreen);
document.addEventListener('keydown', event => { if (event.key === 'Escape') exitExpanded(); });
shareButton.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); status.textContent = 'ゲームのURLをコピーしました'; }
  catch { status.textContent = 'アドレスバーのURLをコピーして共有できます。'; }
});
