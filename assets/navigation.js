const token = sessionStorage.getItem('game-portal.user.session.v1');
if (/^[a-f0-9]{64}$/.test(token ?? '')) {
  document.querySelectorAll('[data-portal-account]').forEach(link => { link.hidden = false; });
  document.querySelectorAll('[data-portal-login]').forEach(link => { link.textContent = 'ログアウト'; link.href = 'login/#logout'; });
}
