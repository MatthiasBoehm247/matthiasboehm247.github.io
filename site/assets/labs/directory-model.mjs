/** Pure search/state helpers. No storage, DOM, network calls or user-data exports. */
export const MAX_QUERY_LENGTH = 160;
export const DEFAULT_DIRECTORY_STATE = Object.freeze({ query: '', category: '', sort: 'original' });
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

export function cleanQuery(value) {
  if (typeof value !== 'string') return '';
  return [...value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/gu, ' ').trim()]
    .slice(0, MAX_QUERY_LENGTH).join('').trim();
}

export function normalizeSearch(value) {
  return String(value ?? '').toLocaleLowerCase('de').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/\s+/gu, ' ').trim();
}

export function normalizeDirectoryState(value = {}, allowedCategories = []) {
  const input = value && typeof value === 'object' ? value : {};
  const categories = new Set(allowedCategories);
  return {
    query: cleanQuery(input.query),
    category: typeof input.category === 'string' && categories.has(input.category) ? input.category : '',
    sort: input.sort === 'az' ? 'az' : 'original',
  };
}

export function stateFromFragment(fragment, allowedCategories = []) {
  if (typeof fragment !== 'string' || fragment.length > 4096 || !/^#tools(?:\?|$)/.test(fragment)) {
    return { ...DEFAULT_DIRECTORY_STATE };
  }
  const params = new URLSearchParams(fragment.startsWith('#tools?') ? fragment.slice(7) : '');
  return normalizeDirectoryState({
    query: params.get('suche'), category: params.get('thema'), sort: params.get('sortierung'),
  }, allowedCategories);
}

export function fragmentFromState(value, allowedCategories = []) {
  const state = normalizeDirectoryState(value, allowedCategories);
  const params = new URLSearchParams();
  if (state.query) params.set('suche', state.query);
  if (state.category) params.set('thema', state.category);
  if (state.sort !== 'original') params.set('sortierung', state.sort);
  return params.size ? `#tools?${params}` : '';
}

export function shareURL(href, value, allowedCategories = []) {
  const url = new URL(href);
  if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('Ein HTTP- oder HTTPS-Link ist erforderlich.');
  url.username = ''; url.password = ''; url.search = '';
  url.hash = fragmentFromState(value, allowedCategories);
  return url.href;
}

export function indexDirectory(records) {
  return records.map((record, index) => ({
    ...record,
    index,
    title: String(record.title ?? ''),
    category: String(record.category ?? ''),
    searchText: normalizeSearch([record.title, record.text, record.category].filter(Boolean).join(' ')),
  }));
}

export function filterDirectory(entries, value, allowedCategories = []) {
  const state = normalizeDirectoryState(value, allowedCategories);
  const terms = normalizeSearch(state.query).split(' ').filter(Boolean);
  const matches = entries.filter(entry => (!state.category || entry.category === state.category)
    && terms.every(term => entry.searchText.includes(term)));
  if (state.sort === 'az') matches.sort((a, b) => collator.compare(a.title, b.title) || a.index - b.index);
  else matches.sort((a, b) => a.index - b.index);
  return matches;
}

export function resultMessage(count, total) {
  if (count === 0) return `0 von ${total} Werkzeugen passen zur Auswahl.`;
  if (count === 1) return `1 von ${total} Werkzeugen passt zur Auswahl.`;
  return `${count} von ${total} Werkzeugen passen zur Auswahl.`;
}
