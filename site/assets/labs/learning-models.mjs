/* Digital Labs 1.5: pure, deterministic learning models. No DOM, I/O or storage.
 * Calculations retain floating-point precision; rounding belongs to the view.
 * Chart coordinates and table numbers are the same computed model values.
 */
const number = (name, label, value, min, max, step, unit = '', help = '') =>
  ({ name, label, type: 'number', value, min, max, step, unit, help, integer: step === 1 });
const color = (name, label, value) => ({ name, label, type: 'color', value, unit: '' });
const source = (label, url) => ({ label, url });
const own = 'Eigene mathematische Modellrechnung; keine Messdaten.';

export const models = {
  W026: {
    id: 'W026', title: 'Gewichtete CTR verstehen',
    description: 'Verändere zwei Segmente und vergleiche die gemeinsame Klickrate mit dem einfachen Mittelwert und einer Referenz.',
    fields: [number('impressionsA', 'Impressionen in Segment A', 1000, 0, 1e9, 1), number('clicksA', 'Klicks in Segment A', 100, 0, 1e9, 1), number('impressionsB', 'Impressionen in Segment B', 9000, 0, 1e9, 1), number('clicksB', 'Klicks in Segment B', 90, 0, 1e9, 1), number('baseline', 'Referenz-CTR', 2, 0, 100, 0.1, '%')],
    formula: 'Gesamt-CTR = 100 × (Klicks A + Klicks B) / (Impressionen A + Impressionen B). Differenz in Prozentpunkten = Gesamt-CTR − Referenz. Relative Änderung = 100 × (Gesamt-CTR / Referenz − 1).',
    limit: 'Nur disjunkte Segmente mit derselben Definition, demselben Zeitraum und denselben Filtern addieren. Exportlücken sind hier nicht modelliert. Ohne Impressionen ist die CTR nicht definiert; bei Referenz 0 ist die relative Änderung nicht definiert.',
    question: 'Warum ist der einfache Mittelwert beider Segment-CTRs häufig falsch?',
    answer: 'Er gewichtet kleine und große Segmente gleich. Für die gemeinsame CTR werden zuerst Klicks und Impressionen addiert und anschließend dividiert. 100/1.000 und 90/9.000 ergeben gemeinsam 190/10.000 = 1,9 %, nicht 5,5 %.',
    sources: [source('Google Search Console: Leistungsbericht', 'https://support.google.com/webmasters/answer/7576553?hl=de')]
  },
  W028: {
    id: 'W028', title: 'Traffic-Annahmen als Szenario vergleichen',
    description: 'Berechne aus denselben angenommenen Impressionen drei CTR-Szenarien und ihre rechnerischen Conversions.',
    fields: [number('impressions', 'Angenommene Impressionen', 100000, 0, 1e9, 1), number('ctrLow', 'Konservative CTR', 2, 0, 100, 0.1, '%'), number('ctrBase', 'Basis-CTR', 3, 0, 100, 0.1, '%'), number('ctrHigh', 'Optimistische CTR', 5, 0, 100, 0.1, '%'), number('conversion', 'Angenommene Conversion-Rate', 2, 0, 100, 0.1, '%')],
    formula: 'Klicks = Impressionen × CTR / 100. Conversions = Klicks × Conversion-Rate / 100.',
    limit: 'Die Eingaben sind frei gewählte Annahmen. Position, Nachfrage, Saisonalität, Messfehler, Attribution und Abhängigkeiten zwischen CTR und Conversion-Rate werden nicht geschätzt. Conversions sind erwartete Modellwerte und können Bruchteile enthalten.',
    question: 'Sind die drei Szenarien ein statistisches Konfidenzintervall?',
    answer: 'Nein. Die Grenzen wurden eingegeben und nicht aus einer Stichprobe geschätzt. Die Rechnung macht Annahmen vergleichbar, liefert aber keine Eintrittswahrscheinlichkeit oder Rankingprognose.',
    sources: []
  },
  W029: {
    id: 'W029', title: 'SEO-ROI mit Deckungsbeitrag simulieren',
    description: 'Prüfe, wie zusätzliche Besuche, Conversion-Rate, Deckungsbeitrag und Kosten das rechnerische Ergebnis verändern.',
    fields: [number('visits', 'Zusätzliche Besuche pro Monat', 2000, 0, 1e8, 1), number('conversion', 'Conversion-Rate', 2, 0, 100, 0.1, '%'), number('contribution', 'Deckungsbeitrag je Conversion', 60, 0, 1e6, 0.5, '€'), number('monthlyCost', 'Laufende Kosten pro Monat', 600, 0, 1e7, 1, '€'), number('setupCost', 'Einmalige Kosten', 5000, 0, 1e8, 1, '€'), number('months', 'Betrachtungszeitraum', 12, 1, 48, 1, 'Monate')],
    formula: 'Monatlicher Deckungsbeitrag = Besuche × Conversion-Rate / 100 × Deckungsbeitrag je Conversion. ROI = (gesamter Deckungsbeitrag − Gesamtkosten) / Gesamtkosten × 100.',
    limit: 'Konstante Monatswerte ohne Anlaufphase, Abzinsung oder Steuern. Zusätzliche Besuche und Conversions müssen außerhalb dieses Modells nachvollziehbar abgegrenzt werden. Umsatz ist kein Deckungsbeitrag. Bei Gesamtkosten 0 ist der ROI nicht definiert.',
    question: 'Warum wird der Deckungsbeitrag statt des Umsatzes verwendet?',
    answer: 'Umsatz enthält noch Kosten der Leistungserbringung. Der hier eingegebene Deckungsbeitrag je Conversion ist bereits um diese variablen Kosten vermindert. Anschließend werden die im Modell aufgeführten SEO-Kosten abgezogen. Kosten dürfen nicht doppelt erfasst werden.',
    sources: []
  },
  W041: {
    id: 'W041', title: 'Farbkontrast und Grenzwerte prüfen',
    description: 'Wähle Text- und Hintergrundfarbe. Die Kurve zeigt, wie sich der Kontrast beim Mischen der Textfarbe mit dem Hintergrund verändert.',
    fields: [color('foreground', 'Textfarbe', '#767676'), color('background', 'Hintergrundfarbe', '#ffffff')],
    formula: 'Kontrast = (L hell + 0,05) / (L dunkel + 0,05). L = 0,2126 R + 0,7152 G + 0,0722 B nach Linearisierung der sRGB-Kanäle.',
    limit: 'Berechnet zwei deckende sRGB-Farben. Transparenz, Verläufe, Bilder, tatsächliche Schriftform und weitere WCAG-Kriterien sind nicht geprüft. Die Kurve mischt kodierte sRGB-Kanäle; sie simuliert keine Sehbeeinträchtigung. Ein bestandener Farbtest ist keine vollständige Barrierefreiheitsprüfung.',
    question: 'Erfüllt ein auf 4,5 gerundeter Wert von 4,499 bereits AA für normalen Text?',
    answer: 'Nein. Die Entscheidung verwendet den ungerundeten Wert. AA für normalen Text verlangt mindestens 4,5:1; für großen Text gilt 3:1. Groß bedeutet in diesem Kriterium mindestens 18 pt beziehungsweise 14 pt bei fetter Schrift.',
    sources: [source('W3C: Kontrastminimum und ungerundete Grenzwerte', 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html'), source('W3C: Definition der relativen Luminanz', 'https://www.w3.org/TR/WCAG22/#dfn-relative-luminance')]
  },
  W044: {
    id: 'W044', title: 'Responsive Schriftgrößen mit clamp() erkunden',
    description: 'Lege zwei Viewport-Grenzen und Schriftgrößen fest. Die Kurve verbindet sie linear und bleibt außerhalb der Grenzen konstant.',
    fields: [number('minSize', 'Minimale Schriftgröße', 16, 1, 120, 0.5, 'px'), number('maxSize', 'Maximale Schriftgröße', 32, 1, 240, 0.5, 'px'), number('minViewport', 'Kleiner Viewport', 360, 1, 6000, 1, 'px'), number('maxViewport', 'Großer Viewport', 1440, 2, 10000, 1, 'px'), number('viewport', 'Zu prüfender Viewport', 900, 1, 10000, 1, 'px'), number('rootSize', 'Angenommene Basisschriftgröße', 16, 8, 64, 0.5, 'px', 'Für die Umrechnung des CSS-Beispiels in rem; keine Messung deiner Browser-Einstellung.')],
    formula: 'm = (Maximalgröße − Minimalgröße) / (großer − kleiner Viewport). b = Minimalgröße − m × kleiner Viewport. Schriftgröße = max(Minimum, min(Maximum, b + m × Viewport)).',
    limit: 'Lineares Modell für CSS-Pixel. Der ausgegebene CSS-Ausdruck wird nur zur Darstellung gerundet. Prüfe tatsächlichen Textumbruch, benutzerdefinierte Schriftgrößen und 200-%-Zoom im Browser. Die Kurve bescheinigt keine WCAG-Konformität.',
    question: 'Was geschieht unterhalb des kleinen oder oberhalb des großen Viewports?',
    answer: 'Die Größe bleibt an Minimum beziehungsweise Maximum. Der mittlere Ausdruck wächst nur dazwischen. min() und max() begrenzen die lineare Funktion; die Basisschriftgröße bestimmt im CSS-Beispiel die Umrechnung in rem.',
    sources: [source('MDN: CSS clamp()', 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/clamp')]
  },
  W051: {
    id: 'W051', title: 'Bildbreite und Pixeldichte vergleichen',
    description: 'Vergleiche die dargestellte Breite mit drei Bildkandidaten und der angenommenen Geräte-Pixeldichte.',
    fields: [number('slot', 'Dargestellte Bildbreite', 360, 1, 5000, 1, 'CSS-px'), number('dpr', 'Geräte-Pixeldichte', 2, 0.5, 5, 0.25, 'DPR'), number('candidate1', 'Kleiner Bildkandidat', 480, 1, 16000, 1, 'px'), number('candidate2', 'Mittlerer Bildkandidat', 960, 2, 16000, 1, 'px'), number('candidate3', 'Großer Bildkandidat', 1440, 3, 16000, 1, 'px')],
    formula: 'Rechnerischer Breitenbedarf = dargestellte CSS-Breite × DPR. Modellwahl: kleinster Kandidat mit mindestens dieser Breite; falls keiner reicht, größter vorhandener Kandidat.',
    limit: 'Vereinfachtes Modell für width-Deskriptoren und gleiche Bildausschnitte. Die tatsächliche Auswahl berücksichtigt unter anderem Browser, Netzwerk und Cache. Bildbreite allein sagt nichts Verlässliches über Dateigröße oder Bildqualität aus. Es wird keine Datei geladen.',
    question: 'Warum kann ein Browser einen anderen Kandidaten laden als dieses Modell?',
    answer: 'Browser dürfen weitere Bedingungen wie Netzwerk und vorhandene Cache-Einträge berücksichtigen. Außerdem muss sizes zur tatsächlichen Layoutbreite passen. Prüfe die geladene Ressource im Netzwerkbereich der Entwicklertools.',
    sources: [source('MDN: Responsive Bilder', 'https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images')]
  },
  W056: {
    id: 'W056', title: 'Sprite-Sheet-Geometrie nachvollziehen',
    description: 'Ordne gleich große Frames in Zeilen an und prüfe Blattgröße, Leerzellen und die Positionen der ersten Frames.',
    fields: [number('frames', 'Anzahl der Frames', 12, 1, 400, 1), number('columns', 'Spalten', 4, 1, 40, 1), number('frameWidth', 'Breite je Frame', 64, 1, 1024, 1, 'px'), number('frameHeight', 'Höhe je Frame', 64, 1, 1024, 1, 'px'), number('gap', 'Abstand zwischen Frames', 2, 0, 100, 1, 'px'), number('margin', 'Äußerer Rand', 2, 0, 100, 1, 'px')],
    formula: 'Zeilen = aufrunden(Frames / Spalten). Breite = 2 × Rand + Spalten × Framebreite + (Spalten − 1) × Abstand. Frame i ab 0: x = Rand + (i mod Spalten) × (Framebreite + Abstand).',
    limit: 'Gleich große, nicht gedrehte Frames; Abstand und Rand sind transparent gedacht. Kein Packing-Optimierer und keine Pixel-Extrusion. Leere Endzellen belegen Platz. Die Grafik zeigt die Positionen der ersten höchstens 40 Frames, die Tabelle höchstens 20.',
    question: 'Warum muss bei einer unvollständigen letzten Reihe trotzdem aufgerundet werden?',
    answer: 'Auch ein einzelner Frame in der letzten Reihe benötigt die volle Zeilenhöhe. 13 Frames bei 4 Spalten brauchen deshalb 4 Reihen und ergeben 3 ungenutzte Zellen.',
    sources: []
  },
  W060: {
    id: 'W060', title: 'Sprunghöhe, Flugzeit und Reichweite',
    description: 'Verändere Absprunggeschwindigkeit und Schwerkraft. Die Parabel zeigt den idealisierten Höhenverlauf bis zur Landung.',
    fields: [number('jump', 'Absprunggeschwindigkeit nach oben', 500, 0, 5000, 1, 'px/s'), number('gravity', 'Schwerkraft nach unten', 980, 1, 10000, 1, 'px/s²'), number('speed', 'Horizontale Geschwindigkeit', 220, 0, 5000, 1, 'px/s')],
    formula: 'Höhe(t) = v₀ × t − g × t² / 2. Scheitelzeit = v₀ / g. Maximale Höhe = v₀² / (2g). Flugzeit bis zur gleichen Ausgangshöhe = 2v₀ / g.',
    limit: 'Konstante Schwerkraft, gleiche Start- und Landehöhe, keine Luftreibung, Kollision oder variable Sprunghöhe. Die horizontale Geschwindigkeit bleibt konstant. Diskrete Spielphysik kann von dieser stetigen Modellkurve abweichen.',
    question: 'Was passiert bei doppelter Absprunggeschwindigkeit und gleicher Schwerkraft?',
    answer: 'Flugzeit und Reichweite verdoppeln sich. Die maximale Höhe vervierfacht sich, weil die Geschwindigkeit in der Höhenformel quadriert wird. Das gilt nur für die beschriebenen Modellannahmen.',
    sources: []
  },
  W062: {
    id: 'W062', title: 'Mindestens einen Loot-Treffer erhalten',
    description: 'Berechne die Wahrscheinlichkeit mindestens eines Treffers nach unabhängigen Versuchen mit unveränderter Einzelchance.',
    fields: [number('chance', 'Trefferchance pro Versuch', 2, 0, 100, 0.1, '%'), number('attempts', 'Anzahl der Versuche', 50, 0, 1000000, 1), number('target', 'Gewünschte kumulierte Chance', 90, 0, 100, 0.1, '%')],
    formula: 'P(mindestens ein Treffer) = 1 − (1 − p)ⁿ. Erwartete Trefferzahl = n × p. Für 0 < p < 1 und Ziel < 100 %: nötige Versuche = aufrunden(log(1 − Ziel) / log(1 − p)).',
    limit: 'Alle Versuche müssen unabhängig sein und dieselbe Chance haben. Kein Pity-System, Ziehen ohne Zurücklegen oder garantierter Drop. Erwartungswert und Trefferwahrscheinlichkeit sind verschiedene Größen. Bei p zwischen 0 und 1 ist eine exakt 100-%-Chance mit endlich vielen Versuchen nicht erreichbar.',
    question: 'Bedeutet eine erwartete Trefferzahl von 1, dass sicher ein Treffer auftritt?',
    answer: 'Nein. Bei 2 % Einzelchance und 50 Versuchen beträgt der Erwartungswert 1; die Chance auf mindestens einen Treffer liegt aber nur bei etwa 63,58 %. Auch null oder mehrere Treffer sind möglich.',
    sources: []
  },
  W066: {
    id: 'W066', title: 'Sequencer-Zeitplan und Drift-Szenario',
    description: 'Vergleiche feste Sollzeitpunkte mit einem Modell, in dem pro Schritt eine zusätzliche Verzögerung aufläuft.',
    fields: [number('bpm', 'Tempo in Viertelnoten pro Minute', 120, 20, 400, 1, 'BPM'), number('subdivision', 'Schritte pro Viertelnote', 4, 1, 16, 1), number('steps', 'Anzahl der Schritte', 16, 1, 64, 1), number('delay', 'Zusätzliche Verzögerung je Schritt', 2, 0, 100, 0.5, 'ms', 'Frei gewähltes Fehler-Szenario, keine gemessene Browserlatenz.')],
    formula: 'Schrittintervall = 60 / (BPM × Schritte je Viertelnote). Sollzeit von Schritt i ab 0 = i × Schrittintervall. Drift-Szenario = Sollzeit + i × angenommene Zusatzverzögerung.',
    limit: 'Keine Audiowiedergabe und keine Messung des Geräts. Swing, Scheduling-Fenster, tatsächliche Jitter-Verteilung und Audio-Hardwarelatenz sind nicht abgebildet. Für echte Wiedergabe müssen Ereignisse gegen die Audio-Zeitbasis geplant und im Browser geprüft werden.',
    question: 'Warum endet ein Muster mit 16 Schritten später als der Start des 16. Schritts?',
    answer: 'Die erste Note beginnt bei t = 0. Der letzte Start liegt nach 15 Intervallen; das Muster belegt insgesamt 16 Intervalle. Bei 120 BPM und vier Schritten je Viertelnote sind das 1,875 s beziehungsweise 2 s.',
    sources: [source('MDN: Audio erzeugen und sequenzieren', 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques')]
  },
  W070: {
    id: 'W070', title: 'Lineare ADSR-Hüllkurve formen',
    description: 'Verändere die vier Hüllkurvenphasen und die Haltezeit. Die Grafik zeigt einen normierten linearen Pegel, ohne Ton abzuspielen.',
    fields: [number('attack', 'Attack-Dauer', 0.15, 0, 10, 0.05, 's'), number('decay', 'Decay-Dauer', 0.25, 0, 10, 0.05, 's'), number('sustain', 'Sustain-Pegel', 55, 0, 100, 0.5, '%'), number('hold', 'Haltezeit auf Sustain-Pegel', 0.5, 0, 10, 0.05, 's'), number('release', 'Release-Dauer', 0.4, 0, 10, 0.05, 's')],
    formula: 'Attack: linear von 0 auf 1. Decay: linear von 1 auf Sustain. Hold: Sustain konstant. Release: linear von Sustain auf 0. Gesamtdauer = Attack + Decay + Hold + Release.',
    limit: 'Normierter linearer Amplitudenverlauf, keine Lautheits- oder Klangsimulation. Sustain ist ein Pegel, keine Dauer. Null Sekunden erzeugen eine mathematisch sofortige Kante; bei echter Audiowiedergabe können harte Sprünge Klicks verursachen. Taste-loslassen während Attack oder Decay ist nicht modelliert.',
    question: 'Was verändert sich, wenn nur der Sustain-Wert erhöht wird?',
    answer: 'Der Zielpegel nach Decay, der Haltepegel und der Startpegel von Release steigen. Die Gesamtdauer bleibt gleich. Wie laut ein Klang wahrgenommen wird, lässt sich daraus allein nicht bestimmen.',
    sources: [source('MDN: Lineare AudioParam-Rampen', 'https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/linearRampToValueAtTime')]
  },
  W076: {
    id: 'W076', title: 'Entscheidungen auf ihre Gewichtung prüfen',
    description: 'Vergleiche zwei Alternativen mit zwei Kriterien und finde heraus, bei welcher Gewichtung sich die Reihenfolge ändert.',
    fields: [number('weight', 'Gewicht von Kriterium 1', 65, 0, 100, 0.5, '%', 'Kriterium 2 erhält den restlichen Anteil bis 100 %.'), number('a1', 'Option A: Bewertung in Kriterium 1', 9, 0, 10, 0.1, 'Punkte'), number('a2', 'Option A: Bewertung in Kriterium 2', 5, 0, 10, 0.1, 'Punkte'), number('b1', 'Option B: Bewertung in Kriterium 1', 7, 0, 10, 0.1, 'Punkte'), number('b2', 'Option B: Bewertung in Kriterium 2', 9, 0, 10, 0.1, 'Punkte')],
    formula: 'Punktwert = Gewicht × Bewertung 1 + (1 − Gewicht) × Bewertung 2. Das Gewicht wird als Anteil zwischen 0 und 1 eingesetzt.',
    limit: 'Zwei frei bewertete Kriterien auf derselben Skala von 0 bis 10; höhere Werte bedeuten immer besser. Kosten daher vorher in eine Nutzenskala übersetzen. K.-o.-Kriterien, Abhängigkeiten und Unsicherheit der Bewertungen müssen separat beurteilt werden. Eine gewichtete Summe ist keine objektive Entscheidung.',
    question: 'Wann ist die Entscheidung empfindlich gegenüber dem Gewicht?',
    answer: 'Wenn sich die beiden Kurven nahe dem gewählten Gewicht schneiden. Dann kann schon eine kleine Änderung der Prioritäten die Rangfolge umkehren. Eine unveränderte Rangfolge sagt noch nichts über die Qualität der zugrunde gelegten Bewertungen aus.',
    sources: []
  }
};

function getModel(id) {
  if (!Object.hasOwn(models, id)) throw new Error('Unbekanntes Lernmodell.');
  return models[id];
}
export function getDefaultValues(id) {
  return Object.fromEntries(getModel(id).fields.map(field => [field.name, field.value]));
}
const inputError = (message, fields = []) => Object.assign(new Error(message), {fields});
// Compare the submitted decimal spelling before binary Number rounding can move
// a value over a bound or turn a fractional count into an integer. No powers of
// ten or unbounded zero padding are allocated for extreme exponent inputs.
function decimalParts(raw) {
  const [mantissa, exponent = '0'] = raw.replace(/^[+-]/, '').toLowerCase().split('e');
  const fraction = (mantissa.split('.')[1] || '').length;
  const untrimmed = mantissa.replace('.', '').replace(/^0+/, '');
  if (!untrimmed) return {sign: 0, digits: '', power: 0};
  const digits = untrimmed.replace(/0+$/, '');
  return {sign: raw.startsWith('-') ? -1 : 1, digits,
    power: Number(exponent) - fraction + untrimmed.length - digits.length};
}
function compareDecimal(a, b) {
  if (a.sign !== b.sign) return Math.sign(a.sign - b.sign);
  if (a.sign === 0) return 0;
  const magnitudeA = a.digits.length + a.power, magnitudeB = b.digits.length + b.power;
  if (magnitudeA !== magnitudeB) return Math.sign(magnitudeA - magnitudeB) * a.sign;
  const length = Math.max(a.digits.length, b.digits.length);
  for (let i = 0; i < length; i++) {
    const digitA = a.digits[i] || '0', digitB = b.digits[i] || '0';
    if (digitA !== digitB) return (digitA > digitB ? 1 : -1) * a.sign;
  }
  return 0;
}
export function validateValues(id, values) {
  const model = getModel(id);
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Bitte vollständige Eingabewerte angeben.');
  const allowed = new Set(model.fields.map(field => field.name));
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new Error('Unbekanntes Eingabefeld: ' + key + '.');
  const result = {};
  for (const field of model.fields) {
    const fail = message => { throw inputError(field.label + ': ' + message, [field.name]); };
    if (!Object.hasOwn(values, field.name)) fail('Bitte einen Wert angeben.');
    const raw = values[field.name];
    if (field.type === 'color') {
      if (typeof raw !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw)) fail('Bitte eine deckende Farbe im Format #RRGGBB angeben.');
      result[field.name] = raw.toLowerCase();
      continue;
    }
    const str = typeof raw === 'string' ? raw.trim().replace(',', '.') : String(raw);
    if (!['number', 'string'].includes(typeof raw) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(str)) fail('Bitte eine gültige Zahl eingeben.');
    const value = Number(str), decimal = decimalParts(str);
    if (!Number.isFinite(value)) fail('Die Zahl muss endlich sein.');
    if (value === 0 && decimal.sign !== 0) fail('Die Zahl ist zu klein für eine unverfälschte Berechnung (numerischer Unterlauf).');
    if (compareDecimal(decimal, decimalParts(String(field.min))) < 0 || compareDecimal(decimal, decimalParts(String(field.max))) > 0)
      fail('Erlaubt sind Werte von ' + field.min + ' bis ' + field.max + '.');
    if (field.integer && (!Number.isSafeInteger(value) || (decimal.sign !== 0 && decimal.power < 0)))
      fail('Bitte eine exakte ganze Zahl eingeben; Nachkommastellen werden nicht gerundet.');
    result[field.name] = Object.is(value, -0) ? 0 : value;
  }
  if (id === 'W026') {
    const invalid = ['A', 'B'].filter(segment => result['clicks' + segment] > result['impressions' + segment]);
    if (invalid.length) throw inputError('Klicks dürfen in keinem Segment größer als die Impressionen sein.', invalid.flatMap(segment => ['clicks' + segment, 'impressions' + segment]));
  }
  if (id === 'W028' && (result.ctrLow > result.ctrBase || result.ctrBase > result.ctrHigh))
    throw inputError('Die CTR-Werte müssen von konservativ über Basis bis optimistisch aufsteigend sein.', ['ctrLow', 'ctrBase', 'ctrHigh']);
  if (id === 'W044') {
    if (result.minSize > result.maxSize) throw inputError('Die minimale Schriftgröße darf nicht größer als die maximale sein.', ['minSize', 'maxSize']);
    if (result.minViewport >= result.maxViewport) throw inputError('Der große Viewport muss größer als der kleine sein.', ['minViewport', 'maxViewport']);
  }
  if (id === 'W051' && !(result.candidate1 < result.candidate2 && result.candidate2 < result.candidate3))
    throw inputError('Die drei Bildkandidaten müssen streng aufsteigend sein.', ['candidate1', 'candidate2', 'candidate3']);
  return result;
}

const metric = (label, value, unit = '', precision = 2) => ({ label, value, unit, precision });
const line = (label, points) => ({ label, points });
const point = (x, y) => ({ x, y });
const sample = (end, n = 41, start = 0) => Array.from({ length: n }, (_, i) => start + (end - start) * i / (n - 1));
const unique = numbers => [...new Set(numbers)].sort((a, b) => a - b);
const safeMetric = value => Number.isFinite(value) ? value : null;
const shown = value => value === null ? 'nicht definiert' : value;

function ctr(v) {
  const impressions = v.impressionsA + v.impressionsB, clicks = v.clicksA + v.clicksB;
  const a = v.impressionsA ? 100 * v.clicksA / v.impressionsA : null;
  const b = v.impressionsB ? 100 * v.clicksB / v.impressionsB : null;
  const pooled = impressions ? 100 * clicks / impressions : null;
  const rates = [a, b].filter(x => x !== null);
  const naive = rates.length ? rates.reduce((sum, x) => sum + x, 0) / rates.length : null;
  const delta = pooled === null ? null : pooled - v.baseline;
  const relative = pooled === null || v.baseline === 0 ? null : (pooled / v.baseline - 1) * 100;
  return {
    metrics: [metric('Gemeinsame CTR', pooled, '%'), metric('Einfaches Mittel vorhandener Segment-CTRs', naive, '%'), metric('Änderung zur Referenz', delta, 'Prozentpunkte'), metric('Relative Änderung zur Referenz', safeMetric(relative), '%')],
    chart: { xLabel: '1 = Segment A · 2 = Segment B · 3 = gesamt', yLabel: 'CTR (%)', xMin: 1, xMax: 3, yMin: 0, series: [line('CTR', [a, b, pooled].flatMap((value, i) => value === null ? [] : [point(i + 1, value)])), line('Referenz', [point(1, v.baseline), point(3, v.baseline)])] },
    table: { headers: ['Bereich', 'Klicks', 'Impressionen', 'CTR (%)'], rows: [['Segment A', v.clicksA, v.impressionsA, shown(a)], ['Segment B', v.clicksB, v.impressionsB, shown(b)], ['Gesamt', clicks, impressions, shown(pooled)]] },
    explanation: impressions ? 'Der Gesamtwert verwendet die Summe der Klicks und Impressionen. Segmente ohne Impressionen haben keine definierte CTR und werden beim einfachen Mittel nicht als null Prozent eingesetzt. ' + (v.baseline === 0 ? 'Die relative Änderung zur Referenz 0 ist nicht definiert.' : 'Prozentpunkte beschreiben eine absolute Differenz von Raten; Prozent beschreiben hier die relative Änderung.') : 'Ohne Impressionen gibt es keine definierte Klickrate. Fehlende Information wird nicht als beobachtete CTR von null Prozent ausgegeben.'
  };
}
function traffic(v) {
  const rows = [['Konservativ', v.ctrLow], ['Basis', v.ctrBase], ['Optimistisch', v.ctrHigh]].map(([name, rate]) => [name, rate, v.impressions * rate / 100, v.impressions * rate / 100 * v.conversion / 100]);
  return {
    metrics: [metric('Klicks im Basisszenario', rows[1][2], '', 1), metric('Conversions im Basisszenario', rows[1][3], '', 2), metric('Klickspanne zwischen Annahmen', rows[2][2] - rows[0][2], '', 1)],
    chart: { xLabel: 'Angenommene CTR (%)', yLabel: 'Rechnerische Klicks', yMin: 0, xMin: Math.max(0, v.ctrLow - 0.5), xMax: Math.min(100, Math.max(v.ctrHigh + 0.5, v.ctrLow + 1)), series: [line('Klicks bei konstanten Impressionen', rows.map(row => point(row[1], row[2])))] },
    table: { headers: ['Szenario', 'CTR (%)', 'Klicks', 'Erwartete Conversions'], rows },
    explanation: 'Die drei Fälle verwenden identische Impressionen und dieselbe Conversion-Rate. Die Bandbreite ist frei festgelegt, kein statistisches Intervall. ' + own
  };
}
function roi(v) {
  const conversions = v.visits * v.conversion / 100, monthly = conversions * v.contribution;
  const totalContribution = monthly * v.months, totalCost = v.setupCost + v.monthlyCost * v.months;
  const net = totalContribution - totalCost;
  const monthlySurplus = monthly - v.monthlyCost;
  const breakEven = v.setupCost === 0 ? 0 : monthlySurplus > 0 ? safeMetric(v.setupCost / monthlySurplus) : null;
  const rows = Array.from({ length: v.months + 1 }, (_, month) => [month, monthly * month, v.setupCost + v.monthlyCost * month, monthlySurplus * month - v.setupCost]);
  return {
    metrics: [metric('Deckungsbeitrag vor SEO-Kosten', totalContribution, '€'), metric('Gesamte SEO-Kosten', totalCost, '€'), metric('Ergebnis nach SEO-Kosten', net, '€'), metric('ROI', totalCost ? net / totalCost * 100 : null, '%'), metric('Erster rechnerischer Kostenausgleich', breakEven, 'Monate')],
    chart: { xLabel: 'Monat', yLabel: 'Kumulierte Euro', xMin: 0, xMax: v.months, yMin: 0, series: [line('Deckungsbeitrag', rows.map(row => point(row[0], row[1]))), line('SEO-Kosten', rows.map(row => point(row[0], row[2])))] },
    table: { headers: ['Monat', 'Deckungsbeitrag (€)', 'SEO-Kosten (€)', 'Ergebnis (€)'], rows },
    explanation: 'Alle Monatswerte bleiben konstant. Der Kostenausgleich verwendet innerhalb eines Monats eine lineare Verteilung. Bei einmaligen Kosten 0 ist t = 0 ein Gleichstand; spätere Verluste können trotzdem entstehen. ' + (totalCost === 0 ? 'Ein ROI durch Division durch null wird nicht ausgegeben. ' : '') + own
  };
}

function rgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Farbe muss im Format #RRGGBB vorliegen.');
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
}
function luminanceChannels(channels) {
  return channels.map(channel => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
}
export function relativeLuminance(hex) { return luminanceChannels(rgb(hex)); }
export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground), b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function passesContrast(ratio, threshold = 4.5) {
  if (!Number.isFinite(ratio) || !Number.isFinite(threshold)) throw new Error('Kontrastwerte müssen endlich sein.');
  return ratio >= threshold;
}
function contrast(v) {
  const ratio = contrastRatio(v.foreground, v.background), fg = rgb(v.foreground), bg = rgb(v.background), lb = luminanceChannels(bg);
  const curve = sample(100).map(percent => {
    const mixed = fg.map((channel, i) => channel + (bg[i] - channel) * percent / 100);
    const l = luminanceChannels(mixed);
    return point(percent, (Math.max(l, lb) + 0.05) / (Math.min(l, lb) + 0.05));
  });
  const checks = [['AA normaler Text', 4.5], ['AA großer Text', 3], ['AAA normaler Text', 7], ['AAA großer Text', 4.5]];
  return {
    metrics: [metric('Kontrastverhältnis', ratio, ':1', 4), metric('AA normaler Text', passesContrast(ratio) ? 'erreicht' : 'nicht erreicht'), metric('AA großer Text', passesContrast(ratio, 3) ? 'erreicht' : 'nicht erreicht')],
    chart: { xLabel: 'Mischanteil der Hintergrundfarbe (%)', yLabel: 'Kontrastverhältnis', xMin: 0, xMax: 100, yMin: 1, yMax: 21, series: [line('Kontrast der Mischfarbe', curve), line('AA normal: 4,5:1', [point(0, 4.5), point(100, 4.5)])] },
    table: { headers: ['Kriterium', 'Schwelle (:1)', 'Farbpaar im Modell'], rows: checks.map(([label, threshold]) => [label, threshold, passesContrast(ratio, threshold) ? 'erreicht' : 'nicht erreicht']) },
    explanation: 'Die Schwellenprüfung verwendet den ungerundeten Wert. Für das Diagramm wird die Textfarbe schrittweise mit dem Hintergrund gemischt; die Kontrolle bezieht sich auf das ursprünglich gewählte Farbpaar. Die Prüfung bewertet ausschließlich den Farbkontrast.',
    preview: { foreground: v.foreground, background: v.background, text: 'Beispieltext: Lesbarkeit mit diesem Farbpaar prüfen.' }
  };
}

export function clampSize(v, viewport) {
  const slope = (v.maxSize - v.minSize) / (v.maxViewport - v.minViewport);
  return Math.max(v.minSize, Math.min(v.maxSize, v.minSize + slope * (viewport - v.minViewport)));
}
function typography(v) {
  const slope = (v.maxSize - v.minSize) / (v.maxViewport - v.minViewport), intercept = v.minSize - slope * v.minViewport;
  const end = Math.max(v.maxViewport * 1.25, v.viewport);
  const xs = unique([...sample(end), v.minViewport, v.maxViewport, v.viewport]);
  const fmt = n => String(Number(n.toFixed(6)));
  const css = `clamp(${fmt(v.minSize / v.rootSize)}rem, calc(${fmt(intercept / v.rootSize)}rem + ${fmt(slope * 100)}vw), ${fmt(v.maxSize / v.rootSize)}rem)`;
  return {
    metrics: [metric('Größe am Prüf-Viewport', clampSize(v, v.viewport), 'px'), metric('Anstieg je 100 CSS-px', slope * 100, 'px', 4), metric('Minimum', v.minSize, 'px'), metric('Maximum', v.maxSize, 'px')],
    chart: { xLabel: 'Viewport-Breite (CSS-px)', yLabel: 'Schriftgröße (px)', xMin: 0, xMax: end, yMin: 0, series: [line('Begrenzte lineare Schriftgröße', xs.map(x => point(x, clampSize(v, x))))] },
    table: { headers: ['Viewport (CSS-px)', 'Modell-Schriftgröße (px)'], rows: unique([Math.max(1, v.minViewport / 2), v.minViewport, v.viewport, v.maxViewport, end]).map(x => [x, clampSize(v, x)]) },
    explanation: 'CSS-Beispiel bei der angegebenen Basisschriftgröße: font-size: ' + css + '; Die dargestellten Koeffizienten sind auf sechs Nachkommastellen gerundet; die Kurve wird ohne diese Rundung berechnet. Textvergrößerung und Zoom benötigen eine eigene Browserprüfung.'
  };
}
function responsiveImage(v) {
  const need = v.slot * v.dpr, candidates = [v.candidate1, v.candidate2, v.candidate3];
  const selected = candidates.find(width => width >= need) ?? candidates.at(-1);
  return {
    metrics: [metric('Rechnerischer Breitenbedarf', need, 'px'), metric('Kandidat nach Modellregel', selected, 'px', 0), metric('Effektive Kandidaten-Dichte', selected / v.slot, 'DPR'), metric('Breitendifferenz zum Bedarf', (selected / need - 1) * 100, '%')],
    chart: { xLabel: 'Geräte-Pixeldichte (DPR)', yLabel: 'Bildbreite (px)', xMin: 0.5, xMax: 5, yMin: 0, series: [line('Rechnerischer Bedarf', sample(5, 41, 0.5).map(dpr => point(dpr, v.slot * dpr))), line('Aktuell gewählter Modellkandidat', [point(0.5, selected), point(5, selected)])] },
    table: { headers: ['Kandidat (px)', 'Dichte bei diesem Slot', 'Aktueller Bedarf gedeckt'], rows: candidates.map(width => [width, width / v.slot, width >= need ? 'ja' : 'nein']) },
    explanation: (selected >= need ? 'Die Modellregel nimmt den kleinsten ausreichend breiten Kandidaten. ' : 'Kein Kandidat erreicht den Bedarf; das Modell wählt den größten verfügbaren. ') + 'Positive Prozentwerte bedeuten zusätzliche Breite, negative Werte ein Breiten-Defizit. Der reale Browser kann anders auswählen; die Differenz ist keine Dateigrößenprognose.'
  };
}
function sprites(v) {
  const rows = Math.ceil(v.frames / v.columns);
  const width = 2 * v.margin + v.columns * v.frameWidth + (v.columns - 1) * v.gap;
  const height = 2 * v.margin + rows * v.frameHeight + (rows - 1) * v.gap;
  const positions = Array.from({ length: Math.min(v.frames, 40) }, (_, i) => [i + 1, v.margin + i % v.columns * (v.frameWidth + v.gap), v.margin + Math.floor(i / v.columns) * (v.frameHeight + v.gap)]);
  return {
    metrics: [metric('Blattbreite', width, 'px', 0), metric('Blatthöhe', height, 'px', 0), metric('Zeilen', rows, '', 0), metric('Unbelegte Zellen', rows * v.columns - v.frames, '', 0)],
    chart: { xLabel: 'Frame-Nummer (erste maximal 40)', yLabel: 'Linke obere Position (px)', xMin: 1, xMax: Math.max(2, positions.length), yMin: 0, series: [line('X-Position', positions.map(row => point(row[0], row[1]))), line('Y-Position', positions.map(row => point(row[0], row[2])))] },
    table: { headers: ['Frame (erste maximal 20)', 'X (px)', 'Y (px)'], rows: positions.slice(0, 20) },
    explanation: 'Frames werden zeilenweise von links nach rechts eingetragen. Der äußere Rand liegt an allen vier Seiten; der Abstand liegt ausschließlich zwischen benachbarten Zellen. Die berechnete Blattgröße umfasst auch ungenutzte Endzellen. ' + own
  };
}
function jump(v) {
  const peakTime = v.jump / v.gravity, duration = 2 * peakTime, height = v.jump * v.jump / (2 * v.gravity);
  const at = t => Math.max(0, v.jump * t - v.gravity * t * t / 2);
  const times = duration ? sample(duration) : [0];
  return {
    metrics: [metric('Maximale Höhe', height, 'px'), metric('Zeit bis zum Scheitel', peakTime, 's', 3), metric('Gesamte Flugzeit', duration, 's', 3), metric('Horizontale Reichweite', v.speed * duration, 'px')],
    chart: { xLabel: 'Zeit seit Absprung (s)', yLabel: 'Höhe über Start (px)', xMin: 0, xMax: duration || 1, yMin: 0, yMax: height || 1, series: [line('Idealisierte Sprunghöhe', times.map(t => point(t, at(t))))] },
    table: { headers: ['Zeit (s)', 'Höhe (px)', 'Horizontaler Weg (px)'], rows: (duration ? sample(duration, 11) : [0]).map(t => [t, at(t), v.speed * t]) },
    explanation: 'Die Flugzeit endet beim Erreichen der Ausgangshöhe. Positive Höhe zeigt nach oben. Die horizontale Geschwindigkeit beeinflusst hier nur die Reichweite, nicht die Sprunghöhe. ' + own
  };
}

export function atLeastOne(probability, attempts) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !Number.isSafeInteger(attempts) || attempts < 0) throw new Error('Wahrscheinlichkeit und Versuchszahl sind ungültig.');
  if (attempts === 0 || probability === 0) return 0;
  if (probability === 1) return 1;
  return -Math.expm1(attempts * Math.log1p(-probability));
}
export function attemptsForTarget(probability, target) {
  if (!Number.isFinite(probability) || !Number.isFinite(target) || probability < 0 || probability > 1 || target < 0 || target > 1) throw new Error('Wahrscheinlichkeit und Ziel müssen zwischen 0 und 1 liegen.');
  if (target === 0) return 0;
  if (probability === 0) return null;
  if (probability === 1) return 1;
  if (target === 1) return null;
  let count = Math.ceil(Math.log1p(-target) / Math.log1p(-probability));
  if (!Number.isSafeInteger(count)) return null;
  // Correct a possible one-unit floating-point error at an exact integer boundary.
  if (count > 0 && atLeastOne(probability, count - 1) >= target) count--;
  if (atLeastOne(probability, count) < target) count++;
  return Number.isSafeInteger(count) ? count : null;
}
function loot(v) {
  const p = v.chance / 100, target = v.target / 100;
  const chance = atLeastOne(p, v.attempts), needed = attemptsForTarget(p, target);
  const ns = unique(sample(Math.max(1, v.attempts)).map(Math.round));
  const rows = unique([0, 1, 2, 5, 10, 20, 50, 100, v.attempts].filter(n => n <= v.attempts));
  return {
    metrics: [metric('Chance auf mindestens einen Treffer', chance * 100, '%', 4), metric('Erwartete Trefferzahl', v.attempts * p, '', 4), metric('Versuche für die Zielchance', needed, '', 0)],
    chart: { xLabel: 'Anzahl unabhängiger Versuche', yLabel: 'Mindestens ein Treffer (%)', xMin: 0, xMax: Math.max(1, v.attempts), yMin: 0, yMax: 100, series: [line('Kumulierte Trefferchance', ns.map(n => point(n, atLeastOne(p, n) * 100))), line('Gewählte Zielchance', [point(0, v.target), point(Math.max(1, v.attempts), v.target)])] },
    table: { headers: ['Versuche', 'Chance auf mindestens einen Treffer (%)', 'Erwartete Treffer'], rows: rows.map(n => [n, atLeastOne(p, n) * 100, n * p]) },
    explanation: 'Die Erwartungszahl zählt auch mehrere Treffer; die kumulierte Chance fragt nur nach mindestens einem. ' + (needed === null ? 'Die Zielchance ist nicht mit einer hier exakt darstellbaren endlichen Versuchszahl erreichbar. ' : 'Die benötigte Versuchszahl ist eine Wahrscheinlichkeitsschwelle, keine individuelle Erfolgsgarantie. ') + 'Sehr nahe bei 100 % können Anzeige und Gleitkommazahl auf 100 runden, obwohl bei p < 100 % mathematisch ein Restrisiko bleibt.'
  };
}
function sequencer(v) {
  const interval = 60 / (v.bpm * v.subdivision), duration = interval * v.steps, error = v.delay / 1000;
  const steps = unique(sample(v.steps - 1, Math.min(41, Math.max(2, v.steps))).map(Math.round));
  const rows = Array.from({ length: Math.min(v.steps, 32) }, (_, i) => [i + 1, i * interval, i * (interval + error), i * v.delay]);
  return {
    metrics: [metric('Sollintervall', interval * 1000, 'ms', 3), metric('Musterlänge ohne Drift', duration, 's', 3), metric('Start des letzten Schritts', (v.steps - 1) * interval, 's', 3), metric('Zusatzversatz am letzten Schritt', (v.steps - 1) * v.delay, 'ms', 3)],
    chart: { xLabel: 'Schritt-Nummer', yLabel: 'Startzeit (s)', xMin: 1, xMax: Math.max(2, v.steps), yMin: 0, series: [line('Fester Zeitplan', steps.map(i => point(i + 1, i * interval))), line('Angenommene kumulative Verzögerung', steps.map(i => point(i + 1, i * (interval + error))))] },
    table: { headers: ['Schritt (erste maximal 32)', 'Sollstart (s)', 'Drift-Szenario (s)', 'Versatz (ms)'], rows },
    explanation: 'Schritt 1 beginnt bei t = 0. Das Pattern endet ein Sollintervall nach dem letzten Sollstart. Die zweite Kurve addiert eine frei angenommene feste Verzögerung je Intervall; das ist ein Lehrbeispiel und keine gemessene Browserlatenz.'
  };
}

export function adsrValue(v, time) {
  const a = v.attack, d = v.decay, h = v.hold, r = v.release, s = v.sustain / 100;
  const total = a + d + h + r;
  if (time < 0 || time >= total) return 0;
  if (a > 0 && time < a) return time / a;
  if (d > 0 && time < a + d) return 1 + (s - 1) * (time - a) / d;
  if (h > 0 && time < a + d + h) return s;
  if (r > 0) return s * (1 - (time - a - d - h) / r);
  return 0;
}
function envelope(v) {
  const s = v.sustain / 100, a = v.attack, ad = a + v.decay, held = ad + v.hold, end = held + v.release;
  const area = a / 2 + v.decay * (1 + s) / 2 + v.hold * s + v.release * s / 2;
  return {
    metrics: [metric('Gesamtdauer', end, 's', 3), metric('Sustain-Pegel', v.sustain, '%'), metric('Mittlerer linearer Amplitudenwert', end ? area / end * 100 : null, '%', 3)],
    chart: { xLabel: 'Zeit (s)', yLabel: 'Normierte Amplitude', xMin: 0, xMax: end || 1, yMin: 0, yMax: 1, series: [line('Lineare ADSR-Hüllkurve', [point(0, 0), point(a, 1), point(ad, s), point(held, s), point(end, 0)])] },
    table: { headers: ['Phase', 'Start (s)', 'Ende (s)', 'Endpegel'], rows: [['Attack', 0, a, 1], ['Decay', a, ad, s], ['Hold', ad, held, s], ['Release', held, end, 0]] },
    explanation: 'Der Halteabschnitt beginnt nach vollständigem Attack und Decay. Das Loslassen ist danach fest angesetzt. Der Mittelwert ist das Integral der linearen Amplitude geteilt durch die Dauer, kein RMS- oder Lautheitswert. ' + (end === 0 ? 'Alle Phasen sind null Sekunden lang; es gibt keinen zeitlich ausgedehnten Verlauf und keinen definierten Mittelwert.' : 'Phasen mit null Sekunden erscheinen als unmittelbare Kanten.')
  };
}
const score = (first, second, weight) => second + (first - second) * weight / 100;
function matrix(v) {
  const a = score(v.a1, v.a2, v.weight), b = score(v.b1, v.b2, v.weight), delta = a - b;
  const slope = (v.a1 - v.a2) - (v.b1 - v.b2), intercept = v.a2 - v.b2;
  const same = slope === 0 && intercept === 0;
  const candidate = slope === 0 ? null : -intercept / slope * 100;
  const crossing = candidate !== null && candidate >= 0 && candidate <= 100 ? candidate : null;
  // Only suppress machine arithmetic noise, never round scores before comparison.
  const winner = Math.abs(delta) <= 8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) ? 'Gleichstand' : delta > 0 ? 'Option A' : 'Option B';
  const weights = unique([0, 25, 50, 75, 100, v.weight, ...(crossing === null ? [] : [crossing])]);
  return {
    metrics: [metric('Gewichteter Wert A', a, 'Punkte', 3), metric('Gewichteter Wert B', b, 'Punkte', 3), metric('Vorsprung A gegenüber B', delta, 'Punkte', 3), metric('Rangfolge im Modell', winner), metric('Gleichstand bei Gewicht 1', same ? 'bei jedem Gewicht' : crossing, same ? '' : '%', 3)],
    chart: { xLabel: 'Gewicht von Kriterium 1 (%)', yLabel: 'Gewichtete Punkte (0 bis 10)', xMin: 0, xMax: 100, yMin: 0, yMax: 10, series: [line('Option A', sample(100).map(w => point(w, score(v.a1, v.a2, w)))), line('Option B', sample(100).map(w => point(w, score(v.b1, v.b2, w))))] },
    table: { headers: ['Gewicht 1 (%)', 'Option A (Punkte)', 'Option B (Punkte)', 'A minus B (Punkte)'], rows: weights.map(w => [w, score(v.a1, v.a2, w), score(v.b1, v.b2, w), score(v.a1, v.a2, w) - score(v.b1, v.b2, w)]) },
    explanation: (same ? 'Beide Alternativen erhalten bei jeder Gewichtung denselben Punktwert. ' : crossing === null ? 'Die Kurven schneiden sich bei keinem Gewicht zwischen 0 und 100 %. ' : 'Die Kurven treffen sich am angegebenen Gewicht; vergleiche auch die Werte knapp davor und danach. ') + 'Beide Kriterien sind so orientiert, dass höhere Bewertungen besser sind. Die Rechnung prüft Gewichtungsabhängigkeit, nicht die Richtigkeit der Bewertungen.'
  };
}
const calculators = { W026: ctr, W028: traffic, W029: roi, W041: contrast, W044: typography, W051: responsiveImage, W056: sprites, W060: jump, W062: loot, W066: sequencer, W070: envelope, W076: matrix };
export function evaluateModel(id, values) {
  return calculators[getModel(id).id](validateValues(id, values));
}
