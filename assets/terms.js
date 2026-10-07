import { config } from './config.js';
export const acceptanceKey = 'game-portal.terms.acceptance.v1';
export const consentText = '利用規約に同意します。18歳未満の場合は、保護者の同意を得ています。';
let memoryAcceptance;
export async function currentTerms() {
  if (!config.supabaseUrl) throw new Error('unavailable');
  const response = await fetch(`${config.supabaseUrl}/functions/v1/portal/policy`, {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: config.anonKey ? { apikey: config.anonKey } : {}, signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || typeof result.terms?.version !== 'string' || !result.terms.version || !result.terms.effective_at) throw new Error('unavailable');
  return result.terms;
}
export function rememberAcceptance(version, acceptedAt = new Date().toISOString()) {
  memoryAcceptance = { version, acceptedAt };
  try { localStorage.setItem(acceptanceKey, JSON.stringify(memoryAcceptance)); } catch { /* This page can still be used. */ }
}
function accepted(version) {
  try {
    const saved = JSON.parse(localStorage.getItem(acceptanceKey));
    return saved?.version === version && typeof saved.acceptedAt === 'string' && Number.isFinite(Date.parse(saved.acceptedAt));
  } catch { return memoryAcceptance?.version === version; }
}
export function consentCheckbox(href, name = 'terms_accepted', text = consentText) {
  const label = document.createElement('label'); label.className = 'consent-checkbox';
  const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.required = true; input.value = 'yes';
  const span = document.createElement('span');
  const [before, ...rest] = text.split('利用規約'); span.append(before);
  const link = document.createElement('a'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '利用規約';
  span.append(link, rest.join('利用規約')); label.append(input, span);
  return label;
}
// Neither catalog nor game package requests start until this promise resolves.
export function requireTerms(container, { buttonText = '同意してゲームを探す', href = './terms/' } = {}) {
  return new Promise(resolve => {
    const box = document.createElement('section'); box.className = 'terms-gate'; box.setAttribute('aria-label', '利用規約への同意');
    container.append(box);
    const load = async () => {
      box.replaceChildren();
      const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '利用規約を確認しています…'; box.append(status);
      try {
        const policy = await currentTerms();
        if (accepted(policy.version)) { box.remove(); resolve(policy); return; }
        status.textContent = 'GAME PORTALを利用するには利用規約への同意が必要です。';
        const form = document.createElement('form'); form.append(consentCheckbox(href));
        const version = document.createElement('p'); version.className = 'muted'; version.textContent = `規約バージョン：${policy.version} ／ 適用日：${policy.effective_at}`;
        const button = document.createElement('button'); button.type = 'submit'; button.textContent = buttonText;
        form.append(version, button); box.append(form);
        form.addEventListener('submit', async event => {
          event.preventDefault(); if (!form.reportValidity()) return; button.disabled = true;
          try {
            const latest = await currentTerms();
            if (latest.version !== policy.version) { await load(); return; }
            rememberAcceptance(policy.version); box.remove(); resolve(policy);
          } catch { status.textContent = '規約情報を取得できません。しばらくして再試行してください。'; button.disabled = false; }
        });
      } catch {
        status.textContent = '規約情報を取得できません。しばらくして再試行してください。';
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '再試行'; retry.onclick = load; box.append(retry);
      }
    };
    load();
  });
}
