import { test, expect } from '@playwright/test';

async function goto(page, path) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await page.goto(path); }
    catch (error) {
      if (attempt || !String(error).includes('ERR_ABORTED')) throw error;
    }
  }
}

test('existing listing, search and public game player work without backend configuration', async ({ page }) => {
  await goto(page, './');
  await expect(page.locator('.game-card')).toHaveCount(2);
  await page.locator('#searchInput').fill('Scratch');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await page.locator('.play-link').click();
  await expect(page.locator('#gameTitle')).toHaveText('Scratch Demo');
  await expect(page.locator('#gameFrame')).toHaveAttribute('src', 'games/scratch-demo/index.html');
  await expect(page.frameLocator('#gameFrame').locator('body')).not.toBeEmpty();
  await page.goto('admin/');
  await expect(page.getByRole('heading', { name: '認証サービスは未設定です' })).toBeVisible();
  await page.goto('upload/');
  await expect(page.getByRole('heading', { name: '投稿サービスは未設定です' })).toBeVisible();
});

test('browser flows connect to the real Edge handler and migrated database', async ({ context, page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Serve public test configuration without editing the production/default config.
  await context.route('**/assets/config.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export const config = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "" };' }));
  await page.goto('admin/');
  await page.getByLabel('ユーザー名', { exact: true }).fill('browser_owner');
  await page.getByLabel('パスワード', { exact: true }).fill('browser-test-admin-only');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ユーザー作成' })).toBeVisible();
  const create = page.locator('section').filter({ has: page.getByRole('heading', { name: 'ユーザー作成', exact: true }) });
  await create.getByLabel('ユーザー名').fill('browser_user');
  await create.getByLabel('初期の本人用パスワード').fill('browser-test-user-only');
  await create.getByLabel('ユーザー権限').selectOption('uploader');
  await create.getByRole('button', { name: '作成', exact: true }).click();
  await expect(page.locator('#message')).toHaveText('ユーザーを作成しました。');
  await page.getByRole('button', { name: '管理', exact: true }).click();
  const selected = page.locator('#selected-user');
  await selected.getByLabel('ラベル（秘密情報を入力しない）').fill('support');
  await selected.getByLabel('パスワード', { exact: true }).fill('browser-test-alt-only');
  await selected.getByRole('button', { name: '代替パスワードを追加' }).click();
  await expect(page.locator('#message')).toHaveText('変更を保存しました。');
  await expect(selected.getByText(/support/)).toBeVisible();

  const user = await context.newPage();
  await user.goto('http://127.0.0.1:4173/Game-Portal/login/');
  await user.getByLabel('ユーザー名', { exact: true }).fill('browser_user');
  await user.getByLabel('パスワード', { exact: true }).fill('browser-test-alt-only');
  await user.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(user.getByRole('button', { name: 'パスワードを変更', exact: true })).toBeVisible();
  await expect(user.locator('#portal')).not.toContainText('support');
  expect(await user.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });

  page.on('dialog', dialog => dialog.accept());
  await selected.getByRole('button', { name: 'KICK（全端末をログアウト）' }).click();
  await expect(page.locator('#message')).toHaveText('変更を保存しました。');
  await user.getByLabel('ユーザー名', { exact: true }).fill('should_not_change');
  await user.getByRole('button', { name: 'ユーザー名を変更' }).click();
  await expect(user.locator('#message')).toContainText('セッションが終了');
  await expect(user.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();

  await selected.getByLabel('理由', { exact: true }).fill('browser test');
  await selected.getByRole('button', { name: 'BANする', exact: true }).click();
  await expect(page.locator('#message')).toHaveText('変更を保存しました。');
  await user.getByLabel('ユーザー名', { exact: true }).fill('browser_user');
  await user.getByLabel('パスワード', { exact: true }).fill('browser-test-alt-only');
  await user.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(user.locator('#message')).toContainText('ユーザー名またはパスワード');
  await selected.getByRole('button', { name: 'BANを解除', exact: true }).click();
  await expect(page.locator('#message')).toHaveText('変更を保存しました。');
  await user.getByLabel('パスワード', { exact: true }).fill('browser-test-user-only');
  await user.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(user.getByRole('button', { name: 'パスワードを変更', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '最新の100件' }).click();
  await expect(page.locator('.audit-results')).toContainText('admin.ban');
  await expect(page.locator('.audit-results')).not.toContainText('browser-test-alt-only');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/admin-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
