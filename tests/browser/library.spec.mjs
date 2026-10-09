import { test, expect } from '@playwright/test';
import { packageWebFiles } from '../../assets/zip-upload.js';
const backend='http://127.0.0.1:54321/functions/v1/portal';
async function api(request,action,data={},token){const response=await request.post(backend,{data:{action,data},headers:token?{'X-Portal-Session':token}:{}});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;}
test('likes, private lists, ordering, URL sharing and private following work through real authorization',async({page,context,request})=>{
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 await context.addInitScript(()=>localStorage.setItem('game-portal.terms.acceptance.v1',JSON.stringify({version:'2026-10-08',acceptedAt:new Date().toISOString()})));
 const admin=await api(request,'admin.login',{username:'browser_owner',password:'browser-test-admin-only'});
 for(const [username,role] of [['browser_library_author','trusted_uploader'],['browser_library_player','player']])await api(request,'admin.create',{username,password:'browser-library-test',role},admin.token);
 const login=name=>api(request,'user.login',{username:name,password:'browser-library-test',terms_accepted:true,terms_version:'2026-10-08'});
 const author=await login('browser_library_author');const player=await login('browser_library_player');
 const zip=await packageWebFiles([new File(['<!doctype html><html><body>Library game</body></html>'],'index.html')]);
 const games=[];
 for(const title of ['Library first','Library second']){
  const {submission}=await api(request,'user.submission.create',{title,engine:'other',version:'1',visibility:'public',terms_accepted:true,terms_version:'2026-10-08',rights_confirmed:'yes'},author.token);
  const uploaded=await request.post(`${backend}/upload`,{headers:{'X-Portal-Session':author.token},multipart:{submission_id:submission.id,package:{name:'library.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.arrayBuffer())}}});
  expect(uploaded.ok(),await uploaded.text()).toBe(true);games.push(submission);
 }
 await page.goto(`game.html?slug=${games[0].public_slug}`);
 await page.getByRole('button',{name:'♡ いいね 0',exact:true}).click();
 await expect(page.locator('.social-status')).toContainText('いいねするにはログインしてください');
 await expect(page.locator('.social-status').getByRole('link',{name:'ログインする →'})).toHaveAttribute('href','./login/');
 expect((await api(request,'social.game',{slug:games[0].public_slug})).like_count).toBe(0);
 await page.evaluate(token=>sessionStorage.setItem('game-portal.user.session.v1',token),author.token);
 await page.goto(`account/?game=${games[0].id}`);
 const credits='音楽: Test Author\nhttps://example.com/music\n<script>not executable</script>';
 await page.getByLabel('素材の権利表記・提供元（任意）',{exact:true}).fill(credits);
 await page.getByRole('checkbox',{name:'ゲーム制作や使用素材にAIを利用している',exact:true}).check();
 await page.getByRole('checkbox',{name:'画像',exact:true}).check();await page.getByRole('checkbox',{name:'プログラム',exact:true}).check();
 await page.getByRole('button',{name:'変更を保存',exact:true}).click();
 await expect(page.locator('#message')).toContainText('変更を保存しました');
 await page.evaluate(token=>sessionStorage.setItem('game-portal.user.session.v1',token),player.token);
 await page.goto(`game.html?slug=${games[0].public_slug}`);
 await expect(page.frameLocator('#gameFrame').locator('body')).toHaveText('Library game');
 await expect(page.locator('#gameCredits')).toHaveText(credits);await expect(page.locator('#gameCredits script')).toHaveCount(0);
 await expect(page.locator('#gameAI')).toHaveText('AI利用あり：画像・プログラム');
 await page.getByRole('link',{name:'browser_library_author のプロフィール →',exact:true}).click();
 await expect(page.getByRole('heading',{name:'browser_library_author',exact:true})).toBeVisible();
 await expect(page.locator('.profile-game')).toHaveCount(2);
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/profile-${width}.png`,fullPage:false,animations:'disabled'});}
 await page.getByRole('link',{name:/Library first/}).click();
 await expect(page.frameLocator('#gameFrame').locator('body')).toHaveText('Library game');
 const like=page.getByRole('button',{name:'♡ いいね 0',exact:true});await like.click();await expect(page.getByRole('button',{name:'♥ いいね 1',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'＋ 作者をフォロー',exact:true}).click();await expect(page.getByRole('button',{name:'✓ フォロー中',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'＋ リストに保存',exact:true}).click();const dialog=page.getByRole('dialog',{name:'リストに保存'});
 await dialog.getByLabel('新しいリスト名').fill('Weekend games');await dialog.getByRole('button',{name:'作成して保存',exact:true}).click();await expect(dialog.getByRole('checkbox',{name:'Weekend games'})).toBeChecked();await dialog.getByRole('button',{name:'閉じる',exact:true}).click();
 const list=(await api(request,'social.lists',{},player.token)).lists[0];expect(list.share_token).toBe(null);
 await api(request,'social.list.item',{list_id:list.id,slug:games[1].public_slug,operation:'add'},player.token);
 await page.getByRole('link',{name:'ライブラリ',exact:true}).click();await page.getByRole('button',{name:/Weekend games/}).click();await expect(page.getByRole('heading',{name:'Weekend games',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Library secondを上へ',exact:true}).click();await expect(page.locator('.library-game-link').first()).toHaveText('Library second');
 await page.getByLabel('リスト名',{exact:true}).fill('Favorites');await page.getByRole('button',{name:'名前を保存',exact:true}).click();await expect(page.getByRole('heading',{name:'Favorites',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'共有リンクを作成・コピー',exact:true}).click();const sharedUrl=await page.getByLabel('共有URL',{exact:true}).inputValue();
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/library-${width}.png`,fullPage:true});}
 const guest=await context.newPage();await guest.goto(sharedUrl);await expect(guest.getByRole('heading',{name:'Favorites',exact:true})).toBeVisible();await expect(guest.locator('.library-game-link')).toHaveCount(2);await expect(guest.getByRole('button',{name:'名前を保存',exact:true})).toHaveCount(0);
 await api(request,'user.submission.visibility',{submission_id:games[0].id,visibility:'draft'},author.token);await guest.reload();await expect(guest.locator('.library-game-link')).toHaveCount(1);await expect(guest.locator('#library')).toContainText('閲覧できない作品');await expect(guest.locator('#library')).not.toContainText('Library first');
 await page.getByRole('button',{name:'共有を停止',exact:true}).click();await guest.reload();await expect(guest.locator('#message')).toContainText('対象が見つからない');await guest.close();
 await page.getByRole('button',{name:'いいねしたゲーム',exact:true}).click();await expect(page.locator('#library')).toContainText('閲覧できない作品');await page.getByRole('button',{name:'閲覧できない作品を外す',exact:true}).click();await expect(page.locator('.library-game')).toHaveCount(0);
 await page.getByRole('button',{name:'フォロー中',exact:true}).click();await expect(page.locator('.library-creator')).toContainText('browser_library_author');await expect(page.locator('.library-game-link')).toHaveCount(1);
 await page.getByRole('button',{name:'フォローを解除',exact:true}).click();await expect(page.locator('#library')).toContainText('まだフォローしていません');
 expect((await api(request,'social.following',{},author.token)).following).toEqual([]);expect((await api(request,'social.likes',{},admin.token)).games).toEqual([]);
 await page.getByRole('button',{name:'リスト',exact:true}).click();await page.getByRole('button',{name:/Favorites/}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'リストを削除',exact:true}).click();await expect(page.locator('#library')).toContainText('ゲームページの「リストに保存」');
 // Restore the shared disposable backend catalog for the legacy listing tests.
 for(const game of games)await api(request,'user.submission.delete',{submission_id:game.id,title:game.title,confirmation:'delete'},author.token);
});
