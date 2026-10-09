import { test, expect } from '@playwright/test';
const endpoint='http://127.0.0.1:54321/functions/v1/portal';
async function api(request,action,data={},token){const response=await request.post(endpoint,{data:{action,data},headers:token?{'X-Portal-Session':token}:{}});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;}
test('moderation feedback preserves input, super admin manages rules, AI disclosure and icons save',async({page,context,request})=>{
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 await context.addInitScript(()=>localStorage.setItem('game-portal.terms.acceptance.v1',JSON.stringify({version:'2026-10-08',acceptedAt:new Date().toISOString()})));
 const admin=await api(request,'admin.login',{username:'browser_owner',password:'browser-test-admin-only'});
 await api(request,'admin.create',{username:'browser_moderation_author',password:'browser-moderation-only',role:'trusted_uploader'},admin.token);
 const author=await api(request,'user.login',{username:'browser_moderation_author',password:'browser-moderation-only',terms_accepted:true,terms_version:'2026-10-08'});
 await page.goto('account/');await page.evaluate(token=>sessionStorage.setItem('game-portal.user.session.v1',token),author.token);await page.reload();
 await page.getByLabel('表示名',{exact:true}).fill('死ね');await page.getByRole('button',{name:'プロフィールを保存',exact:true}).click();
 await expect(page.locator('#message')).toContainText('使用できない単語が含まれています');await expect(page.getByLabel('表示名',{exact:true})).toHaveValue('死ね');
 await page.getByLabel('表示名',{exact:true}).fill('https://example.com');await page.getByRole('button',{name:'プロフィールを保存',exact:true}).click();await expect(page.locator('#message')).toContainText('URLは素材の権利表記');
 await page.getByLabel('表示名',{exact:true}).fill('新しい作者');await page.getByLabel('アイコン',{exact:true}).selectOption('penguin');await page.getByRole('button',{name:'プロフィールを保存',exact:true}).click();await expect(page.locator('.avatar')).toHaveText('🐧');
 await page.goto('upload/');await page.getByLabel('ゲーム名',{exact:true}).fill('AI declaration test');
 await page.getByLabel('エンジン',{exact:true}).selectOption('scratch');
 await page.getByLabel('ゲームファイルを選択',{exact:true}).setInputFiles({name:'sample.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><html><body>AI test game</body></html>')});
 await page.getByRole('checkbox',{name:'ゲーム制作や使用素材にAIを利用している',exact:true}).check();
 await page.getByRole('checkbox',{name:/この作品を投稿・公開/}).check();
 await page.getByRole('button',{name:'ゲームを投稿',exact:true}).click();await expect(page.locator('.upload-status')).toContainText('1つ以上選択');
 await page.getByRole('checkbox',{name:'画像',exact:true}).check();await page.getByRole('checkbox',{name:'プログラム',exact:true}).check();
 await page.getByLabel('素材の権利表記・提供元（任意）',{exact:true}).fill('https://example.com/credits');
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('.ai-disclosure').screenshot({path:`test-results/ai-disclosure-${width}.png`});}
 await page.getByRole('button',{name:'ゲームを投稿',exact:true}).click();await expect(page.getByRole('heading',{name:/投稿.*完了|保存.*完了/})).toBeVisible();
 const game=(await api(request,'user.submissions',{},author.token)).submissions.find(s=>s.title==='AI declaration test');expect(game.ai_used).toBe(true);expect(game.ai_types).toEqual(['image','code']);
 await page.goto(`account/?game=${game.id}`);await expect(page.getByRole('checkbox',{name:'画像',exact:true})).toBeChecked();
 await page.getByLabel('ゲーム名',{exact:true}).fill('死ね');await page.getByRole('button',{name:'変更を保存',exact:true}).click();await expect(page.locator('.upload-status')).toContainText('使用できない単語');await expect(page.getByLabel('ゲーム名',{exact:true})).toHaveValue('死ね');
 await page.getByLabel('ゲーム名',{exact:true}).fill(game.title);await page.getByRole('checkbox',{name:'ゲーム制作や使用素材にAIを利用している',exact:true}).uncheck();await page.getByRole('button',{name:'変更を保存',exact:true}).click();await expect(page.locator('#message')).toContainText('変更を保存しました');
 expect((await api(request,'user.submissions',{},author.token)).submissions.find(s=>s.id===game.id).ai_used).toBe(false);
 await page.evaluate(token=>sessionStorage.setItem('game-portal.admin.session.v1',token),admin.token);await page.goto('admin/');
 const panel=page.locator('#moderation-management');await panel.getByText('禁止語を追加',{exact:true}).first().click();
 const add=panel.locator('details').first();await add.getByLabel('禁止語',{exact:true}).fill('ブラウザ検証語');await add.getByRole('button',{name:'禁止語を追加',exact:true}).click();await expect(page.locator('#message')).toContainText('禁止語を追加しました');
 const row=panel.locator('details').filter({has:page.locator('summary').filter({hasText:'ブラウザ検証語'})});await row.locator('summary').click();await row.getByLabel('状態',{exact:true}).selectOption('false');await row.getByRole('button',{name:'禁止語を更新',exact:true}).click();await expect(page.locator('#message')).toContainText('禁止語を更新しました');
 await api(request,'user.submission.delete',{submission_id:game.id,title:game.title,confirmation:'delete'},author.token);
});
