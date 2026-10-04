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
export function tagPicker(tags, selected = [], { maximum = 8, title = 'タグ', onChange = () => {}, filter = false } = {}) {
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
