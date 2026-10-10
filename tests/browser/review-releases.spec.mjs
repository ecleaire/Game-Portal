import { test, expect } from '@playwright/test';
import { packageWebFiles } from '../../assets/zip-upload.js';
const endpoint='http://127.0.0.1:54321/functions/v1/portal';
async function api(request,action,data={},token) {
 const response=await request.post(endpoint,{data:{action,data},headers:token?{'X-Portal-Session':token}:{}});
 const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;
}
test('review inbox, member catalog, edit protection, release history and download stages work together',async({page,context,request})=>{
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 await context.addInitScript(()=>localStorage.setItem('game-portal.terms.acceptance.v1',JSON.stringify({version:'2026-10-08',acceptedAt:new Date().toISOString()})));
 const admin=await api(request,'admin.login',{username:'browser_release_owner',password:'browser-release-admin-only'});
 await api(request,'admin.create',{username:'browser_release_author',password:'browser-release-user-only',role:'uploader'},admin.token);
 const author=await api(request,'user.login',{username:'browser_release_author',password:'browser-release-user-only',terms_accepted:true,terms_version:'2026-10-08'});
 await api(request,'user.profile',{display_name:'W'.repeat(40),avatar_key:'gamepad'},author.token);
 const group=(await api(request,'admin.group.create',{name:'Release community',description:'Shared works'},admin.token)).group;
 await api(request,'admin.group.member',{group_id:group.id,user_id:author.user.id,operation:'add'},admin.token);
 const {submission:game}=await api(request,'user.submission.create',{title:'Release stages game',engine:'other',version:'1',visibility:'group',management_group_id:group.id,group_ids:[group.id],release_notes:'Initial release',rights_confirmed:'yes',terms_version:'2026-10-08'},author.token);
 const zip=await packageWebFiles([new File(['<!doctype html><html><body>Release stages</body></html>'],'index.html')]);
 const uploaded=await request.post(`${endpoint}/upload`,{headers:{'X-Portal-Session':author.token},multipart:{submission_id:game.id,package:{name:'stages.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.arrayBuffer())}}});expect(uploaded.ok(),await uploaded.text()).toBe(true);
 const reviewed=await request.post(`${endpoint}/review`,{headers:{'X-Portal-Session':admin.token},data:{submission_id:game.id,decision:'approved',reason:'Ready to share'}});expect(reviewed.ok(),await reviewed.text()).toBe(true);
 await page.goto('account/');await page.evaluate(token=>sessionStorage.setItem('game-portal.user.session.v1',token),author.token);await page.reload();
 const inbox=page.locator('section').filter({has:page.getByRole('heading',{name:'審査結果のお知らせ',exact:true})}).first();
 await expect(inbox).toContainText('未読 1件');await expect(inbox).toContainText('Ready to share');
 await inbox.getByRole('button',{name:'既読にする'}).click();await expect(page.getByText('未読のお知らせはありません。',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByText('未読のお知らせはありません。',{exact:true})).toBeVisible();
 const catalog=page.locator('section').filter({has:page.getByRole('heading',{name:'グループ内の作品',exact:true})}).first();
 await expect(catalog).toContainText(game.title);await page.getByRole('searchbox',{name:'グループ作品を検索'}).fill('missing');await expect(catalog).not.toContainText(game.title);
 await page.getByRole('searchbox',{name:'グループ作品を検索'}).fill('');await expect(catalog).toContainText(game.title);
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/review-inbox-${width}.png`,fullPage:true});}
 await page.goto(`account/?game=${game.id}`);
 await page.getByLabel('ゲーム名',{exact:true}).fill('Edited release game');
 page.once('dialog',dialog=>{expect(dialog.type()).toBe('confirm');dialog.dismiss();});
 await page.getByRole('link',{name:'← 投稿一覧に戻る'}).click();await expect(page.getByLabel('ゲーム名',{exact:true})).toHaveValue('Edited release game');
 page.once('dialog',dialog=>{expect(dialog.type()).toBe('beforeunload');dialog.dismiss();});
 await page.reload({timeout:1500}).catch(error=>expect(error.message).toMatch(/Timeout|ERR_ABORTED/));
 await expect(page.getByLabel('ゲーム名',{exact:true})).toHaveValue('Edited release game');
 await page.getByLabel('バージョン',{exact:true}).fill('2');await page.getByLabel('このバージョンの更新内容（任意）',{exact:true}).fill('New stages');
 await page.getByRole('button',{name:'変更を保存',exact:true}).click();await expect(page.locator('#message')).toContainText('変更を保存しました');
 await expect(page.locator('.release-history')).toContainText('New stages');
 // A successful save must not produce a spurious leave confirmation.
 let dialogs=0;const count=()=>dialogs++;page.on('dialog',count);
 await page.getByRole('link',{name:'← 投稿一覧に戻る'}).click();await expect(page.getByRole('heading',{name:'アカウント',exact:true})).toBeVisible();page.off('dialog',count);expect(dialogs).toBe(0);
 await page.goto(`account/?game=${game.id}`);await page.getByLabel('ゲーム名',{exact:true}).fill('Unsaved title');
 page.once('dialog',dialog=>{expect(dialog.type()).toBe('confirm');dialog.accept();});
 await page.getByRole('link',{name:'← 投稿一覧に戻る'}).click();await expect(page.getByRole('heading',{name:'アカウント',exact:true})).toBeVisible();
 let releaseDownload;
 const gate=new Promise(resolve=>{releaseDownload=resolve;});
 await page.route('**/portal/shared-package',async route=>{await gate;await route.continue();});
 await page.goto(`game.html?slug=${game.public_slug}`);
 await expect(page.locator('#loading')).toContainText('秒');await expect(page.locator('#gameTitle')).toHaveText('Edited release game');releaseDownload();
 await expect(page.locator('#playerStatus')).toHaveText('ゲームを表示しました');await expect(page.locator('#releaseHistory')).toContainText('New stages');await expect(page.locator('#releaseHistory')).toContainText('Initial release');
 await expect(page.frameLocator('#gameFrame').locator('body')).toHaveText('Release stages');
 await api(request,'user.submission.delete',{submission_id:game.id,title:'Edited release game',confirmation:'delete'},author.token);
});
