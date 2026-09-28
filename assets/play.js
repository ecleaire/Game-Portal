import { config } from './config.js';
import { unpackPrivateZip, privatePreviewDocument } from './private-preview.js?v=20260929a';

const params = new URLSearchParams(location.search);
const frame = document.getElementById('gameFrame');
const shell = document.getElementById('playerShell');
const loading = document.getElementById('loading');
function showError(message) { loading.textContent = message; frame.style.display = 'none'; }
function showGame(game) {
  document.title = `${game.title} | GAME PORTAL`;
  document.getElementById('gameTitle').textContent = game.title;
  document.getElementById('gameDescription').textContent = game.description || '';
  document.getElementById('engineLabel').textContent = game.engine || '';
  document.getElementById('controlsText').textContent = game.controls || '—';
  document.getElementById('versionText').textContent = game.version || '—';
}
async function publicPost(path, slug) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/portal/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}) },
    body: JSON.stringify({ slug }) });
  if (!response.ok) throw new Error('not_found');
  return response;
}
async function load() {
  const slug = params.get('slug');
  if (slug) {
    if (!config.supabaseUrl || !/^[a-f0-9]{36}$/.test(slug)) throw new Error('not_found');
    const { game } = await (await publicPost('public-game', slug)).json();
    showGame(game);
    const archive = await (await publicPost('public-package', slug)).arrayBuffer();
    const files = await unpackPrivateZip(archive);
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = privatePreviewDocument(files);
  } else {
    const response = await fetch('games.json');
    if (!response.ok) throw new Error('unavailable');
    const game = (await response.json()).find(item => item.id === params.get('id'));
    if (!game) throw new Error('not_found');
    showGame(game); frame.src = game.path;
  }
  frame.addEventListener('load', () => { loading.style.display = 'none'; }, { once: true });
}
load().catch(error => showError(error.message === 'not_found' ? 'ゲームが見つからないか、公開前です。' : 'ゲームを読み込めませんでした。'));
document.getElementById('fullscreenButton').addEventListener('click', async () => {
  try { if (!document.fullscreenElement) await shell.requestFullscreen(); else await document.exitFullscreen(); }
  catch (error) { console.error(error); }
});
