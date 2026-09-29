import { config } from './config.js';
let games = [];
let activeFilter = "all";

const grid = document.getElementById("gameGrid");
const count = document.getElementById("gameCount");
const searchInput = document.getElementById("searchInput");
const emptyMessage = document.getElementById("emptyMessage");

function escapeHTML(value = "") {
  return value.replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function render() {
  const keyword = searchInput.value.trim().toLowerCase();
  const filtered = games.filter(game => {
    const engineMatch = activeFilter === "all" || game.engine.toLowerCase() === activeFilter;
    const text = `${game.title} ${game.description} ${game.engine}`.toLowerCase();
    return engineMatch && text.includes(keyword);
  });

  count.textContent = `${filtered.length}作品`;
  grid.innerHTML = "";
  emptyMessage.hidden = filtered.length !== 0;

  for (const game of filtered) {
    const card = document.createElement("article");
    card.className = "game-card";

    const thumb = game.thumbnail
      ? `<img src="${escapeHTML(game.thumbnail)}" alt="${escapeHTML(game.title)} のサムネイル">`
      : `<div class="thumb-fallback">${escapeHTML(game.title.slice(0, 2).toUpperCase())}</div>`;

    card.innerHTML = `
      <div class="game-thumb">${thumb}</div>
      <div class="game-card-body">
        <span class="game-type">${escapeHTML(game.engine)}</span>
        <h4>${escapeHTML(game.title)}</h4>
        <p>${escapeHTML(game.description || '作品の詳細を見る')}</p>
        <a class="play-link" href="game.html?${game.slug ? `slug=${encodeURIComponent(game.slug)}` : `id=${encodeURIComponent(game.id)}`}">遊ぶ ▶</a>
      </div>
    `;
    grid.appendChild(card);
    if (game.slug && game.has_thumbnail && config.supabaseUrl) {
      fetch(`${config.supabaseUrl}/functions/v1/portal/public-thumbnail`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(config.anonKey ? { apikey: config.anonKey } : {}) },
        body: JSON.stringify({ slug: game.slug }) })
        .then(response => response.ok ? response.blob() : null)
        .then(blob => { if (blob && card.isConnected) {
          const image = document.createElement('img'); image.src = URL.createObjectURL(blob);
          image.alt = `${game.title} のサムネイル`; image.onload = () => URL.revokeObjectURL(image.src);
          card.querySelector('.game-thumb').replaceChildren(image);
        } }).catch(console.error);
    }
  }
}

document.getElementById("filters").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;

  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-button").forEach(btn => { btn.classList.remove("active"); btn.setAttribute('aria-pressed', 'false'); });
  button.classList.add("active");
  button.setAttribute('aria-pressed', 'true');
  render();
});

searchInput.addEventListener("input", render);

async function loadGames() {
  const legacy = await fetch('games.json').then(response => {
    if (!response.ok) throw new Error('games.json の読み込みに失敗しました');
    return response.json();
  });
  games = legacy; render();
  if (!config.supabaseUrl) return;
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/portal/catalog`, { method: 'POST',
      headers: config.anonKey ? { apikey: config.anonKey } : {} });
    if (!response.ok) throw new Error('公開ゲームの読み込みに失敗しました');
    const { games: published } = await response.json();
    games = [...legacy, ...published.map(game => ({ ...game, id: game.slug }))]; render();
  } catch (error) { console.error(error); }
}
loadGames().catch(error => { console.error(error); emptyMessage.hidden = false;
  emptyMessage.textContent = 'ゲーム情報を読み込めませんでした。'; });
