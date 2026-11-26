/** Public directory data: descriptions and links, never visitors' inputs. */
export function createToolCatalog(rows, guides, release, origin) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Toolkatalog benötigt eine HTTPS-Origin ohne Unterpfad.');
  const seen = new Set();
  const seenRoutes = new Set();
  const tools = rows.map(row => {
    if (seen.has(row.id) || seenRoutes.has(row.route) || !/^T\d{3}$/.test(row.id) || !/^\/tools\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(row.route)) throw new Error('Ungültiger oder doppelter Katalogeintrag: ' + row.id);
    seen.add(row.id);
    seenRoutes.add(row.route);
    const documentation = guides.filter(guide => guide.tid === row.id).map(guide => {
      if (!/^\/wissen\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(guide.route)) throw new Error('Ungültiger lokaler Leitfadenpfad: ' + guide.route);
      return { title: guide.title, url: new URL(guide.route, base).href };
    });
    if (new Set(documentation.map(guide => guide.url)).size !== documentation.length) throw new Error('Doppelter Leitfaden im Katalog: ' + row.id);
    return {
      id: row.id, title: row.title, category: row.cluster, categorySlug: row.c.slug,
      url: new URL(row.route, base).href, path: row.route,
      description: row.tool.method, limitations: row.tool.limit,
      inputTypes: [...new Set(Object.values(row.tool.fields).map(field => field.type))],
      documentation,
    };
  });
  return { schemaVersion: 1, version: release.version, language: 'de-DE', origin: base.origin, count: tools.length, tools };
}

export function toolCatalogCSV(catalog) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const headers = ['ID', 'Werkzeug', 'Themenwelt', 'URL', 'Funktion', 'Grenzen', 'Eingabetypen', 'Anleitungen'];
  return '\ufeff' + [headers, ...catalog.tools.map(tool => [tool.id, tool.title, tool.category, tool.url, tool.description, tool.limitations, tool.inputTypes.join(', '), tool.documentation.map(guide => guide.url).join(' | ')])].map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
}
