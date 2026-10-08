import { test, expect } from '@playwright/test';
const backend='http://127.0.0.1:54321/functions/v1/portal';
async function api(request,action,data={},token){const response=await request.post(backend,{data:{action,data},headers:token?{'X-Portal-Session':token}:{}});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;}
test('assigned group management, independent participation, and play-only account UI work on desktop and mobile',async({page,context,request})=>{
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 const owner=await api(request,'admin.login',{username:'browser_owner',password:'browser-test-admin-only'});
 const staff=await api(request,'admin.admin.create',{username:'browser_group_manager',password:'browser-groups-only'},owner.token);
 const group=(await api(request,'admin.group.create',{name:'Browser group'},owner.token)).group;
 await api(request,'admin.group.create',{name:'Other group'},owner.token);
 await api(request,'admin.group.manager',{group_id:group.id,admin_id:staff.admin.id,operation:'add'},owner.token);
 const manager=await api(request,'admin.login',{username:'browser_group_manager',password:'browser-groups-only'});
 await page.goto('admin/');await page.evaluate(token=>sessionStorage.setItem('game-portal.admin.session.v1',token),manager.token);await page.reload();
 await expect(page.getByRole('heading',{name:'グループ管理 — browser_group_manager',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'ユーザー一覧',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'グループを作成',exact:true})).toHaveCount(0);
 await page.locator('#group-management').getByRole('button',{name:'所属・設定を開く',exact:true}).click();
 await page.getByLabel('グループ名',{exact:true}).fill('Updated group');await page.getByRole('button',{name:'グループ名を変更',exact:true}).click();
 await expect(page.locator('#group-management')).toContainText('Updated group');
 await page.locator('#group-management').getByRole('button',{name:'所属・設定を開く',exact:true}).click();
 await page.getByLabel('ユーザー名',{exact:true}).fill('browser_group_player');await page.getByLabel('初期パスワード',{exact:true}).fill('browser-groups-only');
 await page.getByRole('combobox',{name:'ユーザー権限',exact:true}).selectOption('player');await page.getByRole('button',{name:'所属アカウントを作成',exact:true}).click();
 await expect(page.locator('#group-management .group-roster')).toContainText('browser_group_player');
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/groups-manager-${width}.png`,fullPage:true});
 }
 const other=page.locator('.group-list .row').filter({has:page.getByRole('heading',{name:'Other group',exact:true})});
 await other.getByRole('button',{name:'参加する',exact:true}).click();await expect(other).toContainText('参加中');
 expect((await api(request,'admin.groups',{},manager.token)).groups.map(g=>g.id)).toEqual([group.id]);
 await other.getByRole('button',{name:'退出する',exact:true}).click();await expect(other).toContainText('未参加');
 const user=await api(request,'user.login',{username:'browser_group_player',password:'browser-groups-only',terms_accepted:true,terms_version:'2026-10-08'});
 await page.evaluate(token=>{sessionStorage.removeItem('game-portal.admin.session.v1');sessionStorage.setItem('game-portal.user.session.v1',token);},user.token);
 await page.goto('account/');await expect(page.locator('#portal')).toContainText('プレイ専用');await expect(page.locator('#portal')).toContainText('Updated group');
 await expect(page.locator('#portal').getByRole('link',{name:'新しいゲームを投稿する →',exact:true})).toHaveCount(0);
 await page.goto('upload/');await expect(page.locator('#portal')).toContainText('このアカウントには投稿権限がありません');await expect(page.locator('input[type=file]')).toHaveCount(0);
 const uploader=await api(request,'admin.group.account.create',{group_id:group.id,username:'browser_group_uploader',password:'browser-groups-only',role:'uploader'},manager.token);
 expect(uploader.user_id).toBeTruthy();const author=await api(request,'user.login',{username:'browser_group_uploader',password:'browser-groups-only',terms_accepted:true,terms_version:'2026-10-08'});
 await page.evaluate(token=>sessionStorage.setItem('game-portal.user.session.v1',token),author.token);await page.reload();
 await page.getByRole('combobox',{name:'公開範囲',exact:true}).selectOption('group');await expect(page.locator('.group-audience')).toContainText('Updated group');
 await expect(page.locator('.group-audience input')).toBeChecked();await expect(page.locator('[name=visibility] option')).toHaveCount(2);
});
