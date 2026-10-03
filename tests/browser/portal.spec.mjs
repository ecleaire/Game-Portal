import { test, expect } from '@playwright/test';
import { packageWebFiles } from '../../assets/zip-upload.js';

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

test('private HTML preview runs local ZIP assets inside an opaque sandbox', async ({ page }) => {
  await goto(page, './');
  await page.evaluate(async () => {
    const { privatePreviewDocument } = await import('./assets/private-preview.js');
    const encode = text => new TextEncoder().encode(text);
    const files = new Map([
      ['index.html', encode('<!doctype html><html><head><script src="game.js"></script></head><body>loading</body></html>')],
      ['game.js', encode("try { parent.document.body } catch { document.documentElement.dataset.isolated = 'yes' }; fetch('state.json').then(r => r.json()).then(x => { document.body.textContent = x.message; });")],
      ['state.json', encode('{"message":"Private game works"}')],
    ]);
    const frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = privatePreviewDocument(files); document.body.append(frame);
  });
  await expect(page.frameLocator('iframe').locator('body')).toHaveText('Private game works');
  await expect(page.frameLocator('iframe').locator('html')).toHaveAttribute('data-isolated', 'yes');
});

test('published ZIP game opens through the isolated public player', async ({ context, page }) => {
  // Exercise the mobile expansion fallback without relying on headless fullscreen support.
  await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { get: () => false }));
  const slug = 'c'.repeat(36);
  const archive = await packageWebFiles([
    new File(['<html><head><script src="jump.js"></script></head><body>Loading</body></html>'], 'jump.html'),
    new File(["addEventListener('DOMContentLoaded', () => { try { parent.document.body } catch { document.documentElement.dataset.isolated = 'yes' }; document.body.textContent = 'Published game works'; });"], 'jump.js'),
  ]);
  const bytes = Buffer.from(await archive.arrayBuffer());
  await context.route('**/assets/config.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export const config = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "" };' }));
  await context.route('**/functions/v1/portal/public-game', route => route.fulfill({ json: { game: {
    slug, title: 'Published test', description: '', engine: 'godot', version: '1.0', controls: '' } } }));
  let attempts = 0;
  await context.route('**/functions/v1/portal/public-package', route => ++attempts === 1
    ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
    : route.fulfill({ body: bytes, contentType: 'application/zip' }));
  await page.goto(`game.html?slug=${slug}`);
  await expect(page.locator('#playerStatus')).toHaveText('読込に失敗');
  await expect(page.getByRole('button', { name: '全画面で遊ぶ' })).toBeDisabled();
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByRole('heading', { name: 'Published test' })).toBeVisible();
  await expect(page.frameLocator('#gameFrame').locator('body')).toHaveText('Published game works');
  await expect(page.frameLocator('#gameFrame').locator('html')).toHaveAttribute('data-isolated', 'yes');
  await expect(page.locator('#playerShell')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#controlsText')).toHaveText('ゲーム内の案内をご確認ください。');
  await page.getByRole('button', { name: '全画面で遊ぶ' }).click();
  await expect(page.locator('#playerShell')).toHaveClass(/is-expanded/);
  await page.getByRole('button', { name: '全画面を終了' }).click();
  await expect(page.locator('#playerShell')).not.toHaveClass(/is-expanded/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/player-mobile.png', fullPage: true });
});

test('HTML upload recovers a lost completion response', async ({ context, page }) => {
  const submission = { id: 'upload-result', title: 'HTML upload test', status: 'draft', package_ready: true };
  let saved = false; let release; let received;
  const uploadReceived = new Promise(resolve => { received = resolve; });
  const responseReady = new Promise(resolve => { release = resolve; });
  const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4173',
    'access-control-allow-headers': 'content-type,x-portal-session', 'access-control-allow-methods': 'POST,OPTIONS' };
  await context.addInitScript(() => sessionStorage.setItem('game-portal.user.session.v1', 'a'.repeat(64)));
  await context.route('**/assets/config.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export const config = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "" };' }));
  await context.route('**/functions/v1/portal', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const { action } = route.request().postDataJSON();
    return route.fulfill({ headers, json: action === 'user.me' ? { user: { role: 'uploader' } }
      : action === 'user.submission.create' ? { submission: { ...submission, status: 'uploading', package_ready: false } }
      : { submissions: saved ? [submission] : [] } });
  });
  await context.route('**/functions/v1/portal/upload', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    expect(route.request().headers()['x-portal-session']).toBe('a'.repeat(64));
    expect(route.request().postDataBuffer().includes(Buffer.from('web-game.zip'))).toBe(true);
    received();
    await responseReady;
    saved = true;
    await route.fulfill({ status: 503, headers, json: { error: 'unavailable' } });
  });
  await page.goto('upload/');
  await page.getByLabel('ゲーム名', { exact: true }).fill(submission.title);
  await page.getByRole('combobox', { name: 'エンジン', exact: true }).selectOption('scratch');
  await page.getByLabel('ゲームファイルを選択').setInputFiles({ name: 'my-game.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><html><body>Game</body></html>') });
  await page.getByRole('button', { name: 'ゲームを保存', exact: true }).click();
  await uploadReceived;
  await expect(page.getByRole('button', { name: 'ゲームを保存', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('heading', { name: '投稿が完了しました' })).toBeVisible();
  await expect(page.getByRole('link', { name: '投稿したゲームを管理・プレイ →' })).toHaveAttribute('href', /game=upload-result/);
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
  expect(await user.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 1 });
  await user.reload();
  await expect(user.getByRole('button', { name: 'パスワードを変更', exact: true })).toBeVisible();
  await expect(user.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: 'ログアウト' })).toBeVisible();
  const created = await user.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:54321/functions/v1/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-Portal-Session': sessionStorage.getItem('game-portal.user.session.v1') },
      body: JSON.stringify({ action: 'user.submission.create', data: {
        title: '編集テスト', engine: 'godot', description: '', version: '1.0.0', controls: '', visibility: 'draft', published_at: '' } }),
    });
    return response.json();
  });
  expect(created.submission?.id).toBeTruthy();
  await user.reload();
  await user.getByRole('link', { name: '管理・編集する →' }).click();
  await expect(user.getByRole('heading', { name: '投稿したゲームの管理' })).toBeVisible();
  await user.getByLabel('ゲーム名').fill('編集後のタイトル');
  await user.getByRole('button', { name: '変更を保存' }).click();
  await expect(user.getByRole('heading', { name: '編集後のタイトル' })).toBeVisible();
  await user.getByLabel('公開範囲').selectOption('unlisted');
  await expect(user.getByLabel('公開日時（空欄で即時）')).toBeVisible();
  await user.getByLabel('公開範囲').selectOption('draft');
  await expect(user.getByLabel('公開日時（空欄で即時）')).toBeHidden();
  await user.setViewportSize({ width: 390, height: 844 });
  expect(await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await user.screenshot({ path: 'test-results/user-editor-mobile.png', fullPage: true });
  await user.getByRole('link', { name: '投稿一覧に戻る' }).click();
  await expect(user.getByRole('heading', { name: '編集後のタイトル' })).toBeVisible();

  page.on('dialog', dialog => dialog.accept());
  await selected.getByRole('button', { name: 'KICK（全端末をログアウト）' }).click();
  await expect(page.locator('#message')).toHaveText('変更を保存しました。');
  await user.getByLabel('ログイン用ユーザー名', { exact: true }).fill('should_not_change');
  await user.getByRole('button', { name: 'ログイン用ユーザー名を変更', exact: true }).click();
  await expect(user.locator('#message')).toContainText('セッションが終了');
  await expect(user.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();

  await selected.getByLabel('理由（任意）', { exact: true }).fill('browser test');
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
  await expect(page.getByRole('heading', { name: '管理画面 — browser_owner', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: 'ログアウト' })).toBeVisible();
  expect(errors).toEqual([]);
});
