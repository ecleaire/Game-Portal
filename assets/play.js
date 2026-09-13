const params = new URLSearchParams(location.search);
const id = params.get("id");

const frame = document.getElementById("gameFrame");
const shell = document.getElementById("playerShell");
const loading = document.getElementById("loading");

function showError(message) {
  loading.textContent = message;
  frame.style.display = "none";
}

fetch("games.json")
  .then(res => res.json())
  .then(games => {
    const game = games.find(item => item.id === id);
    if (!game) {
      showError("ゲームが見つかりません。");
      return;
    }

    document.title = `${game.title} | GAME PORTAL`;
    document.getElementById("gameTitle").textContent = game.title;
    document.getElementById("gameDescription").textContent = game.description || "";
    document.getElementById("engineLabel").textContent = game.engine || "";
    document.getElementById("controlsText").textContent = game.controls || "—";
    document.getElementById("versionText").textContent = game.version || "—";

    frame.src = game.path;
    frame.addEventListener("load", () => {
      loading.style.display = "none";
    });
  })
  .catch(error => {
    console.error(error);
    showError("ゲーム情報の読み込みに失敗しました。");
  });

document.getElementById("fullscreenButton").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await shell.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.error(error);
  }
});
