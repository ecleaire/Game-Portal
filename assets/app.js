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

  count.textContent = `${filtered.length} games`;
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
        <p>${escapeHTML(game.description)}</p>
        <a class="play-link" href="game.html?id=${encodeURIComponent(game.id)}">遊ぶ ▶</a>
      </div>
    `;
    grid.appendChild(card);
  }
}

document.getElementById("filters").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;

  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-button").forEach(btn => btn.classList.remove("active"));
  button.classList.add("active");
  render();
});

searchInput.addEventListener("input", render);

fetch("games.json")
  .then(res => {
    if (!res.ok) throw new Error("games.json の読み込みに失敗しました");
    return res.json();
  })
  .then(data => {
    games = data;
    render();
  })
  .catch(error => {
    console.error(error);
    emptyMessage.hidden = false;
    emptyMessage.textContent = "ゲーム情報を読み込めませんでした。";
  });
