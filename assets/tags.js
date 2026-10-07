import { config } from './config.js';
export const tagCategories = ['ジャンル','プレイ形式','画面・視点','操作','ゲームの特徴','雰囲気・デザイン','開発環境','対応環境'];
export async function loadTags() {
  if (!config.supabaseUrl) return [];
  const response = await fetch(`${config.supabaseUrl}/functions/v1/portal/tags`, {
    method: 'POST', headers: config.anonKey ? { apikey: config.anonKey } : {}, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('unavailable');
  return (await response.json()).tags;
}
function node(tag, text, className) {
  const n = document.createElement(tag); if (text != null) n.textContent = text;
  if (className) n.className = className; return n;
}
export function tagChips(tags = [], limit = Infinity, home = '../') {
  const list = node('div', null, 'tag-chips'); list.setAttribute('aria-label', 'ゲームタグ');
  for (const tag of tags.slice(0, limit)) {
    const chip = node('a', tag.name, 'tag-chip'); chip.href = `${home}?tag=${encodeURIComponent(tag.slug)}#games`;
    list.append(chip);
  }
  if (tags.length > limit) list.append(node('span', `+${tags.length-limit}`, 'tag-chip tag-overflow'));
  return list;
}
// A shared accessible picker for submission, editing, moderation and filtering.
export function tagPicker(tags, selected = [], { maximum = 22, title = 'タグ', onChange = () => {}, filter = false } = {}) {
  const picked = new Set(selected.map(t => typeof t === 'string' ? t : t.id));
  const box = node('fieldset', null, 'tag-picker'); box.append(node('legend', title));
  const counter = node('p', '', 'tag-count'); counter.setAttribute('aria-live','polite'); box.append(counter);
  const controls = [];
  const categories = [...new Set(tags.map(t=>t.category))].sort((a,b)=>{
    const ai=tagCategories.indexOf(a),bi=tagCategories.indexOf(b);
    return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b,'ja');
  });
  const update = () => {
    counter.textContent = filter ? `選択中 ${picked.size} · すべてのタグに一致` : `選択中 ${picked.size} / ${maximum}`;
    for (const [button,tag] of controls) {
      const active = picked.has(tag.id); button.setAttribute('aria-pressed',String(active));
      button.disabled = !active && ((!tag.is_active && !filter) || picked.size>=maximum);
    }
  };
  for (const category of categories) {
    const details=node('details'); details.open=filter ? tags.some(t=>t.category===category&&picked.has(t.id))
      : (picked.size===0 && category===categories[0]) || tags.some(t=>t.category===category&&picked.has(t.id));
    details.append(node('summary',category)); const chips=node('div',null,'tag-chips'); details.append(chips);
    for (const tag of tags.filter(t=>t.category===category)) {
      const b=node('button',tag.name+(tag.is_active ? '' : '（無効）'),'tag-chip'); b.type='button';
      b.addEventListener('click',()=>{if(picked.has(tag.id)) picked.delete(tag.id); else if((tag.is_active||filter)&&picked.size<maximum) picked.add(tag.id); update(); onChange([...picked]);});
      controls.push([b,tag]); chips.append(b);
    }
    box.append(details);
  }
  if (!tags.length) box.append(node('p','選択できるタグはありません。'));
  update(); return { element:box, values:()=>[...picked] };
}

export function tagFilter(tags, selected = [], onChange = () => {}, { disclosure = null } = {}) {
  const picked = new Set(selected.map(tag => tag.id));
  let category = tagCategories.find(value => tags.some(tag => tag.category === value)) ?? tags[0]?.category;
  const box = node('div', null, 'tag-filter');
  const bar = node('div', null, 'tag-filter-bar');
  const toggle = disclosure ? disclosure.querySelector('summary') : node('button', null, 'tag-filter-toggle');
  const badge = node('span', '', 'tag-filter-badge');
  if (!disclosure) {
    toggle.type = 'button';
    toggle.append(node('span', '☷', 'tag-filter-icon'), node('span', 'タグで絞り込み'), badge, node('span', '⌄', 'tag-filter-chevron'));
    toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'tag-filter-panel');
    bar.append(toggle);
  }
  const selection = node('div', null, 'tag-filter-selection'); selection.setAttribute('aria-label', '選択中のタグ');
  const clear = node('button', 'クリア', 'tag-filter-clear'); clear.type = 'button'; clear.setAttribute('aria-label', 'タグをすべて解除');
  bar.append(selection, clear); box.append(bar);
  const panel = node('section', null, 'tag-filter-panel'); panel.id = 'tag-filter-panel'; panel.hidden = !disclosure;
  panel.setAttribute('aria-label', 'タグを選ぶ');
  const header = node('div', null, 'tag-filter-heading');
  header.append(node('strong', 'タグで絞り込み'));
  const close = node('button', '閉じる', 'tag-filter-close'); close.type = 'button';
  if (!disclosure) header.append(close);
  const search = node('input'); search.type = 'search'; search.placeholder = 'タグを検索'; search.setAttribute('aria-label', 'タグを検索');
  const categories = node('div', null, 'tag-filter-categories'); categories.setAttribute('aria-label', 'タグのカテゴリ');
  const names = [...new Set([...tagCategories, ...tags.map(tag => tag.category)])].filter(value => tags.some(tag => tag.category === value));
  const tabs = names.map(name => {
    const b = node('button', name); b.type = 'button';
    b.addEventListener('click', () => { category = name; search.value = ''; renderOptions(); }); categories.append(b); return [b, name];
  });
  const options = node('div', null, 'tag-chips tag-filter-options');
  const hint = node('p', '複数選択すると、すべてのタグに一致する作品を表示します。', 'tag-filter-hint');
  panel.append(header, search, categories, options, hint); box.append(panel);
  const setOpen = open => {
    if (disclosure) disclosure.open = open;
    else { panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); }
  };
  if (!disclosure) toggle.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => { setOpen(false); toggle.focus(); });
  box.addEventListener('keydown', event => { if (event.key === 'Escape') { setOpen(false); toggle.focus(); } });
  function change(id) { if (picked.has(id)) picked.delete(id); else picked.add(id); update(); onChange([...picked]); }
  function renderOptions() {
    const keyword = search.value.trim().toLowerCase(); options.replaceChildren();
    for (const [tab, name] of tabs) tab.setAttribute('aria-pressed', String(!keyword && name === category));
    for (const tag of tags.filter(tag => keyword ? `${tag.name} ${tag.slug}`.toLowerCase().includes(keyword) : tag.category === category)) {
      const b = node('button', tag.name, 'tag-chip'); b.type = 'button'; b.setAttribute('aria-pressed', String(picked.has(tag.id)));
      b.dataset.tagId = tag.id;
      b.addEventListener('click', () => { change(tag.id); options.querySelector(`[data-tag-id="${tag.id}"]`)?.focus(); }); options.append(b);
    }
    if (!options.children.length) options.append(node('p', '一致するタグはありません。', 'tag-filter-hint'));
  }
  function update() {
    badge.textContent = String(picked.size); badge.hidden = !picked.size; clear.hidden = !picked.size;
    if (disclosure) bar.hidden = !picked.size;
    selection.replaceChildren();
    for (const tag of tags.filter(tag => picked.has(tag.id))) {
      const b = node('button', `${tag.name} ×`, 'tag-chip'); b.type = 'button'; b.setAttribute('aria-label', `${tag.name}を解除`);
      b.addEventListener('click', () => { change(tag.id); toggle.focus(); }); selection.append(b);
    }
    renderOptions();
  }
  search.addEventListener('input', renderOptions);
  clear.addEventListener('click', () => { picked.clear(); update(); onChange([]); toggle.focus(); });
  update(); return box;
}
