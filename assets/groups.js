import { aiDisclosure, aiSummary } from './ai-disclosure.js?v=20261010b';
// Group names and membership are fetched only through the authenticated API.
export function groupFields({ el, form, groups, game = {} }) {
  const area = el('fieldset', null, { class: 'group-audience' });
  area.append(el('legend', 'グループへの共有'));
  if (!groups.length) area.append(el('p', '所属グループはありません。所属は管理者が設定します。', { class: 'muted' }));
  for (const group of groups) {
    const label = el('label', null, { class: 'group-chip' });
    const input = el('input', null, { type: 'checkbox', name: 'group_ids', value: group.id });
    input.checked = (game.group_ids ?? []).includes(group.id) || (!game.id && groups.length === 1);
    label.append(input, el('span', group.name)); area.append(label);
  }
  const update = () => {
    area.hidden = form.elements.visibility.value !== 'group';
    area.querySelectorAll('input').forEach(input => { input.disabled = area.hidden; });
  };
  form.elements.visibility.addEventListener('change', update); update();
  return area;
}
export function groupData(form) {
  // run() disables every control during saving. The selected audience must not
  // disappear just because those checked inputs are temporarily locked.
  return { group_ids: form.elements.visibility.value === 'group'
    ? [...form.querySelectorAll('.group-audience input:checked')].map(input => input.value) : [] };
}

export async function groupManagement(parent, tools, admin) {
  const { el, section, field, form, button, api, notice, username, password, role } = tools;
  const global = admin.role === 'super_admin';
  const main = section('グループ管理', parent, 'group-management'); main.id = 'group-management';
  const { groups } = await api('admin.groups');
  if (global) form(main, [field('name', '新しいグループ名', 'text', { maxlength: '80' }), field('description','グループ概要（任意）','textarea',{optional:true,maxlength:'2000',rows:'3'})], 'グループを作成', async data => {
    await api('admin.group.create', data); await refresh(); notice('グループを作成しました。');
  });
  const list = el('div', null, { class: 'group-list' }); const detail = el('div', null, { class: 'group-detail' }); main.append(list, detail);
  let updateParticipation;
  async function refresh() {
    const current = await api('admin.groups'); list.replaceChildren(); detail.replaceChildren();
    if (!current.groups.length) list.append(el('p', '担当グループはありません。サイト管理者が担当を設定すると表示されます。', { class: 'muted' }));
    for (const group of current.groups) {
      const card = el('article', null, { class: 'row' });
      card.append(el('h3', group.name), el('p', `${group.member_count}人 · ${group.active ? '利用中' : '無効'} · ${group.restrict_sharing ? 'グループ内の共有に限定' : '外部公開も選択可'}`, { class: 'muted' }));
      if (group.description) card.append(el('p',group.description,{class:'muted'}));
      if (global || group.active) button(card, '所属・設定を開く', () => open(group.id)); list.append(card);
    }
    tools.collectionTools(list,{label:'グループ'});
    if (updateParticipation) await updateParticipation();
  }
  async function open(groupId) {
    const { group, members, managers } = await api('admin.group.detail', { group_id: groupId }); detail.replaceChildren();
    const header = section(group.name, detail);
    if (global) form(header, [field('name', 'グループ名', 'text', { value: group.name, maxlength: '80' }),field('description','グループ概要（任意）','textarea',{value:group.description,optional:true,maxlength:'2000',rows:'3'}),
      field('active', 'グループの状態', 'select', { value: String(group.active), choices: [['true','利用中'],['false','無効（共有と管理を停止）']] }),
      field('restrict_sharing', '所属ユーザーの公開範囲', 'select', { value: String(group.restrict_sharing), choices: [['true','下書き・グループ共有のみ'],['false','公開・限定公開・個別共有も許可']] })], 'グループ設定を保存', async data => {
        await api('admin.group.update', { ...data, group_id: groupId }); await refresh(); notice('グループ設定を保存しました。');
      });
    if (!global) form(header, [field('name', 'グループ名', 'text', { value: group.name, maxlength: '80' }),field('description','グループ概要（任意）','textarea',{value:group.description,optional:true,maxlength:'2000',rows:'3'})], 'グループ設定を保存', async data => {
      await api('admin.group.rename', { ...data, group_id: groupId }); await refresh(); notice('グループ設定を保存しました。');
    });
    const create = section('このグループのアカウントを作成', detail);
    form(create, [username(), password('password','初期パスワード'), role(false)], '所属アカウントを作成', async data => {
      const result = await api('admin.group.account.create', { ...data, group_id: groupId }); await refresh(); await open(groupId);
      notice(`アカウントを作成して所属させました。ID: ${result.user_id}`);
    });
    const roster = section('所属ユーザー', detail);
    form(roster, [field('user_id', '追加するアカウントID', 'text', { placeholder: 'ユーザーのアカウント画面に表示されるID' })], '所属に追加', async data => {
      await api('admin.group.member', { ...data, group_id: groupId, operation: 'add' }); await open(groupId); notice('所属に追加しました。');
    });
    if (!members.length) roster.append(el('p','所属ユーザーはまだいません。',{class:'muted'}));
    const scroll = el('div', null, { class: 'group-roster' }); roster.append(scroll);
    for (const member of members) {
      const row = el('article', null, { class: 'row' }); row.append(el('h3', member.username), el('p', `${member.role === 'player' ? 'プレイ専用' : '投稿可能'} · ${member.status}`, { class: 'muted' }));
      button(row, '所属から外す', async () => {
        if (!confirm(`${member.username} を ${group.name} から外しますか？グループ共有の閲覧権限が失われます。アカウントは削除されません。`)) return;
        await api('admin.group.member', { user_id: member.id, group_id: groupId, operation: 'remove' }); await open(groupId); notice('所属から外しました。');
      }, true); scroll.append(row);
    }
    if (global) {
      const staff = section('担当グループ管理者', detail);
      form(staff, [field('admin_id', 'グループ管理者のアカウントID', 'text')], '担当に追加', async data => {
        await api('admin.group.manager', { ...data, group_id: groupId, operation: 'add' }); await open(groupId); notice('担当に追加しました。');
      });
      for (const manager of managers) {
        const row = el('div', null, { class: 'row' }); row.append(el('h3', manager.username));
        button(row, '担当を解除', async () => { await api('admin.group.manager', { admin_id: manager.id, group_id: groupId, operation: 'remove' }); await open(groupId); notice('担当を解除しました。'); }); staff.append(row);
      }
    }
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  await refresh(); updateParticipation = await groupParticipation(parent, tools); return groups;
}

async function groupParticipation(parent, { el, section, button, api, notice }) {
  const area = section('グループへの参加・閲覧', parent);
  area.append(el('p', '参加するとグループ共有作品を閲覧できます。参加によって管理権限は増えません。', { class: 'muted' }));
  const list = el('div', null, { class: 'group-list' }); const games = el('div', null, { class: 'group-roster' }); area.append(list, games);
  async function refresh() {
    const { groups } = await api('admin.group.directory'); list.replaceChildren(); games.replaceChildren();
    for (const group of groups) {
      const row = el('div', null, { class: 'row' }); row.append(el('h3', group.name), el('p', `${group.joined ? '参加中' : '未参加'}${group.manages ? ' · 管理担当' : ''}`, { class: 'muted' }));
      if (group.description) row.append(el('p',group.description,{class:'muted'}));
      button(row, group.joined ? '退出する' : '参加する', async () => {
        await api('admin.group.membership', { group_id: group.id, operation: group.joined ? 'leave' : 'join' }); await refresh(); notice(group.joined ? '退出しました。' : '参加しました。');
      }); list.append(row);
    }
    const shared = await api('admin.shared.games');
    for (const game of shared.games) {
      const row = el('article', null, { class: 'row' }); row.append(el('h3', game.title), el('a', '作品を開く', { href: `../game.html?slug=${encodeURIComponent(game.public_slug)}` })); games.append(row);
    }
    if (!shared.games.length) games.append(el('p', '参加グループの共有作品はまだありません。', { class: 'muted' }));
  }
  await refresh(); return refresh;
}

export async function scopedDashboard(root, tools, admin) {
  const { el, section, field, form, button, api, notice, logoutButton, reviewSubmission, downloadSubmission, repairPublication, gameTagPicker, tagChips, statusBadge } = tools;
  const top = section(`グループ管理 — ${admin.username}`, root); logoutButton(top);
  const groups = await groupManagement(root, tools, admin);
  const sectionGames = section('担当グループの作品', root);
  sectionGames.id='reviews';
  let offset = 0;
  const list = el('div', null, { class: 'group-games' }); const pages = el('div', null, { class: 'actions' }); sectionGames.append(list, pages);
  async function load() {
    const { submissions } = await api('admin.submissions', { offset }); list.replaceChildren(); pages.replaceChildren();
    if (!submissions.length) list.append(el('p', '管理する作品はありません。所属ユーザーが管理グループを設定した作品が表示されます。下書きは表示されません。', { class: 'muted' }));
    for (const game of submissions) {
      const row = el('article', null, { class: 'row' });
      row.dataset.filterState=game.status;
      row.dataset.searchText=[game.title,game.username,game.engine,game.description,game.version,...(game.tags??[]).map(tag=>tag.name)].join(' ');
      row.append(statusBadge(game), el('h3', game.title), el('p', `投稿者: ${game.username}`, { class: 'muted' }), tagChips(game.tags));
      if (game.description) row.append(el('p', game.description));
      if (game.credits) row.append(el('h4','素材の権利表記・提供元'),el('p',game.credits,{class:'game-credits'}));
      row.append(el('p',aiSummary(game),{class:'muted'}));
      if (['pending','approved','rejected'].includes(game.status)) {
        button(row,'ZIPを安全にダウンロード',()=>downloadSubmission(game.id));
        button(row,'隔離してプレビュー',()=>tools.previewReview(game,row));
      }
      if (game.status==='pending') {
        button(row,'承認して共有設定を反映',()=>reviewSubmission(game.id,'approved'));
        button(row,'却下',async()=>{const reason=prompt('却下理由（任意・500文字まで）','');if(reason!==null)await reviewSubmission(game.id,'rejected',reason);},true);
      }
      if (game.status==='approved' && !game.package_ready) button(row,'配信用ファイルを準備',()=>repairPublication(game.id));
      if (game.status==='approved') button(row,'公開を停止',async()=>{await api('admin.submission.unpublish',{submission_id:game.id,reason:'グループ管理者による停止'});await load();notice('公開を停止しました。');},true);
      if (['pending','approved','rejected'].includes(game.status)) {
        const edit=el('details',null,{class:'tag-review-editor'});edit.append(el('summary','作品情報・共有設定を編集'));row.append(edit);
        const picker=gameTagPicker(game);
        const editForm=form(edit,[field('title','ゲーム名','text',{value:game.title,maxlength:'120'}),field('engine','エンジン','select',{value:game.engine,choices:[['godot','Godot'],['scratch','Scratch / TurboWarp'],['other','その他']]}),
          field('description','説明','textarea',{value:game.description,optional:true,maxlength:'4000'}),field('version','バージョン','text',{value:game.version,maxlength:'80'}),field('controls','操作説明','textarea',{value:game.controls,optional:true,maxlength:'2000'}),
          field('credits','素材の権利表記・提供元（任意）','textarea',{value:game.credits,optional:true,maxlength:'8000',rows:'5'}),
          field('release_notes','このバージョンの更新内容（任意）','textarea',{value:game.release_notes ?? '',optional:true,maxlength:'2000',rows:'3'}),
          field('visibility','公開範囲','select',{value:game.visibility==='group'?'group':'draft',choices:[['group','グループ内で共有'],['draft','下書きに戻す（本人だけ）']]}),field('published_at','公開日時（空欄で即時）','datetime-local',{optional:true,value:game.published_at?new Date(new Date(game.published_at)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):''})],
          '作品の変更を保存',async data=>{Object.assign(data,ai.values());data.group_ids=game.visibility==='group'?game.group_ids:[game.management_group_id];data.tag_ids=picker.values();data.published_at=data.published_at?new Date(data.published_at).toISOString():'';await api('admin.submission.save',{...data,submission_id:game.id});await load();notice('作品の変更を保存しました。');});
        const ai=aiDisclosure(editForm,game);
        editForm.querySelector('button[type=submit]').before(picker.element,ai.element);
        tools.protectEdits(editForm);
      }
      list.append(row);
    }
    if(offset>0)button(pages,'前の100件',async()=>{offset-=100;await load();});
    if(submissions.length===100)button(pages,'次の100件',async()=>{offset+=100;await load();});
    button(pages,'作品一覧を更新',load);
    tools.collectionTools(sectionGames,{label:'投稿',rows:'.group-games > .row',states:[['pending','審査待ち'],['approved','承認済み'],['rejected','却下'],['uploading','ファイル未保存']]});
  }
  await load();
}
