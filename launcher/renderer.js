const $ = selector => document.querySelector(selector);
let games = [], busy = false;
function render() {
  const matches = games.filter(game => game.title.toLocaleLowerCase().includes($('#search').value.trim().toLocaleLowerCase()));
  $('#games').replaceChildren(); $('#count').textContent = String(games.length);
  $('#empty').hidden = matches.length > 0;
  $('#empty').textContent = games.length ? '条件に合うゲームがありません。' : '「ゲームを取り込む」からHTMLまたはZIPを追加してください。';
  for (const game of matches) {
    const card = document.createElement('article'); card.className = 'card';
    const art = document.createElement('div'); art.className = 'game-art'; art.textContent = '▶';
    const title = document.createElement('h3'); title.textContent = game.title;
    const label = document.createElement('p'); label.className = 'saved'; label.textContent = '● この端末に保存済み';
    const actions = document.createElement('div'); actions.className = 'actions';
    const play = document.createElement('button'); play.textContent = 'プレイ'; play.disabled = busy; play.onclick = () => run(() => window.launcher.play(game.id), false);
    const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = '削除'; remove.setAttribute('aria-label', `${game.title}を削除`); remove.disabled = busy; remove.onclick = () => run(() => window.launcher.remove(game.id));
    actions.append(play, remove); card.append(art, title, label, actions); $('#games').append(card);
  }
}
async function run(operation, update = true) {
  if (busy) return;
  busy = true; $('#import').disabled = true; $('#chooseFolder').disabled = true; render();
  $('#status').textContent = '処理しています…';
  try {
    const result = await operation();
    if (!result.ok) throw new Error(result.error);
    if (update) { games = result.value.games; $('#folder').textContent = result.value.folder || 'フォルダーを選んで始めましょう'; }
    $('#status').textContent = '';
  } catch (error) { $('#status').textContent = error.message || '操作できませんでした。'; }
  finally { busy = false; $('#chooseFolder').disabled = false; $('#import').disabled = !$('#folder').textContent || $('#folder').textContent === 'フォルダーを選んで始めましょう'; render(); }
}
$('#search').oninput = render;
$('#chooseFolder').onclick = () => run(() => window.launcher.chooseFolder());
$('#import').onclick = () => run(() => window.launcher.importGame());
run(() => window.launcher.state());
