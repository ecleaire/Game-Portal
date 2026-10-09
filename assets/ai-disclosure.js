export const aiTypes = [['image','画像'],['audio','音声・音楽'],['text','テキスト'],['code','プログラム'],['other','その他']];
export function aiSummary(game) {
  if (game.ai_used == null) return 'AI利用：未申告';
  return game.ai_used ? `AI利用あり：${aiTypes.filter(([key]) => game.ai_types?.includes(key)).map(([,label]) => label).join('・')}` : 'AI利用なし';
}
export function aiDisclosure(form, game = {}) {
  const panel = document.createElement('fieldset'); panel.className = 'ai-disclosure';
  const legend = document.createElement('legend'); legend.textContent = 'AIの利用'; panel.append(legend);
  const check = (name, value, text, checked) => {
    const label = document.createElement('label'); label.className = 'ai-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.value = value; input.checked = checked;
    label.append(input, document.createTextNode(text)); return { label, input };
  };
  const used = check('ai_used','true','ゲーム制作や使用素材にAIを利用している',game.ai_used === true); panel.append(used.label);
  const detail = document.createElement('div'); detail.className = 'ai-types';
  const hint = document.createElement('p'); hint.className = 'muted'; hint.textContent = '利用したものを選択してください（複数選択可）。AI利用による投稿・公開の制限はありません。'; detail.append(hint);
  const options = aiTypes.map(([key,label]) => check('ai_types',key,label,game.ai_types?.includes(key)));
  options.forEach(option => detail.append(option.label)); panel.append(detail);
  const update = () => { detail.hidden = !used.input.checked; options.forEach(({input}) => { input.disabled = !used.input.checked; }); };
  used.input.addEventListener('change',update); update();
  return { element: panel, values: () => {
    const ai_used = used.input.checked; const ai_types = ai_used ? options.filter(({input}) => input.checked).map(({input}) => input.value) : [];
    if (ai_used && !ai_types.length) throw new Error('invalid_ai');
    return {ai_used,ai_types};
  }};
}
