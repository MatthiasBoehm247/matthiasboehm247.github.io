# Digital Labs: Prüfung, Veröffentlichung und Betrieb

Ziel: https://matthiasboehm247.github.io/ · Sprache: Deutsch · Quellzweig: `main`.

## Verbindlicher Releaseablauf

Änderungen kommen über einen eigenen Branch und Pull Request. Der Workflow **Digital Labs Source prüfen und veröffentlichen** baut die Website und vergleicht das Ergebnis mit dem im Commit enthaltenen `integration/deployment.json`. Abweichende Bytes verhindern die Freigabe.

Alle Browser verwenden dasselbe getrennte öffentliche Verzeichnis. Pro Engine sind vorgesehen:

| Prüfung | Feste Hauptfälle |
|---|---:|
| Werkzeuge, Lernmodelle, Verzeichnis, Projekte/Sicherung und Audio | 139 |
| Echte Navigation, unterbrochene Arbeit und Browser-Speichergrenzen | 7 |
| Tastaturbedienung und synthetische Last bei breiter/schmaler Ansicht | 10 |

Chromium, Firefox und WebKit müssen alle Fälle bestehen. Hinzu kommen 43 öffentliche Berechnungsregressionen und 16 synthetische Prüfungen der Überwachungslogik. Fehlende, doppelte, fehlgeschlagene oder zur falschen Version gehörende Berichte verhindern die Freigabe. `release-gate.json` bindet alle Berichte und das Staginginventar mit SHA-256 an den geprüften Commit. Vor der Veröffentlichung werden die Belege sowie jede Datei des tatsächlich hochgeladenen Pages-Artefakts erneut geprüft.

Die 16 XML-Unterfälle in T009 und zwei Tilemap-Unterfälle in T087 gehören zu den 139 Hauptfällen. Sie werden nicht als zusätzliche Hauptfälle gezählt. Ein realer virtueller Audioausgang ermöglicht native AudioContext-Start-/Stop-Tests. Die Signalprüfungen ersetzen keinen menschlichen Hörtest. WebKit in Playwright ersetzt keine Prüfung auf einem physischen iPhone oder mit Safari und einem Screenreader. Die gemessenen Zeiten sind reproduzierbare Laborbeobachtungen mit synthetischen Eingaben, keine Core-Web-Vitals-Felddaten.

Nur der erfolgreiche `main`-Lauf im festgelegten Repository kann veröffentlichen. Ein letzter Vergleich mit dem aktuellen `main` verhindert die Veröffentlichung eines inzwischen überholten Commits. Der anschließende Live-Test vergleicht sämtliche öffentlichen Dateien außer `.nojekyll` anhand von HTTP-Status, Dateityp und Hash; auch die ergänzte Portfolio-Homepage ist abgedeckt.

## Wiederkehrende öffentliche Kontrolle

Der separate Workflow **Digital Labs öffentliche Kontrolle** läuft nach einer erfolgreichen Veröffentlichung, manuell über „Run workflow“ und täglich um **06:23 UTC** (07:23 MEZ bzw. 08:23 MESZ). GitHub kann geplante Läufe verzögern; dies ist keine sekundengenaue Verfügbarkeitsgarantie.

Er liest den letzten tatsächlich erfolgreichen `github-pages`-Deploymentcommit, lädt genau dessen Quellen und vergleicht die öffentlichen Bytes mit dessen Manifest. Ein neuerer, noch nicht veröffentlichter `main`-Stand wird nicht versehentlich zum Sollstand. Für alte Releases ohne eingechecktes Manifest wird dieses aus dem veröffentlichten Quellcommit rekonstruiert. Die Portfolio-Ergänzung wird mit dem Installer aus demselben Commit nachvollzogen.

Ändert sich das erfolgreiche Deployment während der Prüfung, erscheint `SUPERSEDED`. Das ist ausdrücklich keine Freigabe des neueren Stands. Bei einem Hash-/HTTP-Fehler oder fehlender verlässlicher Zuordnung bleibt die Kontrolle fehlgeschlagen. Sie verändert weder Website noch Repository und verschickt keine selbst erstellten Nachrichten. Fehlgeschlagene Läufe und ihr Bericht sind in GitHub Actions sichtbar; persönliche Benachrichtigungen richten sich nach den GitHub-Einstellungen des Kontos.

Die Überwachungsberichte bleiben 90 Tage als Actions-Artefakte erhalten; Release- und Liveberichte derzeit 14 Tage, das Pages-Artefakt einen Tag. Wichtige Abnahmen sollten zusätzlich mit dem vollständigen Projektpaket archiviert werden. Ein erfolgreicher HTTP-Test beweist keine Suchmaschinenindexierung.

## Fehler gezielt eingrenzen

1. Im fehlgeschlagenen Lauf den ersten roten Schritt und die JSON-Berichte öffnen. Engine, Releaseversion, Commit und betroffene Fallkennung festhalten.
2. Bei einem Funktionsfehler nur die relevanten Tests lokal wiederholen, den Fehler auf einem eigenen Branch beheben und danach die vollständige Pflichtpipeline ausführen lassen.
3. Bei abweichenden Livebytes den im Bericht genannten Deploymentcommit und die betroffenen Dateien prüfen. Eine vorübergehende Auslieferungsverzögerung wird innerhalb eines begrenzten Budgets erneut abgefragt; dauerhaft falsche Bytes bestehen nicht.
4. Eine Wiederherstellung im öffentlichen Repository erfolgt als nachvollziehbarer neuer Commit beziehungsweise Revert-PR, der dieselben Pflichtprüfungen durchläuft. Kein Force-Push, keine ungesicherte Übernahme eines alten Artefakts und kein automatisches Löschen lokaler Nutzerdaten.

Der Installer des Vollpakets unterstützt getrennte Installationssicherungen. Eine solche Sicherung ist von den im Browser gespeicherten Projekten zu unterscheiden. Browserprojekte werden im Arbeitsbereich exportiert und dort gezielt wieder eingelesen. „Stand als Datei sichern“ ermöglicht die Rettung aktueller Eingaben auch bei gesperrtem oder vollem Browserspeicher.

## Auffindbarkeit

Werkzeug- und Wissensseiten behalten ihre direkten deutschen URLs, HTML-Titel, Beschreibungen, Canonicals und internen Links. `sitemap.xml` enthält die indexierbaren kanonischen Seiten. Nicht zur Indexierung vorgesehene Forschungspläne und Duplikate werden gesondert behandelt.

Tatsächliche Google-Indexierung und Suchleistung müssen in der zum Ursprung passenden Search-Console-Property geprüft werden. Ein vorhandenes Verifikationsdokument oder eine korrekt ausgelieferte Sitemap allein beweist weder erfolgreichen Propertyzugriff noch Indexierung. Ohne vorliegende Kontodaten werden keine Indexierungszahlen, Impressionen oder Rankingverbesserungen behauptet.
