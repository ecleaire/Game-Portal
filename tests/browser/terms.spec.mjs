import { test, expect } from '@playwright/test';
import { packageWebFiles } from '../../assets/zip-upload.js';
const key='game-portal.terms.acceptance.v1';
const backend='http://127.0.0.1:54321/functions/v1/portal';
async function post(request,action,data={},token) {return (await request.post(backend,{data:{action,data},headers:token?{'X-Portal-Session':token}:{}})).json();}
test.beforeEach(async({context})=>{
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:`export const config={supabaseUrl:${JSON.stringify(backend.replace('/functions/v1/portal',''))},anonKey:""};`}));
});
test('anonymous search waits for explicit consent, preserves access to policies and re-prompts for a changed version',async({page,context,request})=>{
 let catalog=0;page.on('request',r=>{if(r.url().includes('/catalog')||r.url().endsWith('/games.json'))catalog++;});
 await page.goto('./');await expect(page.locator('.terms-gate')).toContainText('GAME PORTALを利用するには利用規約への同意が必要です。');
 await expect(page.locator('#searchInput')).toBeHidden();expect(catalog).toBe(0);
 for (const width of [390,1440]) {
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // Capture the visible consent gate after resizing; full-page compositor capture
  // intermittently fails on the Linux CI runner before any consent interaction.
  await page.screenshot({path:`test-results/consent-home-${width}.png`,fullPage:false,animations:'disabled'});
 }
 await page.getByRole('button',{name:'同意してゲームを探す',exact:true}).click();await expect(page.locator('#searchInput')).toBeHidden();
 const popupPromise=page.waitForEvent('popup');await page.locator('.terms-gate').getByRole('link',{name:'利用規約',exact:true}).click();
 const popup=await popupPromise;await expect(popup.getByRole('heading',{name:'GAME PORTAL 利用規約',exact:true})).toBeVisible();await expect(popup.locator('.policy-draft')).toHaveCount(0);await expect(popup.locator('meta[name=robots]')).toHaveCount(0);await popup.close();
 await expect(page.locator('.terms-gate label')).toContainText('18歳未満の場合は、保護者の同意を得ています。');
 await page.locator('[name=terms_accepted]').check();await page.getByRole('button',{name:'同意してゲームを探す',exact:true}).click();
 await expect(page.locator('#searchInput')).toBeVisible();expect(catalog).toBeGreaterThan(0);
 const current=(await (await request.post(`${backend}/policy`)).json()).terms;
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);expect(saved.version).toBe(current.version);expect(Object.keys(saved).sort()).toEqual(['acceptedAt','version']);
 await page.reload();await expect(page.locator('#searchInput')).toBeVisible();await expect(page.locator('.terms-gate')).toHaveCount(0);
 await context.route('**/functions/v1/portal/policy',route=>route.fulfill({json:{terms:{...current,version:'2099-01-01'}}}));
 await page.reload();await expect(page.locator('.terms-gate')).toBeVisible();await expect(page.locator('#searchInput')).toBeHidden();
});
test('direct public, shared and legacy URLs never load packages before consent; outage fails closed',async({context,page,request})=>{
 const policy=(await (await request.post(`${backend}/policy`)).json()).terms;
 for(const path of ['game.html?slug='+'a'.repeat(36),'game.html?id=scratch-demo']){
  let packages=0;const onRequest=r=>{if(/public-game|public-package|shared-game|shared-package|\/games\//.test(r.url()))packages++;};page.on('request',onRequest);
  await page.goto(path);await expect(page.locator('.terms-gate')).toBeVisible();expect(packages).toBe(0);await expect(page.locator('#playContent')).toBeHidden();
  page.off('request',onRequest);
 }
 await page.locator('[name=terms_accepted]').check();await page.getByRole('button',{name:'同意してゲームをプレイ',exact:true}).click();
 await expect(page.locator('#gameFrame')).toHaveAttribute('src','games/scratch-demo/index.html');
 await page.evaluate(key=>localStorage.removeItem(key),key);
 await context.route('**/functions/v1/portal/policy',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
 await page.reload();await expect(page.locator('.terms-gate')).toContainText('規約情報を取得できません');await expect(page.locator('#gameFrame')).not.toHaveAttribute('src',/.+/);
 await context.unroute('**/functions/v1/portal/policy');
 await page.getByRole('button',{name:'再試行',exact:true}).click();await expect(page.locator('[name=terms_accepted]')).toBeVisible();
 const zip = await packageWebFiles([new File(['<!doctype html><html><body>Consented game</body></html>'],'index.html',{type:'text/html'})]);
 const bytes=Buffer.from(await zip.arrayBuffer());
 await context.route('**/functions/v1/portal/public-game',route=>route.fulfill({json:{game:{slug:'a'.repeat(36),title:'Consent test',engine:'other'}}}));
 await context.route('**/functions/v1/portal/public-package',route=>route.fulfill({contentType:'application/zip',body:bytes}));
 let packages=0;page.on('request',r=>{if(r.url().includes('/public-package'))packages++;});
 await page.goto('game.html?slug='+'a'.repeat(36));await expect(page.locator('.terms-gate')).toBeVisible();expect(packages).toBe(0);
 await page.locator('[name=terms_accepted]').check();await page.getByRole('button',{name:'同意してゲームをプレイ',exact:true}).click();
 await expect(page.frameLocator('#gameFrame').locator('body')).toHaveText('Consented game');expect(packages).toBe(1);

});
test('login checkbox records consent, does not expose identities, and admin login remains separate',async({page,request})=>{
 const admin=await post(request,'admin.login',{username:'browser_owner',password:'browser-test-admin-only'});
 await post(request,'admin.create',{username:'browser_terms_user',password:'browser-terms-only',role:'uploader'},admin.token);
 await page.goto('login/');
 const check=page.locator('[name=terms_accepted]');await expect(check).not.toBeChecked();
 await page.getByLabel('ユーザー名',{exact:true}).fill('browser_terms_user');await page.getByLabel('パスワード',{exact:true}).fill('browser-terms-only');
 await page.getByRole('button',{name:'ログイン',exact:true}).click();await expect(page).toHaveURL(/login\/$/);
 const popupPromise=page.waitForEvent('popup');await page.locator('.consent-checkbox').getByRole('link',{name:'利用規約',exact:true}).click();await (await popupPromise).close();
 await expect(page.getByLabel('ユーザー名',{exact:true})).toHaveValue('browser_terms_user');
 await check.check();await page.getByRole('button',{name:'ログイン',exact:true}).click();await expect(page).toHaveURL(/account\/$/);
 const stored=await page.evaluate(key=>({accepted:JSON.parse(localStorage.getItem(key)),token:sessionStorage.getItem('game-portal.user.session.v1'),local:[...Object.keys(localStorage)]}),key);
 expect(stored.token).toMatch(/^[a-f0-9]{64}$/);expect(stored.local).toEqual([key]);expect(stored.accepted.version).toBeTruthy();
 await expect(page.locator('#portal')).toContainText('表示名やユーザー名には、本名・メールアドレス・電話番号など個人を特定できる情報を入力しないでください。');
 await page.goto('upload/');await expect(page.locator('[name=rights_confirmed]')).not.toBeChecked();await expect(page.locator('[name=rights_confirmed]')).toHaveAttribute('required','');
 await page.goto('admin/');await expect(page.locator('[name=terms_accepted]')).toHaveCount(0);
});
test('reports collect only reason and details, identify the game and appear in moderation',async({page,request})=>{
 await page.goto('game.html?id=scratch-demo');await page.locator('[name=terms_accepted]').check();await page.getByRole('button',{name:'同意してゲームをプレイ',exact:true}).click();
 await page.locator('#gameReport summary').click();await expect(page.locator('#gameReport')).toContainText('対象ゲーム：Scratch Demo');
 await expect(page.locator('#gameReport input')).toHaveCount(0);await expect(page.locator('#gameReport')).toContainText('個人情報は入力しないでください。');
 await page.getByRole('combobox',{name:'報告理由',exact:true}).selectOption('rights');await page.getByLabel('詳細（1000文字以内）',{exact:true}).fill('Browser consent report');
 await page.getByRole('button',{name:'報告を送信',exact:true}).click();await expect(page.locator('#gameReport')).toContainText('報告を受け付けました。');
 await page.goto('admin/');await page.getByLabel('ユーザー名',{exact:true}).fill('browser_owner');await page.getByLabel('パスワード',{exact:true}).fill('browser-test-admin-only');await page.getByRole('button',{name:'ログイン',exact:true}).click();
 const row=page.locator('#reports .row').filter({hasText:'Browser consent report'});await expect(row).toBeVisible();await expect(row.getByRole('link')).toHaveAttribute('href','../game.html?id=scratch-demo');
 await row.getByLabel('報告の対応状態',{exact:true}).selectOption('resolved');await row.getByRole('button',{name:'状態を保存',exact:true}).click();await expect(row).toHaveCount(0);
});
