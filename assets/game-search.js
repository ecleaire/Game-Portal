const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().trim();
const combine = (conditions, mode) => !conditions.length ||
  (mode === 'any' ? conditions.some(Boolean) : conditions.every(Boolean));

// Exact tag matching compares each tag name/slug, not the game's entire tag set.
export function matchesGameSearch(game, { keyword = '', target = 'text', matchMode = 'all', selectedTags = [] } = {}) {
  const tags = game.tags ?? [];
  const tagConditions = [...selectedTags].map(slug => tags.some(tag => tag.slug === slug));
  const terms = normalize(keyword).split(/\s+/u).filter(Boolean);
  const title = normalize(game.title), description = normalize(game.description);
  const tagNames = tags.flatMap(tag => [normalize(tag.name), normalize(tag.slug)]);
  const keywordConditions = terms.map(term => {
    switch (target) {
      case 'title': return title.includes(term);
      case 'description': return description.includes(term);
      case 'tag-exact': return tagNames.includes(term);
      case 'tag-partial': return tagNames.some(name => name.includes(term));
      case 'all': return title.includes(term) || description.includes(term) || tagNames.some(name => name.includes(term));
      default: return title.includes(term) || description.includes(term);
    }
  });
  return combine([...keywordConditions, ...tagConditions], matchMode);
}
