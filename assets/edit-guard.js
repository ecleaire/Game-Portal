// No form content or credentials are copied into browser storage.
const forms = new Map();
let approvedDepartureUntil = 0;
function snapshot(form) {
  return JSON.stringify([
    ...[...form.elements].filter(input => input.name && !['submit','button'].includes(input.type)).map(input =>
      [input.name, input.type === 'file' ? [...input.files].map(file => [file.name,file.size,file.lastModified])
        : ['checkbox','radio'].includes(input.type) ? input.checked : input.value]),
    ...[...form.querySelectorAll('.tag-picker button[aria-pressed]')].map(input => [input.textContent,input.getAttribute('aria-pressed')]),
  ]);
}
export function protectEdits(form) {
  forms.set(form, { baseline: snapshot(form), dropped: false });
  form.addEventListener('drop', event => { if (event.dataTransfer?.files?.length && form.getAttribute('aria-busy') !== 'true') forms.get(form).dropped = true; });
}
function dirtyForms() {
  for (const form of forms.keys()) if (!form.isConnected) forms.delete(form);
  return [...forms].filter(([form,state]) => form.getAttribute('aria-busy') === 'true' || state.dropped || snapshot(form) !== state.baseline);
}
export function confirmLeaving() {
  if (Date.now() <= approvedDepartureUntil) return true;
  if (!dirtyForms().length) return true;
  const accepted = confirm('保存していない変更があります。この画面を離れると、入力内容と選択したファイルは失われます。移動しますか？');
  if (accepted) approvedDepartureUntil = Date.now() + 1000;
  return accepted;
}
window.addEventListener('beforeunload', event => {
  if (Date.now() > approvedDepartureUntil && dirtyForms().length) { event.preventDefault(); event.returnValue = ''; }
});
for (const type of ['input','change']) document.addEventListener(type, () => { approvedDepartureUntil = 0; }, true);
document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link || link.target === '_blank' || link.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const destination = new URL(link.href, location.href);
  if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return;
  if (!confirmLeaving()) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
