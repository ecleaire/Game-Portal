import { test, expect } from '@playwright/test';
import { packageWebFiles } from '../../assets/zip-upload.js';
const endpoint='http://127.0.0.1:54321/functions/v1/portal';
async function api(request,action,data={},token){const response=await request.post(endpoint,{data:{action,data},headers:token?{'X-Portal-Session':token}:{}});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;}
test('super admin edits a pending submission and safely previews it without exposing drafts',async({page,context,request})=>{
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 await context.addInitScript(()=>localStorage.setItem('game-portal.terms.acceptance.v1',JSON.stringify({version:'2026-10-08',acceptedAt:new Date().toISOString()})));
 const admin=await api(request,'admin.login',{username:'browser_review_owner',password:'browser-review-admin-only'});
 await api(request,'admin.create',{username:'browser_review_author',password:'browser-review-only',role:'uploader'},admin.token);
 const author=await api(request,'user.login',{username:'browser_review_author',password:'browser-review-only',terms_accepted:true,terms_version:'2026-10-08'});
 const make=async(title,visibility)=>{
  const {submission}=await api(request,'user.submission.create',{title,engine:'other',version:'1',visibility,rights_confirmed:'yes',terms_accepted:true,terms_version:'2026-10-08'},author.token);
  const zip=await packageWebFiles([new File(['<!doctype html><html><body><p>Review game</p><script>document.body.dataset.isolated=String(parent!==window);try{parent.document.body.dataset.compromised="yes"}catch{};</script></body></html>'],'index.html')]);
  const response=await request.post(`${endpoint}/upload`,{headers:{'X-Portal-Session':author.token},multipart:{submission_id:submission.id,package:{name:'review.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.arrayBuffer())}}});expect(response.ok(),await response.text()).toBe(true);return submission;
 };
 const game=await make('Review tools game','public');const draft=await make('Private review draft','draft');
 await page.goto('admin/');await page.evaluate(token=>sessionStorage.setItem('game-portal.admin.session.v1',token),admin.token);await page.reload();
 const row=page.locator('#reviews > .row').filter({has:page.getByRole('heading',{name:game.title,exact:true})});
 const privateRow=page.locator('#reviews > .row').filter({has:page.getByRole('heading',{name:draft.title,exact:true})});
 await expect(page.getByRole('navigation',{name:'管理メニュー',exact:true}).getByRole('link',{name:'グループ',exact:true})).toHaveAttribute('href','#group-management');
 const search=page.getByRole('searchbox',{name:'投稿を検索',exact:true});await search.fill('missing title');await expect(row).toBeHidden();await search.fill('Review tools');await expect(row).toBeVisible();
 const filter=page.getByRole('combobox',{name:'投稿の絞り込み',exact:true});await filter.selectOption('rejected');await expect(row).toBeHidden();await filter.selectOption('pending');await expect(row).toBeVisible();await search.fill('');await filter.selectOption('');
 await page.getByRole('searchbox',{name:'ユーザーを検索',exact:true}).fill('browser_review_author');await expect(page.locator('#users > .row:not([hidden])')).toHaveCount(1);
 await page.getByRole('searchbox',{name:'ユーザーを検索',exact:true}).fill('');
 await expect(privateRow.getByRole('button',{name:'隔離してプレビュー'})).toHaveCount(0);await expect(privateRow.locator('.admin-game-editor')).toHaveCount(0);
 await row.getByRole('button',{name:'隔離してプレビュー',exact:true}).click();
 const frame=row.locator('iframe');await expect(frame).toHaveAttribute('sandbox','allow-scripts');await expect(page.frameLocator('.review-preview iframe').locator('p')).toHaveText('Review game');
 await expect(page.frameLocator('.review-preview iframe').locator('body')).toHaveAttribute('data-isolated','true');expect(await page.locator('body').getAttribute('data-compromised')).toBe(null);
 await row.getByRole('button',{name:'プレビューを閉じる',exact:true}).click();await expect(row.locator('iframe')).toHaveCount(0);
 const edit=row.locator('.admin-game-editor');await edit.locator(':scope > summary').click();
 await edit.getByLabel('説明（任意）',{exact:true}).fill('https://example.com');await edit.getByRole('button',{name:'作品の変更を保存',exact:true}).click();await expect(edit.locator('.upload-status')).toContainText('URLは素材の権利表記');
 await edit.getByLabel('説明（任意）',{exact:true}).fill('管理者が内容を確認しました。');await edit.getByLabel('素材の権利表記・提供元（任意）',{exact:true}).fill('https://example.com/credits');
 await edit.getByRole('checkbox',{name:'ゲーム制作や使用素材にAIを利用している',exact:true}).check();await edit.getByRole('checkbox',{name:'音声・音楽',exact:true}).check();
 await edit.getByLabel('公開範囲',{exact:true}).selectOption('unlisted');
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await edit.screenshot({path:`test-results/review-editor-${width}.png`});}
 await edit.getByRole('button',{name:'作品の変更を保存',exact:true}).click();await expect(page.locator('#message')).toContainText('作品情報と公開設定を保存しました');
 const updated=(await api(request,'user.submissions',{},author.token)).submissions.find(s=>s.id===game.id);expect(updated.description).toBe('管理者が内容を確認しました。');expect(updated.visibility).toBe('unlisted');expect(updated.ai_types).toEqual(['audio']);expect(updated.status).toBe('pending');
 expect((await api(request,'admin.audit',{},admin.token)).events.some(e=>e.action==='admin.submission.save'&&e.target_id===game.id)).toBe(true);
 for(const s of [game,draft])await api(request,'user.submission.delete',{submission_id:s.id,title:s.title,confirmation:'delete'},author.token);
});
