import { social, currentSession, node, errorText } from './library-api.js?v=20261010b';

export function gameSocial(slug, before, root = './') {
  document.getElementById('gameSocial')?.remove();
  if (!slug) return;
  const section = node('section', '', { id: 'gameSocial', class: 'social-panel', 'aria-label': 'いいね・保存・フォロー' });
  const actions = node('div', '', { class: 'social-actions' });
  const status = node('p', '', { role: 'status', 'aria-live': 'polite', class: 'social-status' });
  section.append(actions, status); before.before(section);
  let state, busy = false;
  const guarded = async (button, work) => {
    if (busy) return; busy = true; button.disabled = true;
    try { await work(); status.textContent = ''; }
    catch (error) { status.textContent = errorText(error); }
    finally { busy = false; if (button.isConnected) button.disabled = false; }
  };
  const render = () => {
    actions.replaceChildren();
    actions.append(node('a', `${state.creator} のプロフィール →`, { href: `${root}profile/?game=${encodeURIComponent(slug)}`, class: 'creator-profile-link' }));
    const like = node('button', `${state.liked ? '♥' : '♡'} いいね ${state.like_count}`, { type: 'button', 'aria-pressed': String(state.liked) });
    actions.append(like);
    if (!currentSession()) {
      like.onclick = () => { status.replaceChildren(node('span', 'いいねするにはログインしてください。 '), node('a', 'ログインする →', { href: `${root}login/` })); };
      actions.append(node('a', 'ログインして保存・フォロー', { href: `${root}login/` })); return;
    }
    like.onclick = () => guarded(like, async () => { state = await social('social.like', { slug, liked: String(!state.liked) }); render(); });
    const save = node('button', '＋ リストに保存', { type: 'button' });
    save.onclick = () => guarded(save, () => openLists(save)); actions.append(save);
    if (state.self !== true) {
      const follow = node('button', state.followed ? '✓ フォロー中' : '＋ 作者をフォロー', { type: 'button', 'aria-pressed': String(state.followed), title: state.creator });
      follow.onclick = () => guarded(follow, async () => { state = await social('social.follow', { slug, followed: String(!state.followed) }); render(); }); actions.append(follow);
    }
    actions.append(node('a', 'マイライブラリ →', { href: `${root}library/` }));
  };
  async function openLists(trigger) {
    const { lists } = await social('social.lists');
    const dialog = node('dialog', '', { class: 'library-dialog', 'aria-label': 'リストに保存' });
    const title = node('h2', 'リストに保存');
    const message = node('p', '', { role: 'status', 'aria-live': 'polite' });
    const rows = node('div', '', { class: 'library-list-choices' });
    const local = async (element, work) => {
      element.disabled = true;
      try { await work(); message.textContent = '保存しました。'; }
      catch (error) { message.textContent = errorText(error); }
      finally { element.disabled = false; }
    };
    const addChoice = list => {
      const label = node('label', '', { class: 'library-choice' });
      const check = node('input', '', { type: 'checkbox' }); check.checked = state.saved_list_ids.includes(list.id);
      label.append(check, node('span', list.name)); rows.append(label);
      check.onchange = () => local(check, async () => {
        const previous = !check.checked;
        try {
          if (check.checked) await social('social.list.item', { list_id: list.id, slug, operation: 'add' });
          else {
            const detail = await social('social.list.get', { list_id: list.id });
            const entry = detail.list.games.find(game => game.slug === slug);
            if (entry) await social('social.list.item', { list_id: list.id, entry_id: entry.entry_id, operation: 'remove' });
          }
          state = await social('social.game', { slug });
        } catch (error) { check.checked = previous; throw error; }
      });
    };
    lists.forEach(addChoice);
    const form = node('form', '', { class: 'library-create' });
    const input = node('input', '', { required: '', maxlength: '100', placeholder: '新しいリスト名', 'aria-label': '新しいリスト名' });
    const create = node('button', '作成して保存', { type: 'submit' }); form.append(input, create);
    form.onsubmit = event => { event.preventDefault(); local(create, async () => {
      const { list } = await social('social.list.create', { name: input.value });
      input.value = ''; addChoice(list);
      await social('social.list.item', { list_id: list.id, slug, operation: 'add' });
      state = await social('social.game', { slug }); rows.lastElementChild.querySelector('input').checked = true;
    }); };
    const close = node('button', '閉じる', { type: 'button' }); close.onclick = () => dialog.close();
    dialog.append(title, node('p', 'リストは本人専用です。共有はマイライブラリから設定できます。', { class: 'muted' }), rows, form, message, close);
    section.append(dialog); dialog.addEventListener('close', () => { dialog.remove(); trigger.focus(); }, { once: true }); dialog.showModal();
  }
  social('social.game', { slug }).then(result => { if (!section.isConnected) return; state = result; render(); })
    .catch(error => { if (section.isConnected) status.textContent = errorText(error); });
}
