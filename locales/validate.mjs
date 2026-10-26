const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');

export function validateCatalogues(languages, catalogues, usedKeys = []) {
  const errors = [], warnings = [];
  const english = catalogues.en || {};
  if (languages.en?.support !== 'full') errors.push('English must be fully supported.');
  for (const key of usedKeys) {
    if (!Object.hasOwn(english, key)) errors.push(`English is missing used key: ${key}`);
  }
  for (const [code, definition] of Object.entries(languages)) {
    if (!['full', 'partial'].includes(definition.support)) errors.push(`${code}: support must be full or partial`);
    if (!definition.name || !definition.locale) errors.push(`${code}: name and locale are required`);
    const catalogue = catalogues[code] || {};
    for (const [key, fallback] of Object.entries(english)) {
      const value = catalogue[key];
      if (typeof value !== 'string' || !value.trim()) {
        (definition.support === 'partial' ? warnings : errors).push(`${code}: missing translation: ${key}`);
      } else if (placeholders(value) !== placeholders(fallback)) {
        errors.push(`${code}: inconsistent placeholders: ${key}`);
      }
    }
    for (const key of Object.keys(catalogue)) {
      if (!Object.hasOwn(english, key)) errors.push(`${code}: unknown key: ${key}`);
    }
  }
  return { errors, warnings };
}
