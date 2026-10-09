import { test, expect } from '@playwright/test';
import { packageWebFiles } from '../../assets/zip-upload.js';
import { writeFile } from 'node:fs/promises';

// Existing feature tests start with an explicit prior consent fixture. Consent gates
// themselves are covered from a clean browser in terms.spec.mjs.
test.beforeEach(async ({ context, request }) => {
  const policy = await (await request.post('http://127.0.0.1:54321/functions/v1/portal/policy')).json();
  await context.route('**/assets/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};' }));
  await context.addInitScript(version => {
    try { localStorage.setItem('game-portal.terms.acceptance.v1',JSON.stringify({version,acceptedAt:new Date().toISOString()})); } catch {}
  }, policy.terms.version);
});
async function submitLogin(page) {
  const consent = page.locator('input[name="terms_accepted"]');
  if (await consent.count()) await consent.check();
  await page.getByRole('button', {name:'ログイン',exact:true}).click();
}

test('footer theme follows device changes and persists explicit overrides across pages', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  const control = page.getByRole('combobox', { name: '表示モード', exact: true });
  await expect(control).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.site-nav').getByRole('link', { name: 'FAQ', exact: true })).toHaveCount(0);
  await expect(page.locator('.site-nav select')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(245, 248, 252)');
  await control.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(24, 40, 61)');
  for (const path of ['faq/', 'terms/', 'privacy/', 'login/', 'account/', 'upload/', 'admin/', 'game.html?id=scratch-demo']) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(control).toHaveValue('light');
    await expect(page.locator('.site-footer').getByRole('combobox', { name: '表示モード', exact: true })).toBeVisible();
    await expect(page.locator('.site-nav').getByRole('link', { name: 'FAQ', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto('./'); await page.reload();
  await expect(control).toHaveValue('light');
  await control.focus(); await expect(control).toBeFocused();
  await page.locator('#searchOptions summary').click();
  await expect(page.locator('#searchTarget')).toHaveCSS('color', 'rgb(24, 40, 61)');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/home-light-320.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/home-light-1440.png', fullPage: true });
  const other = await context.newPage(); await other.goto('faq/');
  await control.selectOption('dark');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload(); await expect(control).toHaveValue('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await control.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload(); await expect(control).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await other.close();
});

test('device theme and manual switching work when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('login/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('combobox', { name: '表示モード', exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('help and policy pages are linked, keyboard accessible and responsive', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('navigation', { name: 'サポート・ポリシー' }).getByRole('link', { name: 'FAQ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'よくある質問', exact: true })).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: '問い合わせ窓口はありますか？' })).toHaveCount(0);
  const question = page.locator('.faq-item').first();
  await question.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(question).toHaveAttribute('open', '');
  await expect(question.locator('div')).toContainText('公開ゲーム');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('navigation', { name: 'サポート・ポリシー' }).getByRole('link', { name: '利用規約', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'GAME PORTAL 利用規約', exact: true })).toBeVisible();
  await expect(page.locator('.policy-draft')).toHaveCount(0);
  await expect(page.locator('#operator')).toContainText('GAME PORTAL運営');
  await page.getByRole('navigation', { name: 'サポート・ポリシー' }).getByRole('link', { name: 'プライバシーポリシー', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'プライバシーポリシー', exact: true })).toBeVisible();
  await expect(page.locator('#providers')).toContainText('Google Drive');
  await expect(page.locator('#operator')).toContainText('GAME PORTAL運営');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/privacy-${width}.png`, fullPage: true });
  }
  await page.getByRole('navigation', { name: 'サポート・ポリシー' }).getByRole('link', { name: '権利表記', exact: true }).click();
  await expect(page.getByRole('heading', { name: '権利表記', exact: true })).toBeVisible();
  await expect(page.locator('#independence')).toContainText('提携しておらず');
  await expect(page.locator('#godot a').first()).toHaveAttribute('href', 'https://godot.foundation/policies-and-procedures/trademark-policy');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/rights-${width}.png`, fullPage: true, animations:'disabled' });
  }
  await page.goto('./');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const lines = await page.locator('.hero h2 span').evaluateAll(nodes => nodes.map(n => { const r=document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()].map(rect=>({top:rect.top,right:rect.right})); }));
    expect(lines).toHaveLength(2); for(const line of lines) expect(line).toHaveLength(1);
    expect(lines[1][0].top).toBeGreaterThan(lines[0][0].top);
    for(const line of lines) expect(line[0].right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/home-layout-${width}.png`, fullPage: true });
  }
  for (const path of ['login/', 'account/', 'upload/', 'admin/', 'library/', 'profile/', 'rights/', 'game.html?id=scratch-demo']) {
    await page.goto(path);
    const footer=page.getByRole('navigation', { name: 'サポート・ポリシー' });
    await expect(footer.getByRole('link', { name: '権利表記', exact: true })).toHaveAttribute('href', /rights\/$/);
    await expect(footer.getByRole('link', { name: 'FAQ', exact: true })).toHaveAttribute('href', /faq\/$/);
    await footer.getByRole('link', { name: 'FAQ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'よくある質問', exact: true })).toBeVisible();
  }
  await page.evaluate(() => sessionStorage.setItem('game-portal.user.session.v1', 'a'.repeat(64)));
  await page.reload();
  await page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: 'ログアウト', exact: true }).click();
  await expect(page).toHaveURL(/\/Game-Portal\/$/);
  expect(await page.evaluate(() => sessionStorage.getItem('game-portal.user.session.v1'))).toBeNull();
});

test('binary sandbox loading preserves WASM, assets and isolation without Base64 overhead', async ({page}) => {
  await goto(page, './');
  const result = await page.evaluate(async () => {
    const {privatePreviewDocument, mountPrivatePreview} = await import('./assets/private-preview.js');
    const encode = text => new TextEncoder().encode(text);
    const files = new Map([
      ['index.html', encode('<!doctype html><html><head><link rel="stylesheet" href="style.css"><script src="game.js"></script></head><body>loading</body></html>')],
      ['style.css', encode('body{color:rgb(1,2,3)}')],
      ['game.js', encode(`Promise.all([fetch('game.wasm').then(r=>WebAssembly.instantiateStreaming(r)),fetch('payload.pck').then(r=>r.arrayBuffer())]).then(async ([wasm,bytes])=>{let isolated=false;try{parent.document.body}catch{isolated=true}let blocked=false;try{await fetch('https://example.com/blocked')}catch{blocked=true}document.body.textContent='ready:'+bytes.byteLength+':'+new Uint8Array(bytes)[bytes.byteLength-1]+':'+isolated+':'+blocked;parent.postMessage('bench-ready','*');});`)],
      ['game.wasm', new Uint8Array([0,97,115,109,1,0,0,0])],
      ['payload.pck', new Uint8Array(12*1024*1024).fill(90)],
    ]);
    const times = {};
    for (const mode of ['baseline','binary']) {
      const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.id='bench-'+mode;document.body.append(frame);
      const started=performance.now();
      const ready=new Promise(resolve=>{const receive=event=>{if(event.source===frame.contentWindow&&event.data==='bench-ready'){window.removeEventListener('message',receive);resolve();}};window.addEventListener('message',receive);});
      if(mode==='baseline')frame.srcdoc=privatePreviewDocument(files);
      else await mountPrivatePreview(frame,files);
      await ready;
      times[mode]=performance.now()-started;
    }
    return {...times,detached:files.get('payload.pck').byteLength===0,bootstrapLength:document.querySelector('#bench-binary').srcdoc.length};
  });
  for(const mode of ['baseline','binary']) {
    await expect(page.frameLocator('#bench-'+mode).locator('body')).toHaveText('ready:12582912:90:true:true');
    await expect(page.frameLocator('#bench-'+mode).locator('body')).toHaveCSS('color','rgb(1, 2, 3)');
  }
  expect(result.detached).toBe(true);expect(result.bootstrapLength).toBeLessThan(16000);
  await writeFile('test-results/binary-loading-performance.json',JSON.stringify(result,null,2));
  console.log('12 MiB sandbox startup benchmark (synthetic game, milliseconds):',result);
});

test('search options distinguish keyword fields, exact/partial tags and AND/OR on mobile', async ({ context, page }) => {
  const tags = [
    { id: '6b61c4a0-1204-4000-8000-000000000101', name: 'アクション', slug: 'action', category: 'ジャンル', is_active: true },
    { id: '6b61c4a0-1204-4000-8000-000000000102', name: 'アクションRPG', slug: 'action-rpg', category: 'ジャンル', is_active: true },
    { id: '6b61c4a0-1204-4000-8000-000000000103', name: '3D', slug: '3d', category: 'ジャンル', is_active: true },
  ];
  await context.route('**/assets/config.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};' }));
  await context.route('**/functions/v1/portal/tags', route => route.fulfill({ json: { tags } }));
  await context.route('**/functions/v1/portal/catalog', route => route.fulfill({ json: { games: [
    { slug: 'e'.repeat(36), title: '星の冒険', description: '海のパズル', engine: 'godot', tags: [tags[0], tags[2]] },
    { slug: 'f'.repeat(36), title: '海のレース', description: '星を集める', engine: 'scratch', tags: [tags[1]] },
    { slug: 'a'.repeat(36), title: '夜の冒険', description: '静かな探索', engine: 'godot', tags: [tags[2]] },
  ] } }));
  await page.goto('./');
  const cards = page.locator('.game-card');
  await expect(cards).toHaveCount(5);
  await expect(page.locator('#searchOptions')).not.toHaveAttribute('open', '');
  await expect(page.locator('#searchTarget')).toBeHidden();
  await expect(page.locator('.home-help')).toHaveCount(0);
  await page.locator('#searchOptions summary').click();
  await page.locator('#searchTarget').selectOption('title');
  await page.locator('#searchInput').fill('星');
  await expect(cards).toHaveCount(1); await expect(cards).toContainText('星の冒険');
  await page.locator('#searchTarget').selectOption('description');
  await expect(cards).toHaveCount(1); await expect(cards).toContainText('海のレース');
  await page.locator('#searchTarget').selectOption('text'); await expect(cards).toHaveCount(2);
  await page.locator('#searchInput').fill('アクション');
  await page.locator('#searchTarget').selectOption('tag-exact');
  await expect(cards).toHaveCount(1); await expect(cards).toContainText('星の冒険');
  await page.locator('#searchTarget').selectOption('tag-partial'); await expect(cards).toHaveCount(2);
  await page.locator('#searchInput').fill('アクション　３Ｄ');
  await page.locator('#searchTarget').selectOption('tag-exact'); await expect(cards).toHaveCount(1);
  await page.locator('#matchMode').selectOption('any'); await expect(cards).toHaveCount(2);
  await page.locator('#searchTarget').selectOption('tag-partial'); await expect(cards).toHaveCount(3);
  await page.locator('#searchTarget').selectOption('all');
  await page.locator('#matchMode').selectOption('all');
  await page.locator('#searchInput').fill('星 アクション'); await expect(cards).toHaveCount(2);
  await page.locator('#resetSearchOptions').click();
  await expect(page.locator('#searchTarget')).toHaveValue('text');
  await expect(page.locator('#searchInput')).toHaveValue('星 アクション'); await expect(cards).toHaveCount(0);

  await page.goto('?tag=action&tag=3d'); await expect(cards).toHaveCount(1);
  await page.locator('#searchOptions summary').click();
  await page.locator('#matchMode').selectOption('any'); await expect(cards).toHaveCount(2);
  await expect(page.locator('.tag-filter-hint')).toHaveText('キーワード・選択タグのいずれかに一致する作品を表示します。');
  await page.locator('#searchInput').fill('海'); await expect(cards).toHaveCount(3);
  await page.locator('#matchMode').selectOption('all'); await expect(cards).toHaveCount(1);
  await page.locator('#matchMode').selectOption('any');
  await page.locator('#searchInput').fill('');
  await page.getByRole('button', { name: 'Scratch', exact: true }).click(); await expect(cards).toHaveCount(0);
  await page.getByRole('button', { name: 'すべて', exact: true }).click(); await expect(cards).toHaveCount(2);
  await page.reload(); await expect(page.locator('#matchMode')).toHaveValue('any'); await expect(cards).toHaveCount(2);
  await expect(page.locator('#searchTarget')).toBeHidden();
  await page.locator('#searchOptions summary').click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#searchTarget')).toBeVisible();
    await expect(page.locator('.hero h2')).toHaveText('遊ぶ。つくる。ここでつながる。');
    await page.screenshot({ path: `test-results/search-options-${width}.png`, fullPage: true });
  }
  await page.locator('#resetSearchOptions').click(); await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'タグをすべて解除', exact: true }).click(); await expect(cards).toHaveCount(5);
});

async function goto(page, path) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await page.goto(path); }
    catch (error) {
      if (attempt || !String(error).includes('ERR_ABORTED')) throw error;
    }
  }
}

test('existing listing, search and public game player work with a policy service and retain unconfigured account screens', async ({ page, context }) => {
  const openCatalog = async () => {
    const tagsReady = page.waitForResponse(r => r.url().endsWith('/tags') && r.request().method() === 'POST');
    await goto(page, './'); await tagsReady;
  };
  await openCatalog();
  await expect(page.locator('.game-card')).toHaveCount(2);
  await page.locator('#searchInput').fill('Scratch');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page.locator('.play-link')).toHaveCount(0);
  await page.locator('.game-card p').scrollIntoViewIfNeeded();
  const description = await page.locator('.game-card p').boundingBox();
  await page.mouse.click(description.x + description.width / 2, description.y + description.height / 2);
  await expect(page.locator('#gameTitle')).toHaveText('Scratch Demo');
  await expect(page.locator('#gameFrame')).toHaveAttribute('src', 'games/scratch-demo/index.html');
  await expect(page.frameLocator('#gameFrame').locator('body')).not.toBeEmpty();
  await openCatalog();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#searchInput').fill('Scratch');
  await page.locator('.game-card').scrollIntoViewIfNeeded();
  const card = await page.locator('.game-card').boundingBox();
  await page.mouse.click(card.x + card.width / 2, card.y + card.height - 12);
  await expect(page.locator('#gameTitle')).toHaveText('Scratch Demo');
  await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"",anonKey:""};'}));
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
  expect((await page.locator('.player-toolbar').boundingBox()).height).toBeLessThanOrEqual(56);
  await expect(page.locator('#playerStatus')).toBeHidden();
  await page.screenshot({ path: 'test-results/player-fullscreen-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.locator('.player-toolbar').boundingBox()).height).toBeLessThanOrEqual(56);
  await page.screenshot({ path: 'test-results/player-fullscreen-mobile.png' });
  await page.getByRole('button', { name: '全画面を終了' }).click();
  await expect(page.locator('#playerShell')).not.toHaveClass(/is-expanded/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/player-mobile.png', fullPage: true });
});

for (const mode of ['public', 'shared']) test(`${mode} game downloads its ZIP before metadata completes`, async ({ context, page }) => {
  const slug = 'd'.repeat(36);
  const archive = await packageWebFiles([
    new File(['<html><body>Parallel game works</body></html>'], 'index.html'),
  ]);
  const bytes = Buffer.from(await archive.arrayBuffer());
  await context.route('**/assets/config.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export const config = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "" };' }));
  if (mode === 'shared') {
    await context.addInitScript(() => sessionStorage.setItem('game-portal.user.session.v1', 'a'.repeat(64)));
    await context.route('**/functions/v1/portal/public-game', route => route.fulfill({ status: 404, json: {} }));
    await context.route('**/functions/v1/portal/public-package', route => route.fulfill({ status: 404, json: {} }));
  }
  let releaseMetadata;
  const metadataGate = new Promise(resolve => { releaseMetadata = resolve; });
  let packageRequests = 0;
  await context.route(`**/functions/v1/portal/${mode}-game`, async route => {
    await metadataGate;
    await route.fulfill({ json: { game: { slug, title: 'Parallel test', engine: 'other' } } });
  });
  await context.route(`**/functions/v1/portal/${mode}-package`, async route => {
    if (mode === 'shared') expect(route.request().headers()['x-portal-session']).toBe('a'.repeat(64));
    packageRequests++;
    await route.fulfill({ body: bytes, contentType: 'application/zip' });
  });
  await page.goto(`game.html?slug=${slug}`);
  try {
    // A serial implementation cannot issue this request while metadata is held.
    await expect.poll(() => packageRequests).toBe(1);
    await expect(page.locator('#gameFrame')).not.toHaveAttribute('srcdoc', /Parallel game works/);
  } finally { releaseMetadata(); }
  await expect(page.frameLocator('#gameFrame').locator('body')).toHaveText('Parallel game works');
  await expect(page.locator('#playerStatus')).toHaveText('ゲームを表示しました');
});

for (const path of ['account/', 'upload/']) test(`${path} submission history supports search, sorting, manual order and scrolling`, async ({ context, page }) => {
  const games = Array.from({ length: 16 }, (_,index) => ({ id: `history-${index}`, title: `Game ${index + 1}`, engine: index % 2 ? 'scratch' : 'godot', version: `1.${index}`, description: index === 5 ? 'Special puzzle' : '', visibility: 'draft', status: index % 2 ? 'pending' : 'draft', created_at: new Date(2026,0,index+1).toISOString(), updated_at: new Date(2026,1,16-index).toISOString() }));
  const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4173',
    'access-control-allow-headers': 'content-type,x-portal-session', 'access-control-allow-methods': 'POST,OPTIONS' };
  await context.addInitScript(() => sessionStorage.setItem('game-portal.user.session.v1', 'a'.repeat(64)));
  await context.route('**/assets/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const config = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "" };' }));
  await context.route('**/functions/v1/portal', route => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers })
    : route.fulfill({ headers, json: route.request().postDataJSON().action === 'user.me' ? { user: { id: 'history-user', role: 'uploader' } } : { submissions: games } }));
  await page.goto(path);
  const list = page.getByRole('region', { name: '投稿ゲーム一覧' });
  const titles = list.locator('h3');
  await expect(titles).toHaveCount(16);
  await expect(titles.first()).toHaveText('Game 16');
  expect(await list.evaluate(node => node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY === 'auto')).toBe(true);
  await page.getByRole('searchbox', { name: '投稿を検索' }).fill('special');
  await expect(titles).toHaveText(['Game 6']);
  await page.getByRole('searchbox', { name: '投稿を検索' }).fill('no match');
  await expect(list).toContainText('条件に一致する投稿がありません。');
  await page.getByRole('searchbox', { name: '投稿を検索' }).fill('');
  await page.getByRole('combobox', { name: '状態で絞り込み' }).selectOption('pending');
  await expect(titles).toHaveCount(8);
  await page.getByRole('combobox', { name: '状態で絞り込み' }).selectOption('');
  await page.getByRole('combobox', { name: '並び替え', exact: true }).selectOption('title');
  await page.getByRole('combobox', { name: '順序', exact: true }).selectOption('asc');
  await expect(titles.first()).toHaveText('Game 1');
  await expect(titles.nth(1)).toHaveText('Game 2');
  await page.getByRole('combobox', { name: '並び替え', exact: true }).selectOption('updated_at');
  await expect(titles.first()).toHaveText('Game 16');
  await page.getByRole('combobox', { name: '並び替え', exact: true }).selectOption('manual');
  await expect(page.getByRole('combobox', { name: '順序', exact: true })).toBeDisabled();
  await list.getByRole('button', { name: '「Game 16」を下へ', exact: true }).click();
  await list.getByRole('button', { name: '「Game 16」を下へ', exact: true }).click();
  await expect(titles.nth(2)).toHaveText('Game 16');
  await page.goto(path === 'account/' ? 'upload/' : 'account/');
  await expect(page.getByRole('combobox', { name: '並び替え', exact: true })).toHaveValue('manual');
  await expect(titles.nth(2)).toHaveText('Game 16');
  await page.screenshot({ path: `test-results/history-${path.slice(0,-1)}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.screenshot({ path: `test-results/history-${path.slice(0,-1)}-mobile.png`, fullPage: true });
});

test('own game deletion requires both confirmations and returns to the updated list', async ({ context, page }) => {
  const game = { id: 'delete-test', title: 'Delete test', engine: 'other', version: '1', visibility: 'draft', status: 'unpublished' };
  const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4173',
    'access-control-allow-headers': 'content-type,x-portal-session', 'access-control-allow-methods': 'POST,OPTIONS' };
  let deletions = 0;
  await context.addInitScript(() => sessionStorage.setItem('game-portal.user.session.v1', 'a'.repeat(64)));
  await context.route('**/assets/config.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export const config = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "" };' }));
  await context.route('**/functions/v1/portal', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const { action, data } = route.request().postDataJSON();
    if (action === 'user.submission.delete') {
      expect(data).toEqual({ submission_id: game.id, title: game.title, confirmation: 'delete' });
      deletions++;
    }
    return route.fulfill({ headers, json: action === 'user.me' ? { user: { role: 'uploader' } }
      : action === 'user.submission.delete' ? { deleted: true, cleanup_pending: false }
      : { submissions: deletions ? [] : [game] } });
  });
  await page.goto('account/?game=delete-test');
  const remove = page.getByRole('button', { name: 'ゲームを削除する', exact: true });
  page.once('dialog', dialog => { expect(dialog.message()).toContain('1/2'); dialog.dismiss(); });
  await remove.click();
  await expect(page.locator('#message')).toContainText('キャンセル');
  expect(deletions).toBe(0);
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('1/2');
    page.once('dialog', second => { expect(second.message()).toContain('2/2'); second.dismiss(); });
    await dialog.accept();
  });
  await remove.click();
  await expect(page.locator('#message')).toContainText('キャンセル');
  expect(deletions).toBe(0);
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('1/2');
    page.once('dialog', second => { expect(second.message()).toContain('2/2'); second.accept(); });
    await dialog.accept();
  });
  await remove.click();
  await expect(page.locator('#message')).toHaveText('ゲームを削除しました。');
  await expect(page).toHaveURL(/\/account\/$/);
  await expect(remove).toHaveCount(0);
  expect(deletions).toBe(1);
});

for (const retry of [false, true]) test(`HTML ${retry ? 'resend' : 'upload'} recovers a lost completion response`, async ({ context, page }) => {
  const submission = { id: 'upload-result', title: 'HTML upload test', engine: 'scratch', version: '1.0.0', visibility: 'draft', status: 'draft', package_ready: true };
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
      : { submissions: saved ? [submission] : retry ? [{ ...submission, status: 'uploading', package_ready: false }] : [] } });
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
  await page.goto(retry ? 'account/?game=upload-result' : 'upload/');
  if (!retry) {
    await page.getByLabel('ゲーム名', { exact: true }).fill(submission.title);
    await page.getByRole('combobox', { name: 'エンジン', exact: true }).selectOption('scratch');
  }
  const fileInput = page.getByLabel(retry ? 'ゲームファイルを再選択' : 'ゲームファイルを選択');
  expect(await fileInput.getAttribute('accept')).toBeNull();
  await fileInput.setInputFiles({ name: 'my-game.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><html><body>Game</body></html>') });
  const submitText = retry ? '変更を保存' : 'ゲームを投稿';
  if (!retry) await page.locator('[name=rights_confirmed]').check();
  await page.getByRole('button', { name: submitText, exact: true }).click();
  await uploadReceived;
  await expect(page.getByRole('button', { name: submitText, exact: true })).toBeDisabled();
  await expect(page.getByLabel('ゲーム名', { exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'エンジン' })).toBeDisabled();
  await expect(fileInput).toBeDisabled();
  await expect(page.locator('#message')).toBeEmpty();
  const fileUploadStatus = page.locator('form').filter({ has: fileInput }).locator('.upload-status');
  await expect(fileUploadStatus).toContainText('送信');
  expect(await fileUploadStatus.evaluate(node => node.previousElementSibling.textContent)).toBe(submitText);
  release();
  if (retry) {
    await expect(page.getByRole('heading', { name: 'ゲームファイルを再送' })).toHaveCount(0);
    await expect(page.locator('#message')).toContainText('ゲームファイルも保存しました');
  } else {
    await expect(page.getByRole('heading', { name: '投稿が完了しました' })).toBeVisible();
    await expect(page.getByRole('link', { name: '投稿したゲームを管理・プレイ →' })).toHaveAttribute('href', /game=upload-result/);
  }
});

test('shared login reveals admin navigation only after server authentication and logout hides it everywhere', async ({ context, page }) => {
  await context.route('**/assets/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const config = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "" };' }));
  await page.goto('./');
  const adminLink = page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: '管理画面', exact: true });
  await expect(adminLink).toBeHidden();
  await page.getByRole('link', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('ユーザー名', { exact: true }).fill('browser_owner');
  await page.getByLabel('パスワード', { exact: true }).fill('browser-test-admin-only');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: '管理画面 — browser_owner', exact: true })).toBeVisible();
  await expect(adminLink).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('game-portal.user.session.v1'))).toBeNull();
  const adminToken = await page.evaluate(() => sessionStorage.getItem('game-portal.admin.session.v1'));
  await page.getByRole('link', { name: 'ホーム', exact: true }).click();
  await expect(adminLink).toBeVisible();
  await page.goto('game.html?id=scratch-demo');
  await expect(adminLink).toBeVisible();
  await page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
  await expect(adminLink).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('game-portal.admin.session.v1'))).toBeNull();
  // A revoked token copied back into storage cannot make the link visible.
  await page.evaluate(token => sessionStorage.setItem('game-portal.admin.session.v1', token), adminToken);
  await page.goto('./');
  await expect(adminLink).toBeHidden();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('game-portal.admin.session.v1'))).toBeNull();
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
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'ユーザー作成' })).toBeVisible();
  const create = page.locator('section').filter({ has: page.getByRole('heading', { name: 'ユーザー作成', exact: true }) });
  await create.getByLabel('ユーザー名').fill('browser_user');
  await create.getByLabel('初期の本人用パスワード').fill('browser-test-user-only');
  await create.getByLabel('ユーザー権限').selectOption('uploader');
  await create.getByRole('button', { name: '作成', exact: true }).click();
  await expect(page.locator('#message')).toHaveText('ユーザーを作成しました。');
  await page.locator('#users .row').filter({has:page.getByRole('heading',{name:'browser_user',exact:true})}).getByRole('button', { name: '管理', exact: true }).click();
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
  await submitLogin(user);
  await expect(user.getByRole('button', { name: 'パスワードを変更', exact: true })).toBeVisible();
  await expect(user.locator('#portal')).not.toContainText('support');
  expect(await user.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 1, session: 1 });
  await user.reload();
  await expect(user.getByRole('button', { name: 'パスワードを変更', exact: true })).toBeVisible();
  await expect(user.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: 'ログアウト' })).toBeVisible();
  const created = await user.evaluate(async () => {
    const policy=await (await fetch('http://127.0.0.1:54321/functions/v1/portal/policy',{method:'POST'})).json();
    const response = await fetch('http://127.0.0.1:54321/functions/v1/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-Portal-Session': sessionStorage.getItem('game-portal.user.session.v1') },
      body: JSON.stringify({ action: 'user.submission.create', data: {
        terms_version:policy.terms.version, rights_confirmed:'yes', title: '編集テスト', engine: 'godot', description: '', version: '1.0.0', controls: '', visibility: 'draft', published_at: '' } }),
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
  await submitLogin(user);
  await expect(user.locator('#message')).toContainText('ユーザー名またはパスワード');
  await selected.getByRole('button', { name: 'BANを解除', exact: true }).click();
  await expect(page.locator('#message')).toHaveText('変更を保存しました。');
  await user.getByLabel('パスワード', { exact: true }).fill('browser-test-user-only');
  await submitLogin(user);
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


test('tag selection, editing and administrator management use the authenticated backend', async ({context,page})=>{
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 await page.goto('login/');
 await page.getByLabel('ユーザー名',{exact:true}).fill('browser_owner');
 await page.getByLabel('パスワード',{exact:true}).fill('browser-test-admin-only');
 await submitLogin(page);
 await expect(page.getByRole('heading',{name:'タグ管理',exact:true})).toBeVisible();
 const add=page.locator('#tag-management details').filter({has:page.getByText('新しいタグを追加',{exact:true})});
 await add.locator('summary').click();
 await add.getByLabel('タグ名',{exact:true}).fill('テストタグ');
 await add.getByLabel('slug（半角英小文字・数字・ハイフン）',{exact:true}).fill('browser-test-tag');
 await add.getByRole('button',{name:'タグを追加',exact:true}).click();
 await expect(page.locator('#message')).toHaveText('タグを追加しました。');
 await page.evaluate(async()=>{await fetch('http://127.0.0.1:54321/functions/v1/portal',{method:'POST',headers:{'Content-Type':'application/json','X-Portal-Session':sessionStorage.getItem('game-portal.admin.session.v1')},body:JSON.stringify({action:'admin.create',data:{username:'browser_tag_user',password:'browser-tag-test-only',role:'uploader'}})});});
 const user=await context.newPage();await user.goto('http://127.0.0.1:4173/Game-Portal/login/');
 await user.getByLabel('ユーザー名',{exact:true}).fill('browser_tag_user');await user.getByLabel('パスワード',{exact:true}).fill('browser-tag-test-only');
 await submitLogin(user);await expect(user.getByRole('heading',{name:'アカウント',exact:true})).toBeVisible();
 await user.goto('http://127.0.0.1:4173/Game-Portal/upload/');
 const picker=user.locator('.tag-picker');await expect(picker.locator('.tag-count')).toHaveText('選択中 0 / 22');
 const chips=picker.getByRole('button');await picker.locator('details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));for(let i=0;i<22;i++)await chips.nth(i).click();
 await expect(picker.locator('.tag-count')).toHaveText('選択中 22 / 22');await expect(chips.nth(22)).toBeDisabled();
 await chips.nth(0).click();await expect(chips.nth(22)).toBeEnabled();await chips.nth(22).click();
 const ids=await user.evaluate(()=>[...document.querySelectorAll('.tag-picker button[aria-pressed="true"]')].map(n=>n.textContent));expect(new Set(ids).size).toBe(22);
 await user.setViewportSize({width:390,height:844});expect(await user.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await user.screenshot({path:'test-results/tags-upload-mobile.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('tag filters combine with engine and text search, and cards cap visible tags',async({context,page})=>{
 const tags=Array.from({length:5},(_,i)=>({id:'6b61c4a0-1204-4000-8000-'+String(i+1).padStart(12,'0'),name:['アクション','3D','1人用','高難易度','ゲームパッド'][i],slug:['action','3d','single','hard','gamepad'][i],category:'ジャンル',is_active:true}));
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 await context.route('**/functions/v1/portal/catalog',route=>route.fulfill({json:{games:[{slug:'a'.repeat(36),title:'Tag game',engine:'godot',description:'test',tags},{slug:'b'.repeat(36),title:'Other tagged',engine:'scratch',description:'test',tags:[tags[0]]}]}}));
 await context.route('**/functions/v1/portal/tags',route=>route.fulfill({json:{tags}}));
 await page.goto('?tag=action');await expect(page.locator('.game-card')).toHaveCount(2);await expect(page.locator('.game-card').first().locator('.tag-overflow')).toHaveText('+2');
 await page.locator('.game-card').first().getByRole('link',{name:'3D',exact:true}).scrollIntoViewIfNeeded();
 const cardTag=await page.locator('.game-card').first().getByRole('link',{name:'3D',exact:true}).boundingBox();
 await page.mouse.click(cardTag.x+cardTag.width/2,cardTag.y+cardTag.height/2);
 await expect(page).toHaveURL(/\?tag=3d#games$/);await expect(page.locator('.game-card')).toHaveCount(1);
 await page.goto('?tag=action');await expect(page.locator('.game-card')).toHaveCount(2);
 await expect(page.locator('#searchOptions')).not.toHaveAttribute('open','');
 await expect(page.locator('#activeTagFilters')).toContainText('アクション');
 await expect(page.getByRole('button',{name:/タグで絞り込み/})).toHaveCount(0);
 await page.locator('#searchOptions summary').click();
 await page.getByRole('searchbox',{name:'タグを検索',exact:true}).fill('3D');
 await page.locator('.tag-filter-options').getByRole('button',{name:'3D',exact:true}).click();await expect(page.locator('.game-card')).toHaveCount(1);
 await page.locator('#searchOptions summary').click();
 await expect(page.getByRole('searchbox',{name:'タグを検索',exact:true})).toBeHidden();
 await expect(page.locator('#activeTagFilters')).toContainText('3D');
 await page.locator('#searchOptions summary').click();
 await page.screenshot({path:'test-results/tag-filter-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.tag-filter').screenshot({path:'test-results/tag-filter-mobile.png'});
 await page.getByRole('searchbox',{name:'タグを検索',exact:true}).press('Escape');
 await expect(page.locator('#searchOptions')).not.toHaveAttribute('open','');
 await expect(page.locator('#searchOptions summary')).toBeFocused();
 await page.getByRole('button',{name:'Scratch',exact:true}).click();await expect(page.locator('.game-card')).toHaveCount(0);
 await page.getByRole('button',{name:'すべて',exact:true}).click();await page.locator('#searchInput').fill('Tag game');await expect(page.locator('.game-card')).toHaveCount(1);
 await page.reload();await expect(page.locator('.game-card')).toHaveCount(1);
 await page.getByRole('button',{name:'タグをすべて解除',exact:true}).click();
 await expect(page.locator('.game-card')).toHaveCount(4);
});


test('owners can add and replace a submitted thumbnail without changing the game',async({context,page})=>{
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 await page.goto('login/');await page.getByLabel('ユーザー名',{exact:true}).fill('browser_owner');await page.getByLabel('パスワード',{exact:true}).fill('browser-test-admin-only');await submitLogin(page);
 await expect(page.getByRole('heading',{name:'管理画面 — browser_owner',exact:true})).toBeVisible();
 const made=await page.evaluate(async()=>{
  const post=async(action,data,session)=>{if(['user.login','user.submission.create'].includes(action)){const policy=await (await fetch('http://127.0.0.1:54321/functions/v1/portal/policy',{method:'POST'})).json();data={...data,terms_accepted:true,terms_version:policy.terms.version,rights_confirmed:'yes'};}const r=await fetch('http://127.0.0.1:54321/functions/v1/portal',{method:'POST',headers:{'Content-Type':'application/json',...(session?{'X-Portal-Session':session}:{})},body:JSON.stringify({action,data})});return r.json();};
  await post('admin.create',{username:'browser_image_user',password:'browser-image-test-only',role:'uploader'},sessionStorage.getItem('game-portal.admin.session.v1'));
  const login=await post('user.login',{username:'browser_image_user',password:'browser-image-test-only'});
  const game=await post('user.submission.create',{title:'Thumbnail test',engine:'other',version:'1',visibility:'draft'},login.token);
  return {token:login.token,id:game.submission.id};
 });
 const user=await context.newPage();await user.goto('http://127.0.0.1:4173/Game-Portal/');await user.evaluate(token=>sessionStorage.setItem('game-portal.user.session.v1',token),made.token);
 await user.goto('http://127.0.0.1:4173/Game-Portal/account/?game='+made.id);
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXWQAAAAASUVORK5CYII=','base64');
 await user.getByLabel('ゲーム名',{exact:true}).fill('Thumbnail edited');await user.getByLabel('説明（任意）',{exact:true}).fill('Unified editor description');await user.getByLabel('変更するサムネイル',{exact:true}).setInputFiles({name:'first.png',mimeType:'image/png',buffer:image});
 await expect(user.getByAltText('新しいサムネイルのプレビュー')).toBeVisible();await expect.poll(()=>user.getByAltText('新しいサムネイルのプレビュー').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);await expect(user.locator('.game-edit-form button[type=submit]')).toHaveCount(1);await user.getByRole('button',{name:'変更を保存',exact:true}).click();
 await expect(user.locator('#message')).toHaveText('変更を保存しました。');await expect.poll(()=>user.locator('.game-edit-form img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);await expect(user.getByRole('button',{name:'変更を保存',exact:true})).toBeVisible();
 await user.getByLabel('変更するサムネイル',{exact:true}).setInputFiles({name:'second.png',mimeType:'image/png',buffer:image});await user.getByRole('button',{name:'変更を保存',exact:true}).click();
 await expect(user.locator('#message')).toHaveText('変更を保存しました。');await expect(user.getByRole('heading',{name:'Thumbnail edited',exact:true})).toBeVisible();
 await user.getByRole('combobox',{name:'公開範囲',exact:true}).selectOption('unlisted');await user.getByLabel('ゲームファイルを再選択',{exact:true}).setInputFiles({name:'first.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><html><body>first</body></html>')});
 await user.getByRole('button',{name:'変更を保存',exact:true}).click();await expect(user.locator('#message')).toContainText('ゲームファイルも保存しました');
 await user.getByLabel('ゲームファイルを再選択',{exact:true}).setInputFiles({name:'new.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><html><body>updated</body></html>')});
 await user.getByRole('button',{name:'変更を保存',exact:true}).click();await expect(user.locator('#message')).toContainText('ゲームファイルも保存しました');
 await expect(user.getByRole('heading',{name:'Thumbnail edited',exact:true})).toBeVisible();await expect(user.getByRole('button',{name:'変更を保存',exact:true})).toBeVisible();
 await expect(user.getByLabel('説明（任意）',{exact:true})).toHaveValue('Unified editor description');await expect(user.getByRole('combobox',{name:'公開範囲',exact:true})).toHaveValue('unlisted');await expect.poll(()=>user.locator('.game-edit-form img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);await user.screenshot({path:'test-results/package-replacement.png',fullPage:true});
 await user.setViewportSize({width:390,height:844});expect(await user.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await user.locator('.game-edit-form > section').filter({has:user.getByRole('heading',{name:'サムネイル',exact:true})}).screenshot({path:'test-results/thumbnail-edit-mobile.png'});
});

test('account sharing, administrator management and permanent deletion work through real authorization',async({context,page})=>{
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 await page.goto('login/');await page.getByLabel('ユーザー名',{exact:true}).fill('browser_owner');await page.getByLabel('パスワード',{exact:true}).fill('browser-test-admin-only');await submitLogin(page);
 await expect(page.getByRole('heading',{name:'管理画面 — browser_owner',exact:true})).toBeVisible();
 const accounts=await page.evaluate(async()=>{
  const post=async(action,data,token)=>{if(['user.login','user.submission.create'].includes(action)){const policy=await (await fetch('http://127.0.0.1:54321/functions/v1/portal/policy',{method:'POST'})).json();data={...data,terms_accepted:true,terms_version:policy.terms.version,rights_confirmed:'yes'};}const r=await fetch('http://127.0.0.1:54321/functions/v1/portal',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Portal-Session':token}:{})},body:JSON.stringify({action,data})});return r.json();};
  const admin=sessionStorage.getItem('game-portal.admin.session.v1');
  await post('admin.create',{username:'browser_shared_author',password:'browser-share-test-only',role:'trusted_uploader'},admin);
  const friend=await post('admin.create',{username:'browser_shared_friend',password:'browser-share-test-only',role:'player'},admin);
  await post('admin.admin.create',{username:'browser_manage_admin',password:'browser-share-test-only'},admin);
  return {author:await post('user.login',{username:'browser_shared_author',password:'browser-share-test-only'}),friend:await post('user.login',{username:'browser_shared_friend',password:'browser-share-test-only'}),friendId:friend.user.id};
 });
 expect(accounts.author.token).toMatch(/^[a-f0-9]{64}$/);expect(accounts.friend.token).toMatch(/^[a-f0-9]{64}$/);
 const author=await context.newPage();await author.goto('./');await author.evaluate(token=>{sessionStorage.removeItem('game-portal.admin.session.v1');sessionStorage.setItem('game-portal.user.session.v1',token);},accounts.author.token);await author.goto('upload/');
 await author.getByLabel('ゲーム名',{exact:true}).fill('Shared browser game');await author.getByRole('combobox',{name:'エンジン',exact:true}).selectOption('other');
 await author.getByRole('combobox',{name:'公開範囲',exact:true}).selectOption('shared');await author.getByLabel('共有相手のアカウントID（改行またはカンマ区切り・最大50人）',{exact:true}).fill(accounts.friendId);
 await author.getByLabel('ゲームファイルを選択',{exact:true}).setInputFiles({name:'shared.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><html><body>Shared browser play</body></html>')});
 await author.locator('[name=rights_confirmed]').check();await author.getByRole('button',{name:'ゲームを投稿',exact:true}).click();await expect(author.getByRole('heading',{name:'投稿が完了しました',exact:true})).toBeVisible();
 await author.getByRole('link',{name:'投稿したゲームを管理・プレイ →',exact:true}).click();await expect(author.getByRole('combobox',{name:'公開範囲',exact:true})).toHaveValue('shared');
 await expect(author.getByLabel('共有相手のアカウントID（改行またはカンマ区切り・最大50人）',{exact:true})).toHaveValue(accounts.friendId);
 const friend=await context.newPage();await friend.goto('./');await friend.evaluate(token=>{sessionStorage.removeItem('game-portal.admin.session.v1');sessionStorage.setItem('game-portal.user.session.v1',token);},accounts.friend.token);await friend.goto('account/');
 await expect(friend.getByText('アカウントID: '+accounts.friendId,{exact:true})).toBeVisible();await friend.getByRole('link',{name:'プレイする →',exact:true}).click();
 await expect(friend.locator('#gameTitle')).toHaveText('Shared browser game');await expect(friend.frameLocator('#gameFrame').locator('body')).toContainText('Shared browser play');await friend.screenshot({path:'test-results/shared-game.png',fullPage:true});
 await page.reload();
 const adminRow=page.locator('#users .row').filter({has:page.getByRole('heading',{name:'browser_manage_admin',exact:true})});await adminRow.getByRole('button',{name:'管理',exact:true}).click();
 await expect(page.getByRole('button',{name:'管理アカウントを完全削除',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'管理者権限',exact:true}).selectOption('super_admin');await page.getByRole('button',{name:'管理者権限を変更',exact:true}).click();await expect(page.locator('#message')).toHaveText('管理アカウントを更新しました。');
 let confirmationName='Shared browser game';let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.accept(dialog.type()==='prompt'?confirmationName:undefined);});
 await page.locator('#reviews .row').filter({has:page.getByRole('heading',{name:'Shared browser game',exact:true})}).getByRole('button',{name:'ゲームを完全削除',exact:true}).click();
 await expect(page.locator('#message')).toContainText('削除しました');expect(dialogs).toBe(2);
 await friend.reload();await expect(friend.locator('#playerStatus')).toHaveText('読込に失敗');
 const userRow=page.locator('#users .row').filter({has:page.getByRole('heading',{name:'browser_shared_author',exact:true})});await userRow.getByRole('button',{name:'管理',exact:true}).click();confirmationName='browser_shared_author';
 await page.screenshot({path:'test-results/account-deletion.png',fullPage:true});
 await page.getByRole('button',{name:'アカウントを完全削除',exact:true}).click();await expect(page.locator('#message')).toContainText('完全削除しました');expect(dialogs).toBe(4);
 await author.goto('account/');await expect(author.getByRole('button',{name:'ログイン',exact:true})).toBeVisible();
});
