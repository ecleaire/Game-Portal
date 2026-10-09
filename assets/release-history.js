export function releaseHistory(releases = []) {
  const panel = document.createElement('section'); panel.className = 'release-history';
  if (releases.length > 3) panel.tabIndex = 0;
  const heading = document.createElement('h2'); heading.textContent = 'ゲーム更新履歴'; panel.append(heading);
  if (!releases.length) {
    const empty = document.createElement('p'); empty.textContent = '承認済みの更新履歴はまだありません。'; panel.append(empty);
  }
  for (const release of releases) {
    const item = document.createElement('article');
    const version = document.createElement('h3'); version.textContent = `v${release.version}`;
    const date = document.createElement('time'); date.dateTime = release.released_at; date.textContent = new Date(release.released_at).toLocaleString('ja-JP');
    const notes = document.createElement('p'); notes.textContent = release.notes || '更新内容の記載はありません。';
    item.append(version,date,notes); panel.append(item);
  }
  return panel;
}
