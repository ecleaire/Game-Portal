import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { packageWebFiles } from '../assets/zip-upload.js';

const root = resolve(import.meta.dirname, '..');
const cache = process.env.OFFLINE_RUNTIME_CACHE || join(root, '.tools/offline-runtime');
const output = join(root, 'offline-release');
const lock = JSON.parse(await readFile(join(root, 'offline-html/runtime-lock.json'), 'utf8'));
const prepare = process.argv.includes('--prepare');
const runtime = {};
for (const file of lock.files) {
  const target = join(cache, file.path); let bytes;
  try { bytes = await readFile(target); }
  catch (e) {
    if (!prepare) throw new Error('Runtime missing. Run npm run offline:prepare with network access first: ' + file.path);
    // Native fetch respects the session proxy with Node >=24 NODE_USE_ENV_PROXY=1.
    const response = await fetch(file.url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('Runtime download failed: ' + file.path + ' ' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Runtime checksum mismatch: ' + file.path);
    await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, bytes);
  }
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Runtime checksum mismatch: ' + file.path);
  runtime[file.path] = bytes.toString('base64');
}
const source = async path => readFile(join(root, path), 'utf8');
const wrap = (name, code, exports) => `const ${name}=(()=>{${code.replace(/^export /gm, '')}\nreturn {${exports}};})();`;
// TurboWarp's compiler needs dynamic JS inside the opaque game sandbox. This
// changes only the standalone bundle, never the public portal's preview policy.
const offlinePreview = (await source('assets/private-preview.js')).replaceAll("script-src 'unsafe-inline' data: blob: 'wasm-unsafe-eval'", "script-src 'unsafe-inline' 'unsafe-eval' data: blob: 'wasm-unsafe-eval'");
const script = [
  'const tagPresets=' + JSON.stringify(JSON.parse(await source('offline-html/tag-presets.json')).tags) + ';',
  wrap('preview', offlinePreview, 'unpackPrivateZip,webArchiveLayout,privatePreviewDocument'),
  wrap('library', await source('offline-html/library.js'), 'safePath,getFile,writeFile,loadLibraryId,ensureLibraryId,loadMetadata,saveMetadata,loadGameSettings,saveGameSettings,tagsFrom,gameId,scan,readTree,postGame,validatePyxapp,embeddedPyxel'),
  wrap('localState', await source('offline-html/local-state.js'), 'cacheHandle,loadLocalSave,writeLocalSave,acquirePlaySession,validSave'),
  wrap('player', await source('offline-html/player.js'), 'startPlayer'),
  await source('offline-html/app.js'),
].join('\n').replaceAll('</script', '<\\/script');
const html = (await source('offline-html/index.html')).replace('/*__STYLE__*/', await source('offline-html/style.css')).replace('__RUNTIME__', JSON.stringify(runtime)).replace('/*__SCRIPT__*/', script);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'GAME-PORTAL.html'), html);
const readme = await source('docs/OFFLINE_HTML.md');
const licenses = lock.files.filter(f => f.path.endsWith('/LICENSE')).map(f => f.path + '\n' + Buffer.from(runtime[f.path], 'base64').toString('utf8')).join('\n\n');
await writeFile(join(output, 'THIRD-PARTY-LICENSES.txt'), licenses);
await writeFile(join(output, 'README.txt'), readme);
const zip = await packageWebFiles([new File([html], 'GAME-PORTAL.html'), new File([readme], 'README.txt'), new File([licenses], 'THIRD-PARTY-LICENSES.txt')]);
await writeFile(join(output, 'GAME-PORTAL-HTML.zip'), Buffer.from(await zip.arrayBuffer()));
console.log(`Offline launcher built: ${Buffer.byteLength(html)} bytes, ${lock.files.length} verified runtime files. No runtime network required.`);
