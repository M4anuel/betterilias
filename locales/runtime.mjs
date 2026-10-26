/** Pure shared lookup: partial languages fall back to English, including empty entries. */
export function translate(catalogues, language, key, values = {}) {
  const candidate = catalogues[language]?.[key];
  const fallback = catalogues.en[key];
  const message = typeof candidate === 'string' && candidate.trim() ? candidate
    : typeof fallback === 'string' && fallback.trim() ? fallback : key;
  return message.replace(/\{(\w+)\}/g, (token, name) =>
    Object.hasOwn(values, name) ? String(values[name] ?? '') : token);
}

export function resolveLanguage(value, languages) {
  const code = String(value || '').toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(languages, code) ? code : 'en';
}
