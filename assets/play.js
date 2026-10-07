import { config } from './config.js';
import { userSessionKey } from './navigation.js?v=20261003a';
import { tagChips } from './tags.js?v=20261004a';
import { unpackPrivateZip, privatePreviewDocument } from './private-preview.js?v=20261007c';

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
  document.querySelector('#gameTags')?.remove();
  const tags=tagChips(game.tags,Infinity,'./');tags.id='gameTags';document.getElementById('gameTitle').after(tags);
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
async function publicPost(path, slug, signal) {
  const token=sessionStorage.getItem(userSessionKey);
  const response = await fetch(`${config.supabaseUrl}/functions/v1/portal/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}),...(path.startsWith('shared-')&&token?{'X-Portal-Session':token}:{}) },
    body: JSON.stringify({ slug }), signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]) });
  if (!response.ok) throw new Error(response.status === 404 ? 'not_found' : 'unavailable');
  return response;
}
// Both endpoints authorize independently. Start the ZIP transfer while metadata loads.
async function fetchGame(mode, slug) {
  const controller = new AbortController();
  // Observe early transfer failures immediately, but keep metadata errors authoritative
  // so only a missing public listing triggers the authenticated shared-game fallback.
  const archive = publicPost(`${mode}-package`, slug, controller.signal)
    .then(response => response.arrayBuffer())
    .then(buffer => ({ buffer }), error => ({ error }));
  try {
    const response = await publicPost(`${mode}-game`, slug, controller.signal);
    const { game } = await response.json();
    if (!game) throw new Error('not_found');
    return { game, archive, controller };
  } catch (error) {
    controller.abort();
    throw error;
  }
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
    let result;
    try { result = await fetchGame('public', slug); }
    catch(error){if(error.message!=='not_found')throw error;
      if(!/^[a-f0-9]{64}$/.test(sessionStorage.getItem(userSessionKey)??''))throw new Error('private_or_missing');
      result = await fetchGame('shared', slug);
    }
    let archive;
    try {
      showGame(result.game);
      archive = await result.archive;
      if (archive.error) throw archive.error;
    } finally { result.controller.abort(); }
    const files = await unpackPrivateZip(archive.buffer);
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
  load().catch(error => {
    showError(error.message === 'private_or_missing' ? 'ゲームが見つからないか、ログインが必要な共有ゲームです。' : error.message === 'not_found' ? 'ゲームが見つからないか、閲覧権限がありません。' : 'ゲームを読み込めませんでした。「再読み込み」で再試行できます。');
    if(error.message==='private_or_missing'&&!document.getElementById('sharedLogin')){const a=document.createElement('a');a.id='sharedLogin';a.textContent='ログインする';a.href='./login/';document.getElementById('gameDescription').after(a);}
  });
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
