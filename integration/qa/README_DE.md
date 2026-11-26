# Automatische Browser-Abnahme

Der Source-Pages-Workflow führt diese Prüfung vor jeder Veröffentlichung aus. Nutzer müssen dafür keine Testdateien auswählen, Browserwerkzeuge öffnen oder lokale Testbefehle ausführen. GitHub Actions installiert die festgelegte Playwright-Version und die dazugehörigen Chromium-, Firefox- und WebKit-Browser im Prüfjob. Jede Engine führt 139 Funktionsfälle, sieben Lebenszyklus-/Speicherfälle und zehn Tastatur-/Lastfälle aus: zusammen 468 native Pflichtfälle.

## Was der Gate prüft

- Alle 110 Werkzeugseiten: tatsächliche HTTP-Seite, JavaScript-Start, Berechnung, sichtbares Ergebnis und heruntergeladene Ergebnisdatei.
- Innerhalb von T009 zusätzlich 16 benannte XML-Unterfälle mit dem nativen DOMParser: Sitemaps-Namensräume und Präfixe, Bild-Erweiterungen, Indexdateien, direkte loc-Felder, Entities, doppelte URLs sowie ungültiges XML, DTD und Fragmente. Gültige Ergebnisse müssen vollständig dem erwarteten JSON entsprechen; abgelehnte Eingaben müssen Ergebnis und Exporte leeren beziehungsweise sperren. Der Bericht nennt jeden Unterfall und führt ausgeführte, bestandene sowie noch nicht ausgeführte Unterfälle getrennt auf.
- Neun Medienpfade einschließlich des optionalen Bilds im Open-Graph-Studio: echte PNG- oder WAV-Dateien am Dateifeld, Verarbeitung und tatsächlicher Bilddownload.
- Die acht obligatorischen Dateiimporte: fehlende und defekte Dateien müssen den Export sperren. Zusätzlich werden ungültige Ausschnitte und mehr als 32 Sprite-Frames abgelehnt.
- PNG-Exporte: CRC, tatsächliche Bildmaße, Alpha, kontrollierte Pixel, vollständige Schwärzung im angegebenen Bereich, Sprite-Platzierung und Ton gegenüber Stille in der Wellenform.
- Audio: realer Browserstart und Stopp sowie 14 native OfflineAudioContext-Renderfälle mit dem produktiven Audiographen. Geprüft werden fünf Standards, zwei stille Muster, vier Wellenformen bei 1.200 Hz, volle Drumspuren, ein Vierklang und Sustain null: endliche Samples, Signal beziehungsweise Stille, Spitzenpegel, stiller Start und Ausklang; zusätzlich die tatsächliche Sinusfrequenz. Das ist kein subjektives Hörurteil.
- Alle zwölf Lernmodelle: Ausgangsrechnung, Eingabeänderung, Tastatur-Submit, ungültige Zahlen soweit vorhanden, Zurücksetzen, tatsächlich heruntergeladenes JSON und CSV. Beide Exportversionen müssen exakt mit `assets/labs/release.json` übereinstimmen; auch die Katalogversion wird dagegen geprüft.
- Werkzeugverzeichnis: Suche, Kategorie, Sortierung, Auswahl-Link-Status, Wiederherstellung nach Reload, leere Suche, Zurücksetzen und Tastaturfolge.
- Arbeitsbereich: Projekte und Werkzeugstand über die tatsächliche Oberfläche anlegen, vollständige Sicherung herunterladen und byteweise prüfen, Vorschau ohne Schreibzugriff, wiederholten Import ohne Duplikate, selektive neue Projektkopien mit neuen Kennungen und Erhalt bestehender Projekte/Einstellungen, Vorschau alter Speicherdateien, Abbruch, ungültiges JSON sowie direkte Sicherung unberechneter Formulareingaben ohne aktives Projekt und anschließenden echten Projektimport.
- Projektverwaltung: Umbenennen mit ausdrücklichem Speichern und Abbruch per Escape, unabhängige Kopie mit neuer Kennung, Suche nach Projekt und Werkzeug, leere Suche, drei Sortierungen, Entfernen und Wiederherstellen eines Projekts sowie eines Werkzeugstands. Eine zwischenzeitlich in einem zweiten Tab angelegte Änderung muss beim Wiederherstellen erhalten bleiben. Die Rückgängig-Möglichkeit endet beim Neuladen; bereits gespeicherte Daten bleiben erhalten.
- 320, 390 und 768 CSS-Pixel, jeweils im hellen und dunklen Farbschema: Seitenüberlauf, erreichbare Formularfelder, Feldbeschriftungen sowie benannte Bedienelemente mit mindestens 24 × 24 CSS-Pixeln.

Die 16 XML-Unterfälle sind im T009-Werkzeugfall enthalten und erhöhen die Zahl der Hauptkennungen nicht. Die 139 Fälle sind 110 Werkzeuge, zwölf Lernmodelle, das Verzeichnis, die Arbeitsbereich-Sicherung, die Projektverwaltung und 14 native Audiosignalprüfungen. Ihre exakten Kennungen werden mit einem Register verglichen: fehlende, doppelte oder unerwartete Fälle verhindern PASS, auch wenn die bloße Anzahl 139 beträgt. Fehlgeschlagene Fälle oder ein fehlgeschlagener Browserstart verhindern den Upload und das Deployment. Die parallel geprüften Toolseiten und beide Arbeitsbereich-Fälle erhalten getrennte Browserkontexte; Farbschema und lokaler Speicher eines Falls beeinflussen keine anderen Fälle. Nach einem Farbschemawechsel wird dessen tatsächlicher DOM-Zustand abgewartet. Es werden keine Browser-Screenshots als Lieferdateien erzeugt.

## Dateien

`fixtures.py` erzeugt synthetische PNG-Bilder und eine Mono-WAV-Datei. Es verwendet ausschließlich die Python-Standardbibliothek und enthält einen PNG-Leser für die Kontrolle der exportierten Pixel. Die Bilder enthalten keine externen Motive oder persönlichen Daten.

`browser_gate.py` bedient die tatsächlich bereitgestellten Werkzeugseiten mit Playwright. Es ersetzt keine Produktionsberechnung durch eine eigene Berechnung und prüft die erzeugten Downloads. Die temporären Eingaben und Exporte werden nach dem Lauf entfernt; der JSON-Bericht bleibt als Actions-Artefakt erhalten.

`requirements.txt` legt Playwright auf **1.65.2** fest. Stand der Versionsprüfung: 25.11.2026. Browserrevision und Python-Bibliothek werden dadurch gemeinsam gewählt.

## Umfang und Nachweis

Das Vorhandensein des Testcodes belegt noch keinen erfolgreichen GitHub-Actions-Lauf. Maßgeblich sind der tatsächliche Lauf und sein JSON-Bericht. Eine lokale CUA-Browserprüfung wird separat dokumentiert und nicht mit diesem Gate gleichgesetzt. Die automatischen Viewports ersetzen keine Zertifizierung für sämtliche physischen Geräte, Browser oder Screenreader. Der Gate bestätigt keine Suchindexierung.

Nach dem Deployment prüft `live_check.py` zusätzlich alle öffentlichen Dateien außer `.nojekyll` gegen SHA-256-Prüfsummen. Auch die Portfolio-Homepage wird mit den Bytes desselben Checkouts verglichen. Ausschließlich noch fehlgeschlagene Dateien werden bis zu viermal abgerufen, mit 15 Sekunden Abstand und innerhalb eines Gesamtbudgets von 300 Sekunden. Nach Ablauf des Budgets werden keine weiteren Requests gestartet; noch ungeprüfte Dateien bleiben FAIL. Ein dauerhaft abweichendes Release bleibt FAIL. URLs für ausdrücklich freigegebene Dateien mit Leerzeichen oder Umlauten werden korrekt kodiert.

Berichte müssen außerhalb des geprüften Repositorys beziehungsweise des öffentlichen Stagingverzeichnisses liegen. Reportpfade werden vor dem Lauf und vor dem Schreiben geprüft; sie dürfen keine Eingabedateien überschreiben und keinen Symlinks folgen.

## Offizielle Referenzen

- https://playwright.dev/python/docs/ci
- https://playwright.dev/python/docs/api/class-filechooser
- https://playwright.dev/python/docs/downloads
- https://pypi.org/project/playwright/1.65.2/
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

Vor dem Deployment wird innerhalb der serialisierten Veröffentlichungsphase geprüft, ob der getestete Commit weiterhin `main` entspricht. Ein inzwischen überholter Lauf überspringt die Veröffentlichung; eine nicht zuverlässig lesbare Referenz beendet den Lauf ohne Freigabe. Das verhindert, dass ein langsamer älterer Prüflauf einen bereits neueren Stand wieder überschreibt.
