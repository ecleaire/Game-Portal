// Shared account/upload history controls. Preferences stay in this browser tab
// and are scoped to the authenticated user; no server publication order changes.
export function submissionList(parent, games, { userId, renderCard, statusLabel, visibilityLabel }) {
  const node = (tag, text, attrs = {}) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  };
  const key = `game-portal.submission-list.${userId}.v1`;
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(key) ?? '{}') ?? {}; } catch { /* Storage can be unavailable. */ }
  const choices = [['created_at','投稿日'], ['updated_at','更新日'], ['title','ゲーム名'], ['engine','エンジン'], ['status','状態'], ['manual','自分で並べる']];
  const preferences = {
    search: typeof saved.search === 'string' ? saved.search : '',
    sort: choices.some(([value]) => value === saved.sort) ? saved.sort : 'created_at',
    direction: saved.direction === 'asc' ? 'asc' : 'desc',
    status: games.some(game => game.status === saved.status) ? saved.status : '',
    order: Array.isArray(saved.order) ? saved.order.filter(id => typeof id === 'string') : [],
  };
  const initial = [...games].sort((a,b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || a.id.localeCompare(b.id));
  const ids = new Set(games.map(game => game.id));
  preferences.order = [...new Set([...preferences.order.filter(id => ids.has(id)), ...initial.map(game => game.id)])];
  const toolbar = node('div', '', { class: 'submission-tools' });
  const control = (labelText, element) => {
    const label = node('label', labelText); element.setAttribute('aria-label', labelText); label.append(element); toolbar.append(label); return element;
  };
  const search = control('投稿を検索', node('input', '', { type: 'search', placeholder: 'ゲーム名・説明・バージョン', maxlength: '200' }));
  search.value = preferences.search;
  const select = (label, options, value) => {
    const element = node('select');
    for (const [id, title] of options) element.append(node('option', title, { value: id }));
    element.value = value; return control(label, element);
  };
  const status = select('状態で絞り込み', [['','すべて'], ...[...new Set(games.map(game => game.status))].map(value => [value,statusLabel(value)])], preferences.status);
  const sort = select('並び替え', choices, preferences.sort);
  const direction = select('順序', [['desc','降順'], ['asc','昇順']], preferences.direction);
  const count = node('p', '', { class: 'muted submission-count', role: 'status', 'aria-live': 'polite' });
  const list = node('div', '', { class: 'submission-list submission-scroll', role: 'region', 'aria-label': '投稿ゲーム一覧', tabindex: '0' });
  const cards = new Map();
  let shown = [];
  parent.append(toolbar, count, list);
  const persist = () => { try { sessionStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Controls still work without persistence. */ } };
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
  function render() {
    direction.disabled = preferences.sort === 'manual';
    const query = preferences.search.normalize('NFKC').toLocaleLowerCase().trim();
    const words = query.split(/\s+/).filter(Boolean);
    const rank = new Map(preferences.order.map((id,index) => [id,index]));
    const visible = games.filter(game => {
      const text = [game.title,game.description,game.engine,game.version,game.controls,statusLabel(game.status),visibilityLabel(game.visibility)].join(' ').normalize('NFKC').toLocaleLowerCase();
      return (!preferences.status || game.status === preferences.status) && words.every(word => text.includes(word));
    }).sort((a,b) => {
      if (preferences.sort === 'manual') return rank.get(a.id) - rank.get(b.id);
      const field = preferences.sort;
      const value = game => field === 'status' ? statusLabel(game.status) : String(game[field] ?? '');
      const comparison = field.endsWith('_at') ? value(a).localeCompare(value(b)) : collator.compare(value(a),value(b));
      return comparison * (preferences.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
    });
    shown = visible;
    list.replaceChildren(); list.scrollTop = 0;
    count.textContent = `${visible.length} / ${games.length}件${games.length === 100 ? '（最新100件）' : ''}`;
    if (!visible.length) list.append(node('p', games.length ? '条件に一致する投稿がありません。' : '投稿したゲームはまだありません。', { class: 'muted submission-empty' }));
    visible.forEach((game,index) => {
      if (!cards.has(game.id)) {
        const card = renderCard(game);
        const moves = node('div', '', { class: 'submission-moves' });
        for (const [step,label] of [[-1,'上へ'],[1,'下へ']]) {
          const button = node('button', label, { type: 'button', 'aria-label': `「${game.title}」を${label}`, 'data-step': String(step) });
          button.addEventListener('click', () => {
            if (preferences.sort !== 'manual' || parent.closest('[aria-busy="true"]')) return;
            const target = shown[shown.findIndex(item => item.id === game.id) + step]; if (!target) return;
            const from = preferences.order.indexOf(game.id), to = preferences.order.indexOf(target.id);
            [preferences.order[from],preferences.order[to]] = [preferences.order[to],preferences.order[from]];
            persist(); render();
            if (!button.disabled) button.focus(); else card.querySelector('a')?.focus();
          });
          moves.append(button);
        }
        card.lastElementChild.append(moves);
        cards.set(game.id, card);
      }
      const card = cards.get(game.id);
      const moves = card.querySelector('.submission-moves'); moves.hidden = preferences.sort !== 'manual';
      for (const button of moves.querySelectorAll('button')) {
        button.disabled = Number(button.dataset.step) === -1 ? index === 0 : index === visible.length - 1;
      }
      list.append(card);
    });
  }
  const update = () => { preferences.search = search.value; preferences.status = status.value; preferences.sort = sort.value; preferences.direction = direction.value; persist(); render(); };
  search.addEventListener('input', update);
  for (const select of [status,sort,direction]) select.addEventListener('change', update);
  render();
}
