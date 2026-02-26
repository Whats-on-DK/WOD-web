export const normalizeTagValues = (values, normalize) => {
  const list = Array.isArray(values) ? values : [];
  const toKey =
    typeof normalize === 'function'
      ? normalize
      : (value) => String(value || '').toLowerCase().trim();
  const result = [];
  const seen = new Set();
  list.forEach((value) => {
    const normalized = toKey(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

export const resolveTagsForFiltering = ({ formTags, activeTags, normalize }) => {
  const normalizedFormTags = normalizeTagValues(formTags, normalize);
  if (normalizedFormTags.length) return normalizedFormTags;
  return normalizeTagValues(activeTags, normalize);
};

export const resolveTagsForUrl = ({ formTags, activeTags, tagsInputsReady, normalize }) => {
  const normalizedFormTags = normalizeTagValues(formTags, normalize);
  if (normalizedFormTags.length) return normalizedFormTags;
  if (tagsInputsReady) return [];
  return normalizeTagValues(activeTags, normalize);
};
