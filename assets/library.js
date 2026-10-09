import { social, currentSession, node, errorText, gameLink } from './library-api.js?v=20261010b';
import { requireTerms } from './terms.js?v=20261008a';
import { logoutSessions } from './navigation.js?v=20261009b';

const root = document.getElementById('library');
const status = document.getElementById('message');
const params = new URLSearchParams(location.search);
let view = params.get('view') || 'lists', listId = params.get('list'), currentList, busy = false;
let followOffset = 0;
async function run(work) {
  if (busy) return;
  busy = true; root.setAttribute('aria-busy', 'true'); root.querySelectorAll('button,input').forEach(el => { el.disabled = true; });
  try { await work(); status.textContent = ''; }
  catch (error) { status.textContent = errorText(error); }
  finally { busy = false; root.removeAttribute('aria-busy'); root.querySelectorAll('button,input').forEach(el => { el.disabled = el.dataset.unavailable === 'true'; }); }
}
function action(text, work, attributes = {}) {
  const button = node('button', text, { type: 'button', ...attributes }); button.onclick = () => run(work); return button;
}
function heading(text) { root.append(node('h2', text)); }
function navigate(nextView, nextList = null) {
  view = nextView; listId = nextList;
  followOffset = 0;
  const query = new URLSearchParams({ view }); if (listId) query.set('list', listId);
  history.replaceState(null, '', `?${query}`); return refresh();
}
function renderGames(games, container, { remove, reorder } = {}) {
  if (!games.length) { container.append(node('p', 'まだゲームがありません。', { class: 'library-empty' })); return; }
  const search = node('input', '', { type: 'search', placeholder: 'ゲーム名で検索', 'aria-label': 'ゲーム名で検索' });
  const list = node('div', '', { class: 'library-games', tabindex: '0', 'aria-label': '保存したゲーム' });
  const render = () => {
    list.replaceChildren();
    games.forEach((game, index) => {
      if (search.value && !game.title?.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())) return;
      const row = node('article', '', { class: 'library-game' });
      const information = node('div');
      if (game.unavailable) information.append(node('strong', '閲覧できない作品'), node('p', '公開範囲が変更されたか、現在のアカウントには閲覧権限がありません。', { class: 'muted' }));
      else information.append(gameLink(game), node('p', game.engine || '', { class: 'muted' }));
      row.append(information);
      const buttons = node('div', '', { class: 'library-row-actions' });
      if (reorder) {
        const move = direction => { const ordered = [...games]; [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]]; return reorder(ordered.map(g => g.entry_id)); };
        for (const [delta, label] of [[-1, '上へ'], [1, '下へ']]) {
          const unavailable = index + delta < 0 || index + delta >= games.length || !!search.value;
          const button = action(label, () => move(delta), { 'aria-label': `${game.title || '閲覧できない作品'}を${label}`, 'data-unavailable': String(unavailable) });
          button.disabled = unavailable; buttons.append(button);
        }
      }
      if (remove) buttons.append(action('外す', () => remove(game), { 'aria-label': `${game.title || '閲覧できない作品'}を外す` }));
      row.append(buttons); list.append(row);
    });
    if (!list.childElementCount) list.append(node('p', '一致するゲームがありません。'));
  };
  search.oninput = render; container.append(search, list); render();
}
function nameForm(label, value, work) {
  const form = node('form', '', { class: 'library-create' });
  const input = node('input', '', { required: '', maxlength: '100', 'aria-label': label, placeholder: label }); input.value = value;
  const button = node('button', value ? '名前を保存' : 'リストを作成', { type: 'submit' });
  form.append(input, button); form.onsubmit = event => { event.preventDefault(); run(() => work(input.value)); }; return form;
}
async function copyShare() {
  const result = await social('social.list.share', { list_id: listId, operation: 'enable' });
  const url = new URL('index.html', location.href); url.search = ''; url.searchParams.set('share', result.share_token);
  await refresh();
  const output = document.getElementById('shareOutput'); output.replaceChildren();
  const input = node('input', '', { type: 'url', readonly: '', 'aria-label': '共有URL' }); input.value = url.href; output.append(input);
  try { await navigator.clipboard.writeText(url.href); output.append(node('p', '共有URLをコピーしました。', { role: 'status' })); }
  catch { output.append(node('p', '共有URLを選択してコピーしてください。', { role: 'status' })); input.focus(); input.select(); }
}
async function refresh() {
  root.replaceChildren();
  if (params.has('share')) {
    const { list } = await social('social.list.shared', { share_token: params.get('share') });
    heading(list.name); root.append(node('p', '共有リスト', { class: 'muted' })); renderGames(list.games, root); return;
  }
  if (!currentSession()) {
    heading('マイライブラリ'); root.append(node('p', 'ログインすると、いいねしたゲームやリスト、フォロー先を確認できます。'), node('a', 'ログインする', { href: '../login/' })); return;
  }
  const nav = node('nav', '', { class: 'library-tabs', 'aria-label': 'ライブラリの種類' });
  for (const [key, label] of [['lists', 'リスト'], ['likes', 'いいねしたゲーム'], ['following', 'フォロー中']]) nav.append(action(label, () => navigate(key), { 'aria-pressed': String(view === key) }));
  root.append(nav);
  if (view === 'likes') {
    heading('いいねしたゲーム'); root.append(node('p', 'この一覧はあなたにだけ表示されます。', { class: 'muted' }));
    const { games } = await social('social.likes'); renderGames(games, root, { remove: async game => { await social('social.like', { like_id: game.like_id, liked: 'false' }); await refresh(); } });
  } else if (view === 'following') {
    heading('フォロー中'); root.append(node('p', 'フォロー先はあなたにだけ表示されます。', { class: 'muted' }));
    const { following, has_more } = await social('social.following', { offset: followOffset });
    if (!following.length) root.append(node('p', 'まだフォローしていません。', { class: 'library-empty' }));
    for (const creator of following) {
      const section = node('section', '', { class: 'library-creator' }); section.append(node('h3', creator.name), action('フォローを解除', async () => { await social('social.follow', { follow_id: creator.follow_id, followed: 'false' }); await refresh(); }));
      renderGames(creator.games, section); root.append(section);
    }
    const pages = node('div', '', { class: 'library-row-actions' });
    if (followOffset) pages.append(action('前の25人', () => { followOffset -= 25; return refresh(); }));
    if (has_more) pages.append(action('次の25人', () => { followOffset += 25; return refresh(); }));
    root.append(pages);
  } else if (listId) {
    const { list } = await social('social.list.get', { list_id: listId }); currentList = list;
    root.append(action('← リスト一覧', () => navigate('lists'))); heading(list.name);
    root.append(nameForm('リスト名', list.name, async name => { await social('social.list.update', { list_id: listId, name }); await refresh(); }));
    const sharing = node('section', '', { class: 'library-sharing', 'aria-label': 'リストの共有' });
    sharing.append(node('p', list.share_token ? '共有リンクが有効です。ゲームの閲覧権限は変わりません。' : '本人専用のリストです。共有リンクを作成するとURLを知る人が閲覧できます。', { class: 'muted' }), action(list.share_token ? '共有URLをコピー' : '共有リンクを作成・コピー', copyShare));
    if (list.share_token) sharing.append(action('共有を停止', async () => { await social('social.list.share', { list_id: listId, operation: 'disable' }); await refresh(); }));
    sharing.append(node('div', '', { id: 'shareOutput' })); root.append(sharing);
    renderGames(list.games, root, { remove: async game => { await social('social.list.item', { list_id: listId, entry_id: game.entry_id, operation: 'remove' }); await refresh(); }, reorder: async entry_ids => { await social('social.list.order', { list_id: listId, entry_ids }); await refresh(); } });
    root.append(action('リストを削除', async () => {
      if (!confirm(`「${currentList.name}」を削除しますか？ゲーム本体は削除されません。`)) return;
      await social('social.list.delete', { list_id: listId, confirmation: 'delete' }); await navigate('lists');
    }, { class: 'danger' }));
  } else {
    heading('自分のリスト'); root.append(node('p', 'お気に入りのゲームをまとめましょう。リストは既定で本人専用です。', { class: 'muted' }));
    root.append(nameForm('新しいリスト名', '', async name => { const { list } = await social('social.list.create', { name }); await navigate('lists', list.id); }));
    const { lists } = await social('social.lists');
    const grid = node('div', '', { class: 'library-list-grid' });
    for (const list of lists) {
      const card = action('', () => navigate('lists', list.id), { class: 'library-list-card' });
      card.append(node('strong', list.name), node('span', `${list.item_count}作品 · ${list.share_token ? 'リンク共有中' : '本人専用'}`, { class: 'muted' })); grid.append(card);
    }
    if (!lists.length) grid.append(node('p', 'ゲームページの「リストに保存」からも作成できます。', { class: 'library-empty' })); root.append(grid);
  }
}
document.querySelector('[data-portal-login]').addEventListener('click', async event => {
  if (currentSession()) { event.preventDefault(); await logoutSessions(); location.href = '../'; }
});
requireTerms(document.getElementById('libraryConsent'), { buttonText: '同意してライブラリを開く', href: '../terms/' }).then(() => run(refresh));
