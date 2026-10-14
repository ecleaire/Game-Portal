// Executed inside an opaque sandbox. Only game bytes, runtime bytes and its own
// localStorage snapshot cross the message port; directory handles never do.
function webBootstrap() {
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'offline-game' || !event.ports[0]) return;
    const port = event.ports[0];
    const snapshot = event.data.saved;
    window.offlineStorage = () => {
      const data = Object.assign(Object.create(null), snapshot);
      const send = () => port.postMessage({ type: 'save', data });
      const api = { getItem: key => Object.hasOwn(data, key) ? data[key] : null,
        setItem: (key, value) => { if (JSON.stringify({ ...data, [key]: String(value) }).length > 500000) throw new DOMException('保存容量を超えました。', 'QuotaExceededError'); data[key] = String(value); send(); },
        removeItem: key => { delete data[key]; send(); }, clear: () => { for (const key of Object.keys(data)) delete data[key]; send(); },
        key: index => Object.keys(data)[index] ?? null, get length() { return Object.keys(data).length; } };
      Object.defineProperty(window, 'localStorage', { value: api });
      window.offlineReady = () => port.postMessage({ type: 'ready' });
    };
    try {
      const decoder = new TextDecoder();
      const mime = name => ({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',wasm:'application/wasm',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',ogg:'audio/ogg',mp3:'audio/mpeg',wav:'audio/wav',woff:'font/woff',woff2:'font/woff2'})[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
      const fn = window.offlinePreview;
      const html = fn(event.data.files, (bytes, type) => URL.createObjectURL(new Blob([bytes], { type })), ';window.offlineStorage();addEventListener("load",()=>window.offlineReady(),{once:true});');
      document.open(); document.write(html); document.close();
    } catch (e) { port.postMessage({ type: 'error', message: e.message }); }
  }, { once: true });
}
function pyxelBootstrap() {
  addEventListener('message', async event => {
    if (event.source !== parent || event.data?.type !== 'offline-game' || !event.ports[0]) return;
    const port = event.ports[0], assets = event.data.runtime, urls = new Map(), bytes = new Map();
    const nativeFetch = fetch.bind(window);
    const type = name => name.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(name) ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : name.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    const key = raw => {
      const url = new URL(typeof raw === 'string' ? raw : raw instanceof URL ? raw.href : raw.url, 'https://offline.invalid/runtime/pyxel/');
      return url.pathname.includes('/pyodide/v') ? 'pyodide/' + url.pathname.split('/').at(-1) : url.pathname.replace(/^\/runtime\//, '');
    };
    const read = name => {
      if (!Object.hasOwn(assets, name)) throw new Error('同梱ランタイムがありません：' + name);
      if (!bytes.has(name)) bytes.set(name, Uint8Array.from(atob(assets[name]), c => c.charCodeAt(0)));
      return bytes.get(name);
    };
    window.offlineURL = raw => {
      const name = key(raw);
      if (!urls.has(name)) urls.set(name, URL.createObjectURL(new Blob([read(name)], { type: type(name) })));
      return urls.get(name);
    };
    window.fetch = async (raw, options) => {
      const url = typeof raw === 'string' ? raw : raw instanceof URL ? raw.href : raw.url;
      if (/^(blob:|data:)/.test(url)) return nativeFetch(raw, options);
      try { const name = key(raw); return new Response(read(name), { headers: { 'Content-Type': type(name) } }); }
      catch { console.error('Offline runtime resource unavailable:', url); throw new TypeError('オフラインファイルがありません：' + url); }
    };
    try {
      let source = new TextDecoder().decode(read('pyxel/pyxel.js'));
      source = source.replace('console.log(params);', '');
      source = source.replace(/const _scriptDir = \(\(\) => \{[\s\S]*?\}\)\(\);/, 'const _scriptDir = "https://offline.invalid/runtime/pyxel/";');
      source = source.replace('script.src = scriptSrc;', 'script.src = window.offlineURL(scriptSrc);');
      for (const name of ['logoImage', 'promptImage', 'img']) source = source.replace(new RegExp(name + '\\.src = (`[^;]+`);', 'g'), name + '.src = window.offlineURL($1);');
      for (const name of ['iconLink', 'styleSheetLink']) source = source.replace(new RegExp(name + '\\.href = (`[^;]+`);', 'g'), name + '.href = window.offlineURL($1);');
      source = source.replace('await loadPyodide();', 'await loadPyodide({indexURL:"https://offline.invalid/runtime/pyodide/",createPyodideModule:(await import(window.offlineURL("https://offline.invalid/runtime/pyodide/pyodide.asm.mjs"))).default});');
      const script = document.createElement('script'); script.textContent = source; document.head.append(script);
      const interval = setInterval(() => {
        if (window.pyxelContext?.initialized) { port.postMessage({ type: 'ready' }); clearInterval(interval); }
        else if (document.getElementById('pyxel-prompt')) port.postMessage({ type: 'status', message: 'ゲーム画面をクリックして開始してください。' });
      }, 300);
      await window.launchPyxel({ command: 'play', name: 'game.pyxapp', base64: event.data.app, gamepad: 'enabled' });
    } catch (e) { port.postMessage({ type: 'error', message: 'Pyxelを起動できません：' + e.message }); }
  }, { once: true });
}
export function startPlayer(frame, options, preview, onMessage) {
  const channel = new MessageChannel();
  channel.port1.onmessage = event => onMessage(event.data);
  const mimeTypes = { html:'text/html',htm:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',wasm:'application/wasm',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',gif:'image/gif',ogg:'audio/ogg',mp3:'audio/mpeg',wav:'audio/wav',woff:'font/woff',woff2:'font/woff2' };
  // privatePreviewDocument is pure apart from these two browser helpers.
  const helpers = `const decoder=new TextDecoder();const mimeTypes=${JSON.stringify(mimeTypes)};const mime=n=>mimeTypes[n.split('.').pop().toLowerCase()]||'application/octet-stream';window.offlinePreview=${preview.privatePreviewDocument.toString()};`;
  const boot = options.kind === 'pyxapp' ? pyxelBootstrap : webBootstrap;
  const csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:; style-src 'unsafe-inline' blob:; img-src blob: data:; connect-src blob: data:; worker-src blob:; font-src blob: data:; media-src blob: data:; base-uri 'none'";
  frame.addEventListener('load', () => frame.contentWindow.postMessage({ type: 'offline-game', ...options }, '*', [channel.port2]), { once: true });
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:0;background:#080c0e;color:white}canvas{image-rendering:pixelated}</style><script>${(helpers + '(' + boot.toString() + ')();').replaceAll('</script', '<\\/script')}<\/script>`;
  return () => { channel.port1.close(); channel.port2.close(); frame.srcdoc = ''; };
}
