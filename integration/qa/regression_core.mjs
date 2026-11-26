#!/usr/bin/env node
/**
 * Public, dependency-free regressions against the production tool module.
 *
 * node integration/qa/regression_core.mjs --report /outside/checkout/core.json
 * Add --benchmark for one warm-up and five measured runs of each synthetic
 * workload. Timings are observations, never a browser/performance release gate.
 * Exit 0 requires every registered case (and requested workload) to pass.
 * JSON report: schema_version, status, expected_ids, cases, passed, failed,
 * module_sha256, environment, performance, limits. No private fixtures needed.
 */
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {execute, parseCSV, tools} from '../../site/assets/labs/tools.mjs';

const checkout = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const modulePath = new URL('../../site/assets/labs/tools.mjs', import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const milliseconds = value => Math.round(value * 1000) / 1000;
const run = (id, patch = {}) => execute(id, {
  ...Object.fromEntries(Object.entries(tools[id].fields).map(([key, field]) => [key, field.value])),
  ...patch,
});
const json = (id, patch) => JSON.parse(run(id, patch).text);
const rejects = (id, patch, pattern) => assert.throws(() => run(id, patch), pattern);
const refresh = (rows, age = 0) => json('T034', {
  age, data: 'url,impressions,ctr,target_ctr,age_days\n' + rows.join('\n'),
});
const yaml = text => json('T057', {text});
const definitions = [];
const check = (id, name, toolIds, fn) => definitions.push({id, name, tools: toolIds, fn});

// Fixed case inventory: an omitted, duplicated or unexpected case cannot pass.
const inventory = {CSV: 2, GSC: 8, SITEMAP: 5, PRIORITY: 3, CONTRAST: 4,
  YAML: 6, NUMBER: 4, ENCODING: 2, SEED: 5, RATIO: 1, BUDGET: 3};
const expectedIds = Object.entries(inventory).flatMap(([group, size]) =>
  Array.from({length: size}, (_, index) => `${group}-${String(index + 1).padStart(2, '0')}`));

check('CSV-01', 'BOM, quoted separators/newlines/quotes and final empty cells survive parsing', [], () => {
  assert.deepEqual(parseCSV('\uFEFFname,description,empty\r\n"Grüße 🌿","a,b\r\n""Zitat""",""'),
    [['name', 'description', 'empty'], ['Grüße 🌿', 'a,b\r\n"Zitat"', '']]);
  for (const delimiter of [';', '\t']) {
    assert.deepEqual(parseCSV(`a${delimiter}b\rc${delimiter}d`, delimiter), [['a', 'b'], ['c', 'd']]);
  }
});
check('CSV-02', 'Malformed quotes and record widths are rejected instead of losing cells', ['T038'], () => {
  for (const text of ['a,"unfinished', 'a,"closed"tail', 'a,b"c', 'a,"closed""']) {
    assert.throws(() => parseCSV(text), /Quotierung|Anführungszeichen/);
  }
  rejects('T038', {data: 'query,clicks,impressions\na,1,10,discarded'}, /Spaltenzahl/);
  rejects('T038', {data: 'query,clicks,impressions\na,1'}, /Spaltenzahl/);
});

check('GSC-01', 'CTR uses summed counts, not the average of row percentages', ['T038'], () => {
  assert.deepEqual(json('T038', {data: 'query,clicks,impressions\nseo,100,1000\nseo,90,9000'}), [
    {query: 'seo', dimension: 'query', clicks: 190, impressions: 10000, ctr: '1.9 %'},
  ]);
});
check('GSC-02', 'Comparison separates percentage points and export-only rows', ['T038'], () => {
  assert.deepEqual(json('T038', {
    data: 'query,clicks,impressions\nshared,30,1000\nnew,2,10',
    baseline: 'query,clicks,impressions\nshared,20,1000\nold,5,100', order: 'Klickverlust',
  }), [
    {query: 'old', dimension: 'query', clicks: 0, impressions: 0, ctr: 'nicht definiert', previousClicks: 5, previousImpressions: 100, previousCtr: '5 %', clickDelta: -5, impressionDelta: -100, ctrDeltaPP: null, presence: 'nur Vergleichsexport'},
    {query: 'new', dimension: 'query', clicks: 2, impressions: 10, ctr: '20 %', previousClicks: 0, previousImpressions: 0, previousCtr: 'nicht definiert', clickDelta: 2, impressionDelta: 10, ctrDeltaPP: null, presence: 'nur aktueller Export'},
    {query: 'shared', dimension: 'query', clicks: 30, impressions: 1000, ctr: '3 %', previousClicks: 20, previousImpressions: 1000, previousCtr: '2 %', clickDelta: 10, impressionDelta: 0, ctrDeltaPP: 1, presence: 'beide Exporte'},
  ]);
});
check('GSC-03', 'German export aliases preserve quoted Unicode labels and page dimensions', ['T038'], () => {
  assert.deepEqual(json('T038', {
    data: '\uFEFFSuchanfragen;Klicks;Impressionen\r\n"Grüße; \"\"🌿\"\"\nSEO";2;40', sep: ';', filter: 'GRÜSSE',
  }), []); // Case-insensitive matching does not rewrite ß to ss or merge labels.
  assert.deepEqual(json('T038', {
    data: '\uFEFFSuchanfragen;Klicks;Impressionen\r\n"Grüße; \"\"🌿\"\"\nSEO";2;40', sep: ';', filter: 'GRÜßE',
  }), [{query: 'Grüße; "🌿"\nSEO', dimension: 'query', clicks: 2, impressions: 40, ctr: '5 %'}]);
  assert.deepEqual(json('T038', {data: 'Top pages,Clicks,Impressions\nhttps://example.org/,1,20'}),
    [{query: 'https://example.org/', dimension: 'page', clicks: 1, impressions: 20, ctr: '5 %'}]);
});
check('GSC-04', 'Ambiguous dimensions, alias duplicates and missing metrics are rejected', ['T038'], () => {
  for (const data of [
    'query,page,clicks,impressions\na,https://example.org/,1,10',
    'query,clicks,Klicks,impressions\na,1,1,10',
    'query, clicks ,CLICKS,impressions\na,1,1,10',
    'Page,Impressions\nhttps://example.org/,10',
    'Country,Clicks,Impressions\nDE,1,10',
  ]) rejects('T038', {data}, /Dimension|Klicks|Spaltennamen/);
});
check('GSC-05', 'A display filter cannot conceal malformed or impossible source rows', ['T038'], () => {
  for (const row of ['hidden,11,10', 'hidden,-1,10', 'hidden,1.5,10', ' ,1,10', 'hidden,1']) {
    rejects('T038', {data: `query,clicks,impressions\nvisible,1,10\n${row}`, filter: 'visible'}, /Zeile 3/);
  }
});
check('GSC-06', 'Written integer boundaries and aggregate overflow are checked exactly', ['T038'], () => {
  for (const clicks of ['1.00000000000000001', '9007199254740992']) {
    rejects('T038', {data: `query,clicks,impressions\na,${clicks},9007199254740991`}, /Ganzzahl/);
  }
  rejects('T038', {data: 'query,clicks,impressions\na,0,9007199254740991\na,0,1'}, /Aggregat zu groß/);
  assert.deepEqual(json('T038', {data: 'query,clicks,impressions\na,1e2,1000.000'}),
    [{query: 'a', dimension: 'query', clicks: 100, impressions: 1000, ctr: '10 %'}]);
});
check('GSC-07', 'Comparison requires matching dimensions and a real baseline input', ['T038'], () => {
  rejects('T038', {data: 'query,clicks,impressions\na,1,10', baseline: 'page,clicks,impressions\na,1,10'}, /dieselbe Dimension/);
  for (const order of ['Klickverlust', 'Klickgewinn']) rejects('T038', {order, baseline: ''}, /Vergleichsexport/);
});
check('GSC-08', 'Zero denominators stay undefined in both raw and comparative outputs', ['T038'], () => {
  assert.deepEqual(json('T038', {data: 'query,clicks,impressions\na,0,0'}),
    [{query: 'a', dimension: 'query', clicks: 0, impressions: 0, ctr: 'nicht definiert'}]);
  const row = json('T038', {data: 'query,clicks,impressions\na,0,0', baseline: 'query,clicks,impressions\na,0,0'})[0];
  assert.equal(row.previousCtr, 'nicht definiert');
  assert.equal(row.ctrDeltaPP, null);
  assert.equal(row.presence, 'beide Exporte');
});

check('SITEMAP-01', 'Normalized UTF-8 URLs, XML escaping and a real leap day match fixed XML', ['T005'], () => {
  assert.equal(run('T005', {data: 'https://EXAMPLE.org:443/\nhttps://example.org/grüße?x=1&y=2 | 2024-02-29'}).text,
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.org/</loc></url>\n  <url><loc>https://example.org/gr%C3%BC%C3%9Fe?x=1&amp;y=2</loc><lastmod>2024-02-29</lastmod></url>\n</urlset>');
});
check('SITEMAP-02', 'Normalized duplicates retain dates and first order without merging queries', ['T005'], () => {
  assert.equal(run('T005', {data: 'https://EXAMPLE.org:443/a\rhttps://example.org/b?q=1\rhttps://example.org/a | 2024-02-29\rhttps://example.org/b?q=2\rhttps://example.org/a | 2024-02-29'}).text,
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.org/a</loc><lastmod>2024-02-29</lastmod></url>\n  <url><loc>https://example.org/b?q=1</loc></url>\n  <url><loc>https://example.org/b?q=2</loc></url>\n</urlset>');
});
check('SITEMAP-03', 'Every duplicate row is validated, including real date and physical line', ['T005'], () => {
  rejects('T005', {data: 'https://example.org/\n\nhttps://example.org/ | 2023-02-29'}, /Zeile 3: Ungültiges lastmod/);
  rejects('T005', {data: 'https://example.org/ | 2024-01-01\nhttps://example.org/ | 2024-01-02'}, /Widersprüchliche lastmod/);
  rejects('T005', {data: 'https://example.org/ | 2024-01-01 | discarded'}, /weitere Spalten/);
});
check('SITEMAP-04', 'The 2048-character limit applies after UTF-8 URL encoding', ['T005'], () => {
  const prefix = 'https://example.org/';
  const valid = prefix + 'a'.repeat(2047 - prefix.length);
  assert.ok(run('T005', {data: valid}).text.includes(`<loc>${valid}</loc>`));
  rejects('T005', {data: valid + 'a'}, /kürzer als 2.048/);
  // 337 × six encoded characters + the 20-character prefix + five = 2047.
  const unicode = prefix + 'ü'.repeat(337) + 'aaaaa';
  assert.ok(run('T005', {data: unicode}).text.includes('%C3%BC'));
  rejects('T005', {data: unicode + 'a'}, /nach URL-Kodierung/);
});
check('SITEMAP-05', 'Unsafe URLs, fragments and mixed origins cannot become sitemap entries', ['T005'], () => {
  for (const data of ['https://example.org/#', 'https://example.org/#part', 'https://user:pass@example.org/', 'https://example.org/a b', 'https://example.org/a\\b', 'javascript:alert(1)', 'https://example.org/\nhttp://example.org/']) {
    rejects('T005', {data});
  }
  assert.ok(run('T005', {data: 'https://example.org/%23literal'}).text.includes('/%23literal</loc>'));
});

check('PRIORITY-01', 'Refresh reference scores keep assumed opportunity and age weight distinct', ['T034'], () => {
  assert.deepEqual(refresh([
    'https://example.org/anleitung,10000,2,4,180',
    'https://example.org/hilfe,2000,1,3,300',
    'https://example.org/archiv,500,6,4,730',
    'https://example.org/leer,0,0,4,0',
  ], 0.1), [
    {url: 'https://example.org/anleitung', potential: 200, score: 218},
    {url: 'https://example.org/archiv', potential: 0, score: 73},
    {url: 'https://example.org/hilfe', potential: 40, score: 70},
    {url: 'https://example.org/leer', potential: 0, score: 0},
  ]);
});
check('PRIORITY-02', 'Raw complete scores determine ranking; genuine ties keep input order', ['T034'], () => {
  assert.deepEqual(refresh(['https://example.org/lower,100,0,1.001,0', 'https://example.org/higher,100,0,1.004,0']),
    [{url: 'https://example.org/higher', potential: 1, score: 1}, {url: 'https://example.org/lower', potential: 1, score: 1}]);
  assert.deepEqual(refresh(['https://example.org/clicks,100,0,1,0', 'https://example.org/age,0,0,0,10'], 0.1004).map(row => row.url),
    ['https://example.org/age', 'https://example.org/clicks']);
  assert.deepEqual(refresh(['https://example.org/first,100,0,1,0', 'https://example.org/second,100,0,1,0']).map(row => row.url),
    ['https://example.org/first', 'https://example.org/second']);
});
check('PRIORITY-03', 'Written percentage, count and age boundaries reject hidden excess', ['T034'], () => {
  for (const row of ['100,100.000000000000000001,100,0', '100,0,100.000000000000000001,0', '100,0,1,-1', '1.00000000000000001,0,1,0']) {
    assert.throws(() => refresh(['https://example.org/,' + row]), /CTR|Ganzzahl/);
  }
  assert.equal(refresh(['https://example.org/,100,0,100.000000000000000000,0'])[0].potential, 100);
});

const contrastResult = (ratio, aa, large, aaa) => ({
  Verhältnis: ratio, 'AA normal': aa, 'AA groß': large, 'AAA normal': aaa,
  'AAA groß': aa, 'Nicht-Text (3:1)': large,
});
check('CONTRAST-01', 'Opaque black/white and equal colors give fixed complete results', ['T061'], () => {
  assert.deepEqual(json('T061', {fg: '#000000', bg: '#ffffff'}), contrastResult('21:1', true, true, true));
  assert.deepEqual(json('T061', {fg: '#222222', bg: '#222222'}), contrastResult('1:1', false, false, false));
});
check('CONTRAST-02', 'Adjacent grey references fall on opposite sides of AA normal', ['T061'], () => {
  assert.deepEqual(json('T061', {fg: '#767676', bg: '#ffffff'}), contrastResult('4.542:1', true, true, false));
  assert.deepEqual(json('T061', {fg: '#777777', bg: '#ffffff'}), contrastResult('4.478:1', false, true, false));
});
check('CONTRAST-03', 'A displayed 4.5 ratio does not round a failed threshold into PASS', ['T061'], () => {
  // Independent 55-digit Decimal reference: 4.4997330361685571964…
  // W3C SC 1.4.3 requires comparing the unrounded value (reference below).
  const expected = contrastResult('4.5:1', false, true, false);
  assert.deepEqual(json('T061', {fg: '#7f7477', bg: '#ffffff'}), expected);
  assert.deepEqual(json('T061', {fg: '#ffffff', bg: '#7f7477'}), expected);
});
check('CONTRAST-04', 'Unsupported alpha, shorthand and malformed colors are rejected', ['T061'], () => {
  for (const fg of ['#fff', '#00000000', 'red', 'rgb(0,0,0)', '#gg0000', 'ffffff']) rejects('T061', {fg}, /HEX-Farbe/);
});

check('YAML-01', 'CR, LF and CRLF preserve every supported mapping record', ['T057'], () => {
  for (const newline of ['\r', '\n', '\r\n']) assert.deepEqual(yaml(['a: 1', 'b: 2', 'active: true'].join(newline)), {a: 1, b: 2, active: true});
  assert.deepEqual(yaml('a: 1\rb: 2\r\nactive: true\n'), {a: 1, b: 2, active: true});
});
check('YAML-02', 'Comment-only empty values preserve nulls and following nested blocks', ['T057'], () => {
  assert.deepEqual(yaml('a: # comment\nb:\nvalues:\n  - # comment\n  -\nsettings: # [comment]\n  active: true\nitems:\n  - # comment\n    name: Test'),
    {a: null, b: null, values: [null, null], settings: {active: true}, items: [{name: 'Test'}]});
});
check('YAML-03', 'Quoted hashes, escaped Unicode and supported comments keep their values', ['T057'], () => {
  assert.deepEqual(yaml('a: "Text # literal" # comment\nb: \'It\'\'s # text\' # comment\nc: "" # empty\nd: "Zeile\\nGrüße 🌿" # comment\ne: text # [comment] & !comment'),
    {a: 'Text # literal', b: "It's # text", c: '', d: 'Zeile\nGrüße 🌿', e: 'text'});
});
check('YAML-04', 'Unquoted mapping separators and quoted tails cannot be silently discarded', ['T057'], () => {
  for (const text of ['value: eins: zwei', 'value: eins:', 'items:\n  - eins: zwei', 'x: "text" tail', "x: 'text'tail", 'x: "text"#comment', 'x: "\\q"']) rejects('T057', {text});
  assert.deepEqual(yaml('value: "eins: zwei"\nurl: https://example.org/path#fragment\nlabel: foo#bar'),
    {value: 'eins: zwei', url: 'https://example.org/path#fragment', label: 'foo#bar'});
});
check('YAML-05', 'Unsupported syntax, duplicates, imprecise numbers and excessive depth reject', ['T057'], () => {
  for (const text of ['x: &anchor value', 'x: *anchor', 'x: |\n  text', 'a: 1\na: 2', 'x: 1e-400', 'x: 9007199254740993', 'a:\n   b: 1', 'a:\n\tb: 1', '['.repeat(130) + '0' + ']'.repeat(130)]) rejects('T057', {text});
  assert.deepEqual(yaml('large: "9007199254740993"\nsmall: 0.125'), {large: '9007199254740993', small: 0.125});
});
check('YAML-06', 'The JSON branch rejects duplicate and escaped duplicate keys or lost numbers', ['T057'], () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"n":9007199254740993}', '{"n":1e-400}']) rejects('T057', {text});
  assert.deepEqual(yaml('{"items":["Grüße 🌿",null,true,0.125]}'), {items: ['Grüße 🌿', null, true, 0.125]});
});

check('NUMBER-01', 'Numeric controls compare exact written bounds and integer fractions', ['T044', 'T067'], () => {
  rejects('T044', {na: '1000.00000000000000001'}, /exakte ganze Zahl/);
  for (const x of ['-80.000000000000000001', '80.000000000000000001']) rejects('T067', {x}, /zulässiger Bereich/);
  const expected = json('T044', {na: 1000});
  for (const na of ['1000.000', '1e3', '100000e-2', '+001000', '0.1e4']) assert.deepEqual(json('T044', {na}), expected);
});
check('NUMBER-02', 'Coercion, underflow and oversized number spellings fail before calculation', ['T067'], () => {
  for (const x of ['1e-999', '-1e-999', '0x10', 'Infinity', true, null]) rejects('T067', {x});
  rejects('T067', {x: '0'.repeat(1001)}, /maximal 1.000 Zeichen/);
  for (const x of ['-0.00', '0e999999', '0e-999999', '0'.repeat(1000)]) assert.equal(run('T067', {x}).text, run('T067', {x: 0}).text);
});
check('NUMBER-03', 'Exact damage hit thresholds retain immediately above/below distinctions', ['T089'], () => {
  assert.deepEqual(json('T089', {hp: '100', damage: '100', armor: '90', rate: '2'}),
    {EffektiverSchaden: 10, Treffer: 10, DPS: 20, 'Zeit ab erstem Treffer (s)': 4.5});
  assert.equal(json('T089', {hp: '100.00000000000000001', damage: '100', armor: '90'}).Treffer, 11);
  assert.equal(json('T089', {hp: '99.99999999999999999', damage: '100', armor: '90'}).Treffer, 10);
});
check('NUMBER-04', 'Timestamps preserve exact milliseconds and reject silent precision loss', ['T058'], () => {
  const value = json('T058', {time: '1.001', unit: 'Sekunden', zone: 'UTC'});
  assert.equal(value.UTC, '1970-01-01T00:00:01.001Z');
  assert.equal(value.Millisekunden, 1001);
  for (const time of ['1.0000001', '1.00100000000000001', '0.0001', '-0.0001']) rejects('T058', {time, unit: 'Sekunden'}, /nicht gerundet/);
  for (const time of ['8640000000000001', '-8640000000000001']) rejects('T058', {time, unit: 'Millisekunden'}, /gültigen Bereichs/);
});

check('ENCODING-01', 'UTF-8 Base64 has a fixed Unicode encoding and rejects malformed UTF-8', ['T056'], () => {
  assert.equal(run('T056', {mode: 'Kodieren', text: 'Grüße 🌿'}).text, 'R3LDvMOfZSDwn4y/');
  assert.equal(run('T056', {mode: 'Dekodieren', text: 'R3LDvMOfZSDwn4y/'}).text, 'Grüße 🌿');
  for (const text of ['/w==', 'wK8=', '7aCA']) rejects('T056', {mode: 'Dekodieren', text});
});
check('ENCODING-02', 'Empty Unicode regex matches advance by a full code point without hanging', ['T051'], () => {
  for (const flags of ['gu', 'gv', 'yu', 'yv']) assert.deepEqual(json('T051', {pattern: '(?:)', flags, text: '🌿'}).map(row => row.Index), [0, 2]);
  assert.deepEqual(json('T051', {pattern: '(?:)', flags: 'g', text: '🌿'}).map(row => row.Index), [0, 1, 2]);
});
for (const [index, id] of ['T085', 'T087', 'T090', 'T092', 'T101'].entries()) {
  check(`SEED-0${index + 1}`, `${id} distinguishes full emoji seeds and remains deterministic`, [id], () => {
    const fingerprint = seed => {const result = run(id, {seed}); return sha256(JSON.stringify(result.visual ?? result.text));};
    assert.notEqual(fingerprint('😀'), fingerprint('😁'));
    assert.equal(fingerprint('😀'), fingerprint('😀'));
  });
}
check('RATIO-01', 'Positive image dimensions never round down to zero pixels', ['T082'], () => {
  assert.deepEqual(json('T082', {width: 100000, height: 1, target: 1}), {Verhältnis: '100000:1', Zielbreite: 1, Zielhöhe: 1});
  assert.deepEqual(json('T082', {width: 3, height: 2, target: 10}), {Verhältnis: '3:2', Zielbreite: 10, Zielhöhe: 7});
});
check('BUDGET-01', 'Weighted budget and decimal conversion rates match a fixed reference', ['T048'], () => {
  assert.deepEqual(json('T048', {budget: 120, data: 'A | 1 | 2 | 2.5\nB | 2 | 4 | 5'}),
    [{Kanal: 'A', Budget: 40, Klicks: 20, Conversions: 0.5}, {Kanal: 'B', Budget: 80, Klicks: 20, Conversions: 1}]);
});
check('BUDGET-02', 'Written CVR limits and complete pipe rows prevent silent import changes', ['T048'], () => {
  rejects('T048', {data: 'A | 1 | 1 | 100.000000000000000001'}, /CVR/);
  rejects('T048', {data: 'A | 1 | 1 | 10 | discarded'}, /weitere Spalten/);
  assert.equal(json('T048', {budget: 100, data: 'A | 1 | 1 | 100.000000000000000000'})[0].Conversions, 100);
});
check('BUDGET-03', 'Huge equal weights stay finite; impossible output and zero totals reject', ['T048'], () => {
  assert.deepEqual(json('T048', {budget: 100, data: 'A | 1e308 | 1 | 2\nB | 1e308 | 1 | 2'}),
    [{Kanal: 'A', Budget: 50, Klicks: 50, Conversions: 1}, {Kanal: 'B', Budget: 50, Klicks: 50, Conversions: 1}]);
  rejects('T048', {data: 'A | 0 | 1 | 2\nB | 0 | 1 | 2'}, /positives Gewicht/);
  rejects('T048', {data: 'A | 1 | 5e-324 | 10'}, /Zahlenbereich/);
});

function benchmark() {
  const size = 10000;
  const queries = Array.from({length: size}, (_, i) => `q${String(i).padStart(5, '0')}`);
  const workloads = [
    {id: 'GSC-10000-COMPARE', tool: 'T038', input: {
      data: 'query,clicks,impressions\n' + queries.map(q => `${q},1,10`).join('\n'),
      baseline: 'query,clicks,impressions\n' + queries.map(q => `${q},2,20`).join('\n'),
    }, records_per_input: [size, size], verify(result) {
      const rows = JSON.parse(result.text);
      assert.equal(rows.length, size);
      assert.equal(rows[0].query, 'q00000'); assert.equal(rows.at(-1).query, 'q09999');
      assert.ok(rows.every(row => row.clicks === 1 && row.impressions === 10 && row.previousClicks === 2 && row.previousImpressions === 20 && row.ctr === '10 %' && row.ctrDeltaPP === 0 && row.clickDelta === -1 && row.presence === 'beide Exporte'));
    }},
    {id: 'SITEMAP-10000', tool: 'T005', input: {
      data: queries.map(q => `https://example.org/${q} | 2024-02-29`).join('\n'),
    }, records_per_input: [size], verify(result) {
      assert.equal((result.text.match(/<url>/g) || []).length, size);
      assert.equal((result.text.match(/<lastmod>2024-02-29<\/lastmod>/g) || []).length, size);
      assert.ok(result.text.includes('<loc>https://example.org/q00000</loc>'));
      assert.ok(result.text.includes('<loc>https://example.org/q09999</loc>'));
    }},
    {id: 'PRIORITY-10000', tool: 'T034', input: {
      age: 1, data: 'url,impressions,ctr,target_ctr,age_days\n' + queries.map((q, i) => `https://example.org/${q},100,0,1,${i}`).join('\n'),
    }, records_per_input: [size], verify(result) {
      const rows = JSON.parse(result.text);
      assert.equal(rows.length, size);
      assert.deepEqual(rows[0], {url: 'https://example.org/q09999', potential: 1, score: 10000});
      assert.deepEqual(rows.at(-1), {url: 'https://example.org/q00000', potential: 1, score: 1});
      assert.equal(rows.reduce((sum, row) => sum + row.score, 0), 50005000);
    }},
  ];
  const results = workloads.map(({id, tool, input, records_per_input, verify}) => {
    const times = []; let digest; let outputBytes;
    try {
      for (let iteration = 0; iteration < 6; iteration++) {
        const start = performance.now();
        const result = run(tool, input);
        const elapsed = performance.now() - start;
        verify(result); // Oracle validation and digesting are outside the timed section.
        const actual = sha256(result.text);
        if (digest) assert.equal(actual, digest, 'Workload output changed between runs');
        digest = actual; outputBytes = Buffer.byteLength(result.text);
        if (iteration > 0) times.push(elapsed);
      }
      const ordered = [...times].sort((a, b) => a - b);
      return {id, tool, status: 'PASS', records_per_input,
        input_utf16_units: Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, value.length])),
        output_bytes: outputBytes, output_sha256: digest, samples_ms: times.map(milliseconds),
        min_ms: milliseconds(ordered[0]), median_ms: milliseconds(ordered[2]), max_ms: milliseconds(ordered.at(-1))};
    } catch (error) {
      return {id, tool, status: 'FAIL', error: String(error.message)};
    }
  });
  return {status: results.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL',
    warmup_runs: 1, measured_runs: 5, timed_scope: 'Production validation, parsing, calculation and serialization; excludes fixture generation, reference assertions, hashing, DOM and browser rendering.',
    timing_threshold: null, environment_limit: 'Synthetic Node workloads on this machine; timings do not establish mobile responsiveness or a production service-level objective.', workloads: results};
}

function checkedReportPath(value) {
  const path = resolve(value);
  const rel = relative(checkout, path);
  if (rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))) throw Error('Report must be outside the checked repository.');
  let cursor = path;
  while (true) {
    // lstat also catches dangling symbolic links.
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) throw Error('Report path must not follow symbolic links.');
      if (cursor === path ? !stat.isFile() : !stat.isDirectory()) throw Error('Report path must be a regular file with directory parents.');
    } catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (dirname(cursor) === cursor) break;
    cursor = dirname(cursor);
  }
  return path;
}
function writeReport(destination, report) {
  const path = checkedReportPath(destination);
  mkdirSync(dirname(path), {recursive: true});
  checkedReportPath(path);
  const temporary = resolve(dirname(path), `.digital-labs-core-${randomUUID()}.json`);
  try {
    writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    checkedReportPath(path);
    renameSync(temporary, path); // Do not truncate a file hardlinked to an input.
  } finally {if (existsSync(temporary)) unlinkSync(temporary);}
}

function main() {
  const args = process.argv.slice(2);
  let reportPath; let measure = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--help') {
      process.stdout.write('Usage: node integration/qa/regression_core.mjs [--report /outside/checkout/core.json] [--benchmark]\nExit 0: all registered regressions and requested workload checks passed. Exit 1: failure.\n');
      return;
    }
    if (args[index] === '--benchmark' && !measure) measure = true;
    else if (args[index] === '--report' && !reportPath && args[index + 1] && !args[index + 1].startsWith('--')) reportPath = checkedReportPath(args[++index]);
    else throw Error('Unknown, duplicate or incomplete argument: ' + args[index]);
  }
  assert.deepEqual(definitions.map(row => row.id), expectedIds, 'Regression inventory must match exactly');
  const started = new Date().toISOString();
  const cases = definitions.map(({id, name, tools: toolIds, fn}) => {
    const start = performance.now();
    try {fn(); return {id, name, tools: toolIds, status: 'PASS', duration_ms: milliseconds(performance.now() - start)};}
    catch (error) {return {id, name, tools: toolIds, status: 'FAIL', duration_ms: milliseconds(performance.now() - start), error: String(error.message)};}
  });
  const performanceReport = measure ? benchmark() : {status: 'NOT_RUN', reason: 'Pass --benchmark to collect local synthetic workload measurements.'};
  const passed = cases.filter(row => row.status === 'PASS').length;
  const failed = cases.length - passed;
  const report = {
    schema_version: 1, suite: 'digital-labs-public-core', status: failed === 0 && performanceReport.status !== 'FAIL' ? 'PASS' : 'FAIL',
    started_at: started, completed_at: new Date().toISOString(), module_sha256: sha256(readFileSync(modulePath)),
    environment: {node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown'},
    expected_ids: expectedIds, expected: expectedIds.length, executed: cases.length, passed, failed, cases,
    performance: performanceReport,
    references: [
      {url: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html', scope: 'Opaque sRGB contrast and unrounded 3:1/4.5:1 thresholds; not a whole-page accessibility audit.'},
      {url: 'https://www.sitemaps.org/protocol.html', scope: 'Entity escaping, UTF-8 URL encoding and URL length; generator uses its documented same-origin/date subset.'},
      {url: 'https://yaml.org/spec/1.2.2/', scope: 'Line breaks, comments and scalar boundaries; T057 intentionally supports only a limited subset.'},
    ],
    limits: [
      'Executes the actual production module in Node with public synthetic inputs; does not read private plans, historical sources or captured previous-release reports.',
      'T009 XML parsing, native downloads, media, storage, page lifecycle and rendered accessibility remain the responsibility of the native browser gate.',
      'GSC export completeness, actual period/filter equivalence, search visibility and content forecasts are not validated by arithmetic reference cases.',
      'The case count describes registered regression cases; loops contain additional boundary assertions and are not presented as separate browser cases.',
    ],
  };
  if (reportPath) writeReport(reportPath, report);
  process.stdout.write(JSON.stringify({suite: report.suite, status: report.status, expected: report.expected, executed: report.executed, passed, failed, performance: performanceReport.status, failures: cases.filter(row => row.status === 'FAIL').map(({id, error}) => ({id, error})), ...(reportPath ? {report: reportPath} : {})}) + '\n');
  if (report.status !== 'PASS') process.exitCode = 1;
}

try {main();}
catch (error) {
  process.stderr.write('Core regression failed: ' + String(error.message) + '\n');
  process.exitCode = 1;
}
