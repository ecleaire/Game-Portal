import { social, currentSession, node, gameLink, errorText } from './library-api.js?v=20261009b';
import { requireTerms } from './terms.js?v=20261008a';
import { logoutSessions } from './navigation.js?v=20261009b';
const root = document.getElementById('profile');
const message = document.getElementById('message');
const slug = new URLSearchParams(location.search).get('game');
const icons = { gamepad:'🎮', star:'⭐', rocket:'🚀', puzzle:'🧩', palette:'🎨', lightning:'⚡', cat:'🐱', fox:'🦊', panda:'🐼' };
let offset = 0, busy = false;
async function load() {
  if (busy) return;
  busy = true;
  root.querySelectorAll('button').forEach(button => button.disabled = true);
  message.textContent = 'プロフィールを読み込んでいます…';
  try {
    const result = await social('social.creator', { slug, offset });
    if (!offset) {
      root.replaceChildren();
      const header = node('section', '', { class:'profile-heading' });
      header.append(node('span', icons[result.creator.avatar_key] || icons.gamepad, { class:'profile-avatar', 'aria-hidden':'true' }), node('h2', result.creator.name));
      root.append(header, node('h3', '投稿したゲーム'), node('div', '', { id:'creatorGames', class:'library-list-grid' }));
      document.title = `${result.creator.name} | GAME PORTAL`;
    }
    document.getElementById('profileMore')?.remove();
    const grid = document.getElementById('creatorGames');
    for (const game of result.games) {
      const card = gameLink(game); card.className = 'library-list-card profile-game'; card.replaceChildren();
      card.append(node('strong', game.title), node('span', game.engine, { class:'muted' }));
      const tags = node('div', '', { class:'profile-tags' });
      for (const tag of (game.tags || []).slice(0,3)) tags.append(node('span', tag.name));
      card.append(tags); grid.append(card);
    }
    if (!offset && !result.games.length) grid.append(node('p', '表示できる作品はありません。'));
    offset += result.games.length;
    if (result.has_more) {
      const more = node('button', 'もっと見る', { type:'button', id:'profileMore' });
      more.onclick = load; root.append(more);
    }
    message.textContent = '';
  } catch (error) { message.textContent = errorText(error); }
  finally { busy = false; root.querySelectorAll('button').forEach(button => button.disabled = false); }
}
document.querySelector('[data-portal-login]').addEventListener('click', async event => {
  if (currentSession()) { event.preventDefault(); await logoutSessions(); location.href = '../'; }
});
requireTerms(document.getElementById('profileConsent'), { buttonText:'同意してプロフィールを見る', href:'../terms/' }).then(load);
