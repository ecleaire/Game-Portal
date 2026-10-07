// Resolve the device palette before rendering, unless the visitor chose an override.
(() => {
  const key = 'game-portal.theme.v1';
  const root = document.documentElement;
  const device = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  let select;
  function apply(value) {
    preference = ['light', 'dark'].includes(value) ? value : 'system';
    const light = preference === 'light' || (preference === 'system' && !device.matches);
    root.dataset.theme = light ? 'light' : 'dark';
    root.dataset.themePreference = preference;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = light ? '#f4f7fb' : '#090e19';
    if (select) select.value = preference;
  }
  try { apply(localStorage.getItem(key)); } catch { apply('system'); }
  device.addEventListener('change', () => {
    if (preference === 'system') apply('system');
  });
  document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('.site-footer nav');
    if (!nav) return;
    const label = document.createElement('label');
    label.className = 'theme-control';
    label.append('表示モード');
    select = document.createElement('select');
    for (const [value, text] of [['system', 'デバイス設定'], ['light', 'ライト'], ['dark', 'ダーク']]) {
      const option = document.createElement('option');
      option.value = value; option.textContent = text; select.append(option);
    }
    select.addEventListener('change', () => {
      apply(select.value);
      try { localStorage.setItem(key, preference); } catch { /* In-page switching still works. */ }
    });
    label.append(select); nav.append(label);
    apply(preference);
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
