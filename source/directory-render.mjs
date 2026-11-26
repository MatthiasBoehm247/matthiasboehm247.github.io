const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

/** All tool links remain outside these controls and are rendered by the page generator. */
export function directoryControls(clusters, count = 110) {
  return `<section class="directory-intro" aria-labelledby="directory-heading">
<h2 id="directory-heading">Ein Werkzeug für deine nächste Aufgabe</h2>
<p>Öffne ein Werkzeug, nutze die Beispieldaten oder eigene Eingaben und erstelle dein Ergebnis. Auf jeder Toolseite findest du die Methode, Grenzen und passende Anleitungen.</p>
<p class="directory-downloads">Alle ${Number(count)} Tooladressen herunterladen: <a href="/assets/labs/tool-catalog.csv" download>CSV für Tabellen</a> <span aria-hidden="true">·</span> <a href="/assets/labs/tool-catalog.json" download>JSON für eigene Übersichten</a></p>
</section>
<section class="directory-controls" data-tool-directory-controls hidden aria-label="Werkzeugauswahl">
<form id="directory-form" role="search" aria-label="Werkzeuge durchsuchen">
<div class="directory-fields">
<div class="directory-query"><label for="tool-search">Aufgabe oder Werkzeug suchen</label><input id="tool-search" name="suche" type="search" maxlength="160" autocomplete="off" placeholder="z. B. JSON prüfen, Kontrast, Sitemap" aria-describedby="directory-search-hint" aria-controls="directory-results"><p id="directory-search-hint" class="directory-hint">Alle Suchwörter müssen vorkommen. Suche mit wenigen konkreten Begriffen.</p></div>
<div><label for="cluster-filter">Themenwelt</label><select id="cluster-filter" name="thema" aria-controls="directory-results"><option value="">Alle Themenwelten</option>${clusters.map(cluster => `<option value="${esc(cluster.slug)}">${esc(cluster.title)}</option>`).join('')}</select></div>
<div><label for="directory-sort">Reihenfolge</label><select id="directory-sort" name="sortierung" aria-controls="directory-results"><option value="original">Nach Themen geordnet</option><option value="az">Alphabetisch A–Z</option></select></div>
</div>
<div class="directory-actions"><button type="submit">Werkzeuge anzeigen</button><button type="button" class="secondary" id="directory-reset">Auswahl zurücksetzen</button><button type="button" class="secondary" id="directory-share">Auswahl-Link kopieren</button></div>
</form>
<p class="directory-hint">Ein geteilter Link enthält nur die sichtbare Suchauswahl. Verwende dafür keine vertraulichen Begriffe.</p>
<p id="directory-share-status" class="directory-hint" role="status" aria-live="polite"></p>
<div id="directory-share-fallback" hidden><label for="directory-share-link">Auswahl-Link zum manuellen Kopieren</label><input id="directory-share-link" readonly type="url" spellcheck="false"><p class="directory-hint">Markierten Link mit Strg+C oder ⌘+C kopieren.</p></div>
</section>
<p id="search-count" class="directory-result-count" role="status" aria-live="polite" aria-atomic="true">${Number(count)} Werkzeuge in ${clusters.length} ${clusters.length === 1 ? 'Themenwelt' : 'Themenwelten'}</p>
<div class="directory-empty" id="directory-empty" hidden><h2>Kein passendes Werkzeug gefunden</h2><p>Entferne ein Suchwort oder wähle „Alle Themenwelten“. Du kannst auch die Themenübersichten unter der Werkzeugliste verwenden.</p><button type="button" class="secondary" id="directory-empty-reset">Alle Werkzeuge anzeigen</button></div>
<noscript><p class="directory-no-script">Alle Werkzeuge sind unten verlinkt. Die Suchauswahl benötigt JavaScript; die Themenübersichten und Anleitungen bleiben erreichbar.</p></noscript>`;
}
