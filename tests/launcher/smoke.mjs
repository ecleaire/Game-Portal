import { _electron as electron, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { archive } from './zip-fixture.mjs';

const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'portal-desktop-')));
const gameFolder = path.join(temp, 'games'); await fs.mkdir(gameFolder);
const source = path.join(gameFolder, 'Offline game.html');
const html = '<h1>Offline game works</h1><script>document.body.dataset.node=typeof require; document.body.dataset.ipc=typeof window.launcher;document.body.dataset.previous=localStorage.getItem("save")||"empty";localStorage.setItem("save","retained");fetch("https://example.com/blocked").then(()=>document.body.dataset.network="allowed",()=>document.body.dataset.network="blocked");</script>';
await fs.writeFile(source, html);
await fs.writeFile(path.join(gameFolder, 'Packed.zip'), archive([['web/index.html', '<h1>ZIP game works</h1><script>fetch("level.json").then(r=>r.json()).then(x=>document.body.dataset.level=x.level)</script>'], ['web/level.json', '{"level":"local"}']]));
if (process.platform === 'win32') await fs.copyFile(path.join(process.env.SystemRoot, 'System32', 'where.exe'), path.join(gameFolder, 'Native fixture.exe'));
let app;
const launchOptions = { args: [...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless'] : []), '--user-data-dir=' + path.join(temp, 'settings'), path.resolve('.')], env: { ...process.env, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || path.join(temp, 'cache') }, timeout: 30000 };
async function closeGame() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('gameportal:')).close()); }
async function play(page, title) {
  const opened = app.waitForEvent('window'); await page.locator('.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).getByRole('button', { name: 'プレイ' }).click();
  const window = await opened; await window.setViewportSize({ width: 1100, height: 760 }); return window;
}
try {
  app = await electron.launch(launchOptions); let page = await app.firstWindow(); await page.setViewportSize({ width: 1160, height: 800 });
  await expect(page.locator('#empty')).toContainText('設定');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await expect(page.getByRole('button', { name: /ログイン|取り込む|削除/ })).toHaveCount(0);
  await page.getByRole('button', { name: '設定', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, gameFolder);
  await page.getByRole('button', { name: 'フォルダーを指定', exact: true }).click();
  await expect(page.locator('#folderSummary')).toHaveText(gameFolder);
  await expect(page.locator('.card')).toHaveCount(process.platform === 'win32' ? 3 : 2);
  await page.screenshot({ path: path.join(os.tmpdir(), 'portal-launcher.png') });
  await page.locator('#search').fill('missing'); await expect(page.locator('.card')).toHaveCount(0); await page.locator('#search').fill('');
  const game = await play(page, 'Offline game');
  await expect(game.getByRole('heading', { name: 'Offline game works' })).toBeVisible();
  await expect(game.locator('body')).toHaveAttribute('data-node', 'undefined'); await expect(game.locator('body')).toHaveAttribute('data-ipc', 'undefined');
  await expect(game.locator('body')).toHaveAttribute('data-network', 'blocked'); await expect(game.locator('body')).toHaveAttribute('data-previous', 'empty');
  await closeGame();
  const zip = await play(page, 'Packed'); await expect(zip.getByRole('heading', { name: 'ZIP game works' })).toBeVisible(); await expect(zip.locator('body')).toHaveAttribute('data-level', 'local'); await closeGame();
  if (process.platform === 'win32') {
    await page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Native fixture', exact: true }) }).getByRole('button', { name: 'プレイ' }).click();
    await expect(page.locator('#status')).toHaveText('');
  }
  await app.close(); app = await electron.launch(launchOptions); page = await app.firstWindow(); await page.setViewportSize({ width: 1160, height: 800 });
  await expect(page.locator('#folderSummary')).toHaveText(gameFolder);
  const restored = await play(page, 'Offline game'); await expect(restored.locator('body')).toHaveAttribute('data-previous', 'retained'); await closeGame();
  await fs.writeFile(path.join(gameFolder, 'Added.html'), '<h1>New game</h1>'); await page.getByRole('button', { name: '再読み込み' }).click(); await expect(page.getByRole('heading', { name: 'Added', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const other = path.join(temp, 'empty-folder'); await fs.mkdir(other);
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.getByRole('button', { name: 'フォルダーを指定', exact: true }).click(); await expect(page.locator('.card')).toHaveCount(0);
  assert.equal(await fs.readFile(source, 'utf8'), html);
  console.log('Electron smoke passed: settings folder, direct scanning, HTML/ZIP play, isolated Web games, saved folder and progress, refresh and folder switching' + (process.platform === 'win32' ? ', real Windows EXE launch.' : '.'));
} catch (error) {
  if (process.env.GITHUB_ACTIONS) console.log('::error title=Offline launcher smoke::' + String(error.stack || error).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  throw error;
} finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
