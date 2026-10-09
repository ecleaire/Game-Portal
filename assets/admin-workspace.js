function node(tag, text, attrs = {}) {
  const element = document.createElement(tag); element.textContent = text;
  for (const [key,value] of Object.entries(attrs)) element.setAttribute(key,value);
  return element;
}
// Filter only the server-authorized records already loaded on this page.
export function collectionTools(container, { label, rows = ':scope > .row', states = [] }) {
  const existing=container.querySelector(':scope > .collection-tools');
  if(existing){existing.querySelector('input').dispatchEvent(new Event('input'));return;}
  const bar = node('div','',{class:'collection-tools'});
  const search = node('input','',{type:'search',placeholder:`${label}を検索`,'aria-label':`${label}を検索`});
  const state = node('select','',{'aria-label':`${label}の絞り込み`});
  state.append(node('option','すべて',{value:''}));
  for (const [value,text] of states) state.append(node('option',text,{value}));
  state.hidden = !states.length;
  const count = node('span','',{class:'collection-count',role:'status','aria-live':'polite'});
  const reset = node('button','クリア',{type:'button'});
  bar.append(search,state,reset,count);
  const heading=container.querySelector(':scope > h2');if(heading)heading.after(bar);else container.prepend(bar);
  function update() {
    const items = [...container.querySelectorAll(rows)];
    const query=search.value.normalize('NFKC').toLocaleLowerCase().trim();let visible=0;
    for(const row of items) {
      row.hidden=Boolean((query&&!row.textContent.normalize('NFKC').toLocaleLowerCase().includes(query))||(state.value&&row.dataset.filterState!==state.value));
      if(!row.hidden)visible++;
    }
    count.textContent=`表示 ${visible} / ${items.length}件`;
  }
  search.addEventListener('input',update);state.addEventListener('change',update);
  reset.addEventListener('click',()=>{search.value='';state.value='';update();search.focus();});
  update();
}
export function organizeAdmin(root) {
  const targets=[['reviews','投稿の審査'],['users','ユーザー'],['group-management','グループ'],['reports','報告'],['tag-management','タグ'],['moderation-management','禁止語']].filter(([id])=>root.querySelector(`#${id}`));
  const nav=node('nav','',{class:'admin-workspace-nav','aria-label':'管理メニュー'});
  for(const [id,label] of targets)nav.append(node('a',label,{href:`#${id}`}));
  root.prepend(nav);root.classList.add('admin-workspace');
  root.querySelector('.dashboard-jumps')?.remove();
  const users=root.querySelector('#users');if(users)collectionTools(users,{label:'ユーザー',states:[['active','利用中'],['banned','BAN中'],['disabled','無効'],['admin','管理アカウント']]});
  const reviews=root.querySelector('#reviews');if(reviews)collectionTools(reviews,{label:'投稿',states:[['pending','審査待ち'],['approved','承認済み'],['rejected','却下'],['uploading','ファイル未保存']]});
}
