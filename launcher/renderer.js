const $ = selector => document.querySelector(selector);
let games = [], folder = '', busy = false;
function render() {
  const matches = games.filter(game => game.title.toLocaleLowerCase().includes($('#search').value.trim().toLocaleLowerCase()));
  $('#games').replaceChildren(); $('#count').textContent = String(games.length);
  $('#folder').textContent = folder || '未設定';
  $('#folderSummary').textContent = folder || '設定からゲームの保管フォルダーを指定してください。';
  $('#empty').hidden = matches.length > 0;
  $('#empty').textContent = !folder ? '「設定」からゲームの保管フォルダーを指定してください。' : games.length ? '条件に合うゲームがありません。' : 'ゲームが見つかりません。フォルダーにHTML・ZIP・EXEを置いて再読み込みしてください。';
  for (const game of matches) {
    const card = document.createElement('article'); card.className = 'card';
    const art = document.createElement('div'); art.className = 'game-art'; art.textContent = '▶';
    const title = document.createElement('h2'); title.textContent = game.title;
    const type = document.createElement('p'); type.className = 'saved'; type.textContent = game.kind === 'exe' ? 'Windows' : 'Webゲーム';
    const play = document.createElement('button'); play.textContent = 'プレイ'; play.disabled = busy; play.onclick = () => run(() => window.launcher.play(game.id), false);
    card.append(art, title, type, play); $('#games').append(card);
  }
}
async function run(operation, update = true) {
  if (busy) return;
  busy = true; $('#refresh').disabled = true; $('#chooseFolder').disabled = true; render();
  $('#status').textContent = '読み込んでいます…';
  try {
    const result = await operation();
    if (!result.ok) throw new Error(result.error);
    if (update) { games = result.value.games; folder = result.value.folder; }
    $('#status').textContent = '';
  } catch (error) { $('#status').textContent = error.message || '操作できませんでした。'; }
  finally { busy = false; $('#refresh').disabled = false; $('#chooseFolder').disabled = false; render(); }
}
$('#search').oninput = render;
$('#settings').onclick = () => $('#settingsDialog').showModal();
$('#closeSettings').onclick = () => $('#settingsDialog').close();
$('#chooseFolder').onclick = async () => { await run(() => window.launcher.chooseFolder()); if (folder) $('#settingsDialog').close(); };
$('#refresh').onclick = () => run(() => window.launcher.state());
run(() => window.launcher.state());
