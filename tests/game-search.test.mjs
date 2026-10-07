import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesGameSearch } from '../assets/game-search.js';

const game = { title: '星の冒険', description: '海のパズルを解く', tags: [
  { name: 'アクションRPG', slug: 'action-rpg' }, { name: '3D', slug: '3d' },
] };

test('keyword searches can target the title, caption or both', () => {
  assert.equal(matchesGameSearch(game, { keyword: '星', target: 'title' }), true);
  assert.equal(matchesGameSearch(game, { keyword: '星', target: 'description' }), false);
  assert.equal(matchesGameSearch(game, { keyword: '海', target: 'title' }), false);
  assert.equal(matchesGameSearch(game, { keyword: '星 海' }), true);
});

test('exact tag names do not match prefixes, and partial names do', () => {
  assert.equal(matchesGameSearch(game, { keyword: 'アクション', target: 'tag-exact' }), false);
  assert.equal(matchesGameSearch(game, { keyword: 'アクション', target: 'tag-partial' }), true);
  assert.equal(matchesGameSearch(game, { keyword: 'アクションRPG ３ｄ', target: 'tag-exact' }), true);
  assert.equal(matchesGameSearch(game, { keyword: 'ACTION-RPG', target: 'tag-exact' }), true);
  assert.equal(matchesGameSearch(game, { keyword: '星', target: 'tag-partial' }), false);
  assert.equal(matchesGameSearch(game, { keyword: '星 アクション', target: 'all' }), true);
});

test('multiple keywords and selected tags have independent AND/OR conditions', () => {
  assert.equal(matchesGameSearch(game, { keyword: '星 月' }), false);
  assert.equal(matchesGameSearch(game, { keyword: '星 月', keywordMode: 'any' }), true);
  assert.equal(matchesGameSearch(game, { selectedTags: ['3d', 'puzzle'] }), false);
  assert.equal(matchesGameSearch(game, { selectedTags: ['3d', 'puzzle'], tagMode: 'any' }), true);
  assert.equal(matchesGameSearch(game, { keyword: '月', selectedTags: ['3d'], tagMode: 'any' }), false);
  assert.equal(matchesGameSearch(game, { keyword: '星', selectedTags: ['puzzle'] }), false);
});

test('empty filters include untagged games, but active tag filters exclude them', () => {
  assert.equal(matchesGameSearch({}, { keyword: ' 　', target: 'tag-exact', keywordMode: 'any', tagMode: 'any' }), true);
  assert.equal(matchesGameSearch({}, { keyword: '3d', target: 'tag-exact' }), false);
  assert.equal(matchesGameSearch({}, { selectedTags: ['3d'], tagMode: 'any' }), false);
});
