// Apply the saved palette before rendering; the existing dark palette is the default.
(() => {
  const key = 'game-portal.theme.v1';
  const root = document.documentElement;
  let button;
  function apply(value) {
    const light = value === 'light';
    root.dataset.theme = light ? 'light' : 'dark';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = light ? '#f4f7fb' : '#090e19';
    if (button) {
      button.textContent = light ? '☾ ダーク' : '☀ ライト';
      button.setAttribute('aria-label', light ? 'ダークモードに切り替える' : 'ライトモードに切り替える');
    }
  }
  try { apply(localStorage.getItem(key)); } catch { apply('dark'); }
  document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('.site-nav');
    if (!nav) return;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', () => {
      apply(root.dataset.theme === 'light' ? 'dark' : 'light');
      try { localStorage.setItem(key, root.dataset.theme); } catch { /* In-page switching still works. */ }
    });
    nav.append(button);
    apply(root.dataset.theme);
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
