import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTagValues,
  resolveTagsForFiltering,
  resolveTagsForUrl
} from '../../modules/tags-deeplink.mjs';

const normalize = (value) => String(value || '').toLowerCase().trim();

test('normalizeTagValues normalizes and deduplicates tags', () => {
  assert.deepEqual(normalizeTagValues(['Community', 'community', '  ART '], normalize), [
    'community',
    'art'
  ]);
});

test('resolveTagsForFiltering keeps active tags when form tags are empty', () => {
  assert.deepEqual(
    resolveTagsForFiltering({
      formTags: [],
      activeTags: ["pam'yat", 'community'],
      normalize
    }),
    ["pam'yat", 'community']
  );
});

test('resolveTagsForUrl keeps active tags until tag inputs are ready', () => {
  assert.deepEqual(
    resolveTagsForUrl({
      formTags: [],
      activeTags: ['community'],
      tagsInputsReady: false,
      normalize
    }),
    ['community']
  );
  assert.deepEqual(
    resolveTagsForUrl({
      formTags: [],
      activeTags: ['community'],
      tagsInputsReady: true,
      normalize
    }),
    []
  );
});
