import { indexDirectory, filterDirectory, normalizeDirectoryState, stateFromFragment, fragmentFromState, shareURL, resultMessage } from './directory-model.mjs';

const controls = document.querySelector('[data-tool-directory-controls]');
const directory = document.querySelector('.tool-directory');
if (controls && directory) {
  const form = controls.querySelector('#directory-form');
  const search = controls.querySelector('#tool-search');
  const category = controls.querySelector('#cluster-filter');
  const sort = controls.querySelector('#directory-sort');
  const count = document.querySelector('#search-count');
  const empty = document.querySelector('#directory-empty');
  const shareStatus = controls.querySelector('#directory-share-status');
  const fallback = controls.querySelector('#directory-share-fallback');
  const fallbackInput = controls.querySelector('#directory-share-link');
  const categories = [...category.options].map(option => option.value).filter(Boolean);
  const entries = indexDirectory([...directory.querySelectorAll('.tool-card[data-search]')].map(card => ({
    title: card.querySelector('h3')?.textContent || card.textContent,
    text: card.dataset.search,
    category: card.dataset.cluster,
    card,
  })));
  directory.id = 'directory-results';
  let state = stateFromFragment(location.hash, categories);
  let shareAttempt = 0;

  function clearShare() {
    shareAttempt++;
    shareStatus.textContent = '';
    fallback.hidden = true;
    fallbackInput.value = '';
  }

  function applyState(next, { historyMode = '', syncInputs = false } = {}) {
    state = normalizeDirectoryState(next, categories);
    if (syncInputs) {
      search.value = state.query;
      category.value = state.category;
      sort.value = state.sort;
    }
    const matching = filterDirectory(entries, state, categories);
    const visible = new Set(matching.map(entry => entry.index));
    for (const entry of entries) entry.card.hidden = !visible.has(entry.index);
    // Append in actual DOM order so keyboard navigation follows the visible order.
    for (const entry of [...matching, ...entries.filter(entry => !visible.has(entry.index))]) directory.append(entry.card);
    count.textContent = resultMessage(matching.length, entries.length);
    empty.hidden = matching.length !== 0;
    clearShare();
    if (historyMode) {
      const nextHash = fragmentFromState(state, categories);
      if (nextHash !== location.hash) {
        try {
          const nextURL = new URL(location.href);
          nextURL.hash = nextHash;
          history[historyMode === 'push' ? 'pushState' : 'replaceState'](history.state, '', nextURL);
        } catch {
          shareStatus.textContent = 'Die Auswahl wurde gefiltert. Der Browser konnte die Adresszeile nicht aktualisieren; „Auswahl-Link kopieren“ bleibt verfügbar.';
        }
      }
    }
  }

  function readInputs() { return { query: search.value, category: category.value, sort: sort.value }; }
  function reset() {
    applyState({}, { historyMode: 'push', syncInputs: true });
    search.focus();
  }

  search.addEventListener('input', () => applyState(readInputs(), { historyMode: 'replace' }));
  category.addEventListener('change', () => applyState(readInputs(), { historyMode: 'push' }));
  sort.addEventListener('change', () => applyState(readInputs(), { historyMode: 'push' }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    applyState(readInputs(), { historyMode: 'replace', syncInputs: true });
  });
  controls.querySelector('#directory-reset').addEventListener('click', reset);
  document.querySelector('#directory-empty-reset').addEventListener('click', reset);
  controls.querySelector('#directory-share').addEventListener('click', async () => {
    const attempt = ++shareAttempt;
    let url;
    try { url = shareURL(location.href, state, categories); }
    catch {
      shareStatus.textContent = 'Öffne die Werkzeugbibliothek über eine HTTP- oder HTTPS-Adresse, um einen Auswahl-Link zu teilen.';
      return;
    }
    fallback.hidden = true;
    shareStatus.textContent = '';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Zwischenablage nicht verfügbar');
      await navigator.clipboard.writeText(url);
      if (attempt === shareAttempt) shareStatus.textContent = 'Auswahl-Link kopiert. Beim Öffnen wird dieselbe Suche angezeigt.';
    } catch {
      if (attempt !== shareAttempt) return;
      fallbackInput.value = url;
      fallback.hidden = false;
      shareStatus.textContent = 'Automatisches Kopieren ist nicht verfügbar. Kopiere den Auswahl-Link aus dem markierten Feld.';
      fallbackInput.focus();
      fallbackInput.select();
    }
  });
  const restore = () => applyState(stateFromFragment(location.hash, categories), { syncInputs: true });
  window.addEventListener('hashchange', restore);
  window.addEventListener('popstate', restore);
  applyState(state, { syncInputs: true });
  controls.hidden = false;
}
