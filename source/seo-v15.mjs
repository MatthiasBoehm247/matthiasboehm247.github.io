import fs from 'node:fs';

// These are existing demonstrations of the same tool with preset inputs.
// Independent experiments (strategy game and water model) are not aliases.
const canonicalAliases = Object.freeze({
  '/labor/2d-levelideen/': '/tools/game-development/2d-levelideen-datenbank/',
  '/labor/line-art-morphing/': '/tools/musik-kreativitaet/generative-line-art-studio/',
  '/labor/web-audio-synthese/': '/tools/musik-kreativitaet/browser-synthesizer/',
  '/labor/interaktive-geschichten/': '/tools/musik-kreativitaet/interaktive-geschichten-builder/',
  '/labor/prozedurale-welten/': '/tools/game-development/prozeduraler-karten-generator/',
  '/labor/barrierefreie-browsertools/': '/tools/design/tastatur-fokus-demo/',
});

function assertRoute(route) {
  // Build routes are explicit ASCII slugs, not arbitrary input URLs. Reject URL
  // escapes and markup before they reach both HTML attributes and output paths.
  // Encoded dot segments otherwise canonicalize to a different browser URL.
  if (typeof route !== 'string' || !/^\/[A-Za-z0-9._~/-]*$/.test(route) ||
      route.includes('//') || route.split('/').some(part => part === '.' || part === '..')) {
    throw new TypeError(`Ungültiger lokaler Seitenpfad: ${String(route)}`);
  }
  return route;
}

export function canonicalRouteFor(route) {
  assertRoute(route);
  return Object.hasOwn(canonicalAliases, route) ? canonicalAliases[route] : route;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function berlinDate(timestamp) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateValue(value, label, now) {
  if (typeof value !== 'string') throw new TypeError(`${label}: Datum muss Text sein.`);
  // A date is sufficient. Times require an explicit UTC or numeric time zone.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) throw new TypeError(`${label}: YYYY-MM-DD oder ISO-Zeitpunkt mit Zeitzone erforderlich.`);
  const [, year, month, day, hour, minute, second, , zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) {
    throw new RangeError(`${label}: Ungültiges Kalenderdatum.`);
  }
  if (hour !== undefined) {
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
      throw new RangeError(`${label}: Ungültige Uhrzeit.`);
    }
    if (zone !== 'Z') {
      const [zh, zm] = zone.slice(1).split(':').map(Number);
      if (zh > 14 || zm > 59 || (zh === 14 && zm !== 0)) {
        throw new RangeError(`${label}: Ungültiger Zeitzonenversatz.`);
      }
    }
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RangeError(`${label}: Ungültiges Datum.`);
  if (hour === undefined ? value > berlinDate(now) : timestamp > now) {
    throw new RangeError(`${label}: Zukünftige Veröffentlichungsdaten sind nicht zulässig.`);
  }
  return { value, timestamp, dateOnly: hour === undefined };
}

/**
 * Validate editorial evidence before adding dates to public metadata.
 * Shape: { "/path/": { datePublished?: "…", dateModified?: "…", evidence: "…" } }.
 * Evidence is a human-recorded publication/change reference, e.g. a deployment
 * URL and checked date. A nonempty string is a required record, not an automated
 * verification of that evidence. Unknown dates must remain absent.
 */
export function validatePublicationLedger(input, { now = Date.now() } = {}) {
  if (!isRecord(input)) throw new TypeError('publication.json muss ein Objekt sein.');
  const currentTime = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(currentTime)) throw new TypeError('Ungültiger Prüfzeitpunkt.');
  const validated = Object.create(null);
  for (const [route, entry] of Object.entries(input)) {
    assertRoute(route);
    if (!isRecord(entry)) throw new TypeError(`${route}: Publikationseintrag muss ein Objekt sein.`);
    const unknown = Object.keys(entry).filter(key => !['datePublished', 'dateModified', 'evidence'].includes(key));
    if (unknown.length) throw new TypeError(`${route}: Unbekannte Publikationsfelder: ${unknown.join(', ')}`);
    if (typeof entry.evidence !== 'string' || !entry.evidence.trim()) {
      throw new TypeError(`${route}: Ein nachvollziehbarer Beleg (evidence) ist erforderlich.`);
    }
    const published = Object.hasOwn(entry, 'datePublished')
      ? dateValue(entry.datePublished, `${route} datePublished`, currentTime) : null;
    const modified = Object.hasOwn(entry, 'dateModified')
      ? dateValue(entry.dateModified, `${route} dateModified`, currentTime) : null;
    if (!published && !modified) throw new TypeError(`${route}: Mindestens ein belegtes Datum ist erforderlich.`);
    if (published && modified) {
      // A date-only value has day precision. Compare calendar days in the site's
      // time zone when either side lacks a time; compare exact instants otherwise.
      const p = published.dateOnly ? published.value : berlinDate(published.timestamp);
      const m = modified.dateOnly ? modified.value : berlinDate(modified.timestamp);
      const backwards = published.dateOnly || modified.dateOnly
        ? m < p : modified.timestamp < published.timestamp;
      if (backwards) throw new RangeError(`${route}: Änderung liegt vor der Erstveröffentlichung.`);
    }
    validated[route] = Object.freeze({
      ...(published ? { datePublished: published.value } : {}),
      ...(modified ? { dateModified: modified.value } : {}),
      evidence: entry.evidence.trim(),
    });
  }
  return Object.freeze(validated);
}

const publication = validatePublicationLedger(JSON.parse(
  fs.readFileSync(new URL('./publication.json', import.meta.url), 'utf8'),
));

export function getPublication(route) {
  assertRoute(route);
  const entry = publication[route];
  return entry ? {
    ...(entry.datePublished ? { datePublished: entry.datePublished } : {}),
    ...(entry.dateModified ? { dateModified: entry.dateModified } : {}),
  } : {};
}

/** Catch misspelled/retired ledger targets instead of silently dropping evidence. */
export function validatePublicationRoutes(routes, ledger = publication) {
  if (!Array.isArray(routes)) throw new TypeError('Seiteninventar muss eine Liste sein.');
  const known = new Set(routes.map(assertRoute));
  for (const route of Object.keys(ledger)) {
    assertRoute(route);
    if (!known.has(route)) throw new TypeError(`${route}: Publikationsbeleg gehört zu keiner vorhandenen Seite.`);
  }
  return true;
}

/** Metadata is maintained per real tool/guide, without silent generic fallbacks. */
export function validateSEOMetadata(metadata, { toolIds, guideIds }) {
  if (!isRecord(metadata)) throw new TypeError('SEO-Metadaten müssen ein Objekt sein.');
  const titles = new Set(), descriptions = new Set();
  for (const [group, ids] of [['tools', toolIds], ['guides', guideIds]]) {
    if (!isRecord(metadata[group]) || !Array.isArray(ids) || new Set(ids).size !== ids.length)
      throw new TypeError(`${group}: Ungültiges Metadateninventar.`);
    const expected = new Set(ids);
    for (const id of Object.keys(metadata[group])) if (!expected.has(id)) throw new TypeError(`${id}: Metadaten ohne vorhandene Seite.`);
    for (const id of ids) {
      const entry = metadata[group][id];
      if (!isRecord(entry)) throw new TypeError(`${id}: Individuelle SEO-Metadaten fehlen.`);
      for (const [field, seen] of [['title', titles], ['description', descriptions]]) {
        const value = entry[field];
        if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))
          throw new TypeError(`${id}: ${field} fehlt oder enthält ungültige Steuerzeichen.`);
        const key = value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('de-DE');
        if (seen.has(key)) throw new TypeError(`${id}: Doppelte SEO-${field}.`);
        seen.add(key);
      }
    }
  }
  return true;
}

const xml = value => String(value).replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;',
}[character]));

/** Only canonical, explicitly selected pages enter the sitemap. No build dates. */
export function createSitemap({ base, routes, publicationLedger = publication }) {
  const origin = originOf(base);
  if (!Array.isArray(routes) || !routes.length) throw new TypeError('Sitemap benötigt mindestens eine Route.');
  const ordered = [...new Set(routes.map(assertRoute))].sort();
  if (ordered.length !== routes.length) throw new TypeError('Doppelte Sitemap-Route.');
  const dates = validatePublicationLedger(publicationLedger);
  const entries = ordered.map(route => {
    if (canonicalRouteFor(route) !== route) throw new TypeError(`${route}: Demo-Aliasse gehören nicht in die Sitemap.`);
    // First publication alone is not evidence of a later significant modification.
    const lastmod = dates[route]?.dateModified;
    return `  <url><loc>${xml(origin + route)}</loc>${lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : ''}</url>`;
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.join('\n') + '\n</urlset>\n';
}

/** One release entry, rather than redating unchanged articles at every build. */
export function createPackageFeed({ base, release, person }) {
  const origin = originOf(base);
  if (!isRecord(release) || !/^\d+\.\d+\.\d+$/.test(release.version)) throw new TypeError('Ungültige Paketversion für den Feed.');
  const updated = dateValue(release.editorialUpdated, 'Feed-Paketstand', Date.now());
  if (updated.dateOnly) throw new TypeError('Der Atom-Feed benötigt einen Zeitstempel mit Zeitzone.');
  if (!isRecord(person) || typeof person.name !== 'string' || !person.name.trim()) throw new TypeError('Feed benötigt eine verantwortliche Person.');
  const title = `Digital Labs ${release.version} – Paketänderungen`;
  const summary = `Paket ${release.version}: Die Änderungshistorie beschreibt die tatsächlich eingebauten Verbesserungen und die Prüfgrenzen. Der Zeitpunkt bezeichnet diesen Paketstand, keine Live-Veröffentlichung, Indexierung oder Aktualisierung aller verlinkten Leitfäden.`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="de"><title>Matthias Böhm · Digital Labs · Paketänderungen</title><subtitle>Änderungen am Release-Paket. Veröffentlichungs- und Artikeldaten werden getrennt geführt.</subtitle><id>${xml(origin + '/digital-labs/')}</id><updated>${xml(updated.value)}</updated><link href="${xml(origin + '/feed.xml')}" rel="self" type="application/atom+xml"/><link href="${xml(origin + '/changelog/')}"/><author><name>${xml(person.name)}</name></author><entry><title>${xml(title)}</title><id>${xml(origin + '/changelog/#paket-' + release.version)}</id><link href="${xml(origin + '/changelog/')}"/><updated>${xml(updated.value)}</updated><summary>${xml(summary)}</summary></entry></feed>\n`;
}

function withoutUnverifiedDates(value) {
  if (Array.isArray(value)) return value.map(withoutUnverifiedDates);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'datePublished' && key !== 'dateModified')
    .map(([key, child]) => [key, withoutUnverifiedDates(child)]));
}

function originOf(base) {
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new TypeError('base muss der HTTP(S)-Ursprung ohne Unterpfad sein.');
  }
  return url.origin;
}

/** Build-time JSON-LD, separate from the browser application's runtime. */
export function createGraph({
  base, route, title, description, kind = 'WebPage', schema = {},
  parts = [['/', 'Portfolio'], [route, title]], person,
  canonicalRoute, ogImage, version,
}) {
  const origin = originOf(base);
  assertRoute(route);
  const preferredRoute = assertRoute(canonicalRoute ?? canonicalRouteFor(route));
  const pageURL = origin + route, canonicalURL = origin + preferredRoute;
  const isAlias = preferredRoute !== route;
  if (!isRecord(person) || typeof person['@id'] !== 'string' || !person['@id']) {
    throw new TypeError('Eine identifizierbare Person für Autor und Herausgeber ist erforderlich.');
  }
  if (!isRecord(schema)) throw new TypeError('schema muss ein Objekt sein.');
  const extra = withoutUnverifiedDates(schema);
  const author = { '@id': person['@id'] };
  const websiteID = origin + '/#website', pageID = pageURL + '#page';
  const breadcrumbID = pageURL + '#breadcrumb';
  const isArticle = ['Article', 'TechArticle', 'BlogPosting', 'NewsArticle'].includes(kind);
  const app = isRecord(extra.mainEntity) &&
    [extra.mainEntity['@type']].flat().some(type => ['WebApplication', 'SoftwareApplication'].includes(type))
    ? extra.mainEntity : null;
  const pageExtra = isArticle ? {} : { ...extra };
  if (app || isAlias) delete pageExtra.mainEntity;
  // Caller-supplied identities cannot overwrite the graph's linked identities.
  delete pageExtra['@id'];
  delete pageExtra['@type'];
  const page = {
    ...pageExtra,
    '@type': kind === 'CollectionPage' ? 'CollectionPage' : 'WebPage',
    '@id': pageID, url: pageURL, name: title, description, inLanguage: 'de-DE',
    isPartOf: { '@id': websiteID }, breadcrumb: { '@id': breadcrumbID },
    ...(ogImage ? { primaryImageOfPage: { '@type': 'ImageObject', url: ogImage } } : {}),
    ...getPublication(route),
  };
  const graph = [
    withoutUnverifiedDates(person),
    {
      '@type': 'WebSite', '@id': websiteID, url: origin + '/',
      name: person.name || 'Matthias Böhm',
      alternateName: 'Matthias Böhm – Portfolio und Digital Labs',
      inLanguage: 'de-DE', publisher: author,
    },
    page,
  ];

  if (isAlias) {
    // The page still describes this visible demo. Its tool is the existing
    // canonical application; do not mint a second application/article entity.
    if (Object.hasOwn(canonicalAliases, route) || app) {
      page.mainEntity = { '@id': canonicalURL + '#application' };
    } else {
      page.isBasedOn = { '@id': canonicalURL + '#page' };
    }
  } else if (isArticle) {
    const articleID = canonicalURL + '#article';
    page.mainEntity = { '@id': articleID };
    graph.push({
      ...extra,
      '@type': kind === 'TechArticle' ? ['Article', 'TechArticle'] : kind,
      '@id': articleID, url: canonicalURL,
      headline: extra.headline || title, description,
      inLanguage: 'de-DE', author: extra.author || author, publisher: author,
      mainEntityOfPage: { '@id': pageID },
      ...(extra.image || ogImage ? { image: extra.image || [ogImage] } : {}),
      ...getPublication(route),
    });
  } else if (app) {
    if (typeof version !== 'string' || !version.trim()) {
      throw new TypeError('Eine Releaseversion ist für das Anwendungsschema erforderlich.');
    }
    const appID = canonicalURL + '#application';
    page.mainEntity = { '@id': appID };
    graph.push({
      ...app,
      '@type': app['@type'], '@id': appID,
      url: canonicalURL, name: app.name || title, description: app.description || description,
      inLanguage: 'de-DE', softwareVersion: version,
      author: app.author || author, mainEntityOfPage: { '@id': pageID },
    });
  }

  graph.push({
    '@type': 'BreadcrumbList', '@id': breadcrumbID,
    itemListElement: parts.map(([path, label], index) => ({
      '@type': 'ListItem', position: index + 1, name: label,
      item: origin + assertRoute(path),
    })),
  });
  return graph;
}
