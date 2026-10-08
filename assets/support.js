import { logoutSessions } from './navigation.js?v=20261009b';

// Help pages use the same session-aware navigation as the application pages.
document.querySelectorAll('[data-portal-login]').forEach(link => {
  link.addEventListener('click', async event => {
    if (!link.hash || link.hash !== '#logout') return;
    event.preventDefault();
    await logoutSessions();
    location.assign(new URL('../', import.meta.url));
  });
});
