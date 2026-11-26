#!/usr/bin/env python3
"""Install a static Digital Labs release additively. Never commit or push."""
from pathlib import Path
import argparse
import datetime
import hashlib
from html.parser import HTMLParser
import json
import os
import re
import shutil
import sys
import tempfile

HERE = Path(os.path.abspath(__file__)).parent
SITE = HERE / 'site'


class InstallationError(Exception):
    pass


def safe_path(path, *, file_expected=False):
    """Reject symlinks, including internal/broken links, and file ancestors."""
    path = Path(os.path.abspath(path))
    chain = list(reversed(path.parents)) + [path]
    for position, candidate in enumerate(chain):
        if candidate.is_symlink():
            raise InstallationError(f'Symbolischer Link ist nicht zulässig: {candidate}')
        if candidate.exists() and position < len(chain) - 1 and not candidate.is_dir():
            raise InstallationError(f'Übergeordneter Pfad ist keine Dateiablage: {candidate}')
    if file_expected and path.exists() and not path.is_file():
        raise InstallationError(f'Dateipfad kollidiert mit einem Verzeichnis: {path}')
    return path


def atomic_copy(source, target):
    """Replace a complete file and return the digest of our staged bytes."""
    safe_path(target, file_expected=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.labs-install-', dir=target.parent)
    os.close(fd)
    temporary = Path(temporary)
    try:
        shutil.copy2(source, temporary)
        written_digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
        os.replace(temporary, target)
        return written_digest
    finally:
        temporary.unlink(missing_ok=True)


def atomic_bytes(data, target):
    safe_path(target, file_expected=True)
    fd, temporary = tempfile.mkstemp(prefix='.labs-install-', dir=target.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        if target.exists():
            shutil.copymode(target, temporary)
        written_digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
        os.replace(temporary, target)
        return written_digest
    finally:
        temporary.unlink(missing_ok=True)


class HomepageAnchors(HTMLParser):
    """Locate real HTML insertion points without rewriting the portfolio."""
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.text = text
        self.lines = [0] + [match.end() for match in re.finditer('\n', text)]
        self.templates = 0
        self.link = False
        self.intro = False
        self.open = {tag: [] for tag in ('nav', 'header', 'main', 'section')}
        self.closed = {tag: [] for tag in self.open}

    def position(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def handle_starttag(self, tag, attributes):
        if tag == 'template':
            self.templates += 1
        if self.templates:
            return
        attributes = dict(attributes)
        self.link |= tag == 'a' and attributes.get('href') == '/digital-labs/'
        self.intro |= attributes.get('id') == 'digital-labs-intro'
        if tag in self.open:
            self.open[tag].append((self.position(), set((attributes.get('class') or '').split())))

    def handle_endtag(self, tag):
        if tag == 'template' and self.templates:
            self.templates -= 1
            return
        if self.templates or tag not in self.open or not self.open[tag]:
            return
        start, classes = self.open[tag].pop()
        closing = self.position()
        end = self.text.find('>', closing)
        if end != -1:
            self.closed[tag].append((start, closing, end + 1, classes))

    def first(self, tag, class_name=None):
        matches = [item for item in self.closed[tag] if class_name is None or class_name in item[3]]
        return min(matches, default=None, key=lambda item: item[0])


def integrate_homepage(original):
    try:
        changed = original.decode('utf-8')
    except UnicodeDecodeError as exc:
        raise InstallationError('Die vorhandene index.html ist keine gültige UTF-8-Datei.') from exc
    link = '<a href="/digital-labs/">Digital Labs</a>'
    banner = '''
<!-- Digital Labs 1.10.2: additive integration -->
<section id="digital-labs-intro" class="section" style="padding-block:2.5rem" aria-labelledby="digital-labs-title"><div class="wrap"><p class="eyebrow">Öffentliches Entwicklungslabor</p><h2 id="digital-labs-title">110 Browsertools. 80 Praxisleitfäden. 5 Studios.</h2><p style="max-width:50rem;margin-top:1rem">Kostenlose Werkzeuge und interaktive Lernmodelle für SEO, GEO, Datenanalyse, Webentwicklung, Design, Spiele und kreative Experimente – ohne Anmeldung und direkt im Browser.</p><a class="button" href="/digital-labs/">Digital Labs entdecken</a> <a class="text-link" href="/tools/">Alle Tools ansehen</a></div></section>
<!-- /Digital Labs -->
'''
    anchors = HomepageAnchors(changed)
    anchors.feed(changed)
    anchors.close()
    insertions = []
    if not anchors.link:
        nav = anchors.first('nav', 'main-nav')
        header = anchors.first('header')
        if nav:
            insertions.append((nav[1], link + '\n'))
        elif header:
            insertions.append((header[1], link))
        else:
            raise InstallationError('Navigationsbereich nicht erkannt. Digital-Labs-Link bitte manuell ergänzen.')
    if not anchors.intro:
        hero = anchors.first('section', 'hero')
        main = anchors.first('main')
        if hero:
            insertions.append((hero[2], banner))
        elif main:
            insertions.append((main[1], banner))
        else:
            raise InstallationError('Hauptinhalt nicht erkannt. Digital-Labs-Einführung bitte manuell ergänzen.')
    for position, content in sorted(insertions, reverse=True):
        changed = changed[:position] + content + changed[position:]
    return changed.encode('utf-8')


def github_files(target):
    """Explicit opt-in: prepare workflow files, never change GitHub settings."""
    mapping = {
        'pages.py': '.github/digital-labs/pages.py',
        'live_check.py': '.github/digital-labs/live_check.py',
        'deployment.json': '.github/digital-labs/deployment.json',
        'digital-labs-pages.yml': '.github/workflows/digital-labs-pages.yml',
        'qa/browser_gate.py': '.github/digital-labs/qa/browser_gate.py',
        'qa/fixtures.py': '.github/digital-labs/qa/fixtures.py',
        'qa/requirements.txt': '.github/digital-labs/qa/requirements.txt',
        'qa/README_DE.md': '.github/digital-labs/qa/README_DE.md',
    }
    workflows = safe_path(target / '.github/workflows')
    if workflows.exists():
        if not workflows.is_dir():
            raise InstallationError('Der Workflowpfad ist kein Verzeichnis.')
        for existing in workflows.iterdir():
            safe_path(existing)
            if existing.name == 'digital-labs-pages.yml' or existing.suffix not in {'.yml', '.yaml'}:
                continue
            if existing.is_file() and re.search(r'(?:actions/deploy-pages|peaceiris/actions-gh-pages|JamesIves/github-pages-deploy-action)@', existing.read_text(encoding='utf-8'), re.I):
                raise InstallationError(f'Bereits vorhandenen Pages-Workflow zuerst zusammenführen: {existing.name}. Ohne --with-github-pages bleibt er unverändert.')
    result = []
    for name, relative in mapping.items():
        source = safe_path(HERE / 'integration' / name, file_expected=True)
        if not source.is_file():
            raise InstallationError(f'GitHub-Integrationsdatei fehlt: integration/{name}')
        result.append((source, Path(relative)))
    return result


def rollback_entries(written, backup, target):
    """Undo our bytes, preserving changes made independently after each write.

    Files are rechecked immediately before rollback. This is a cooperative
    installer guard, not a filesystem transaction against arbitrary writers.
    Continue past an individual failure so unrelated entries can still recover.
    """
    unresolved = []
    for entry in reversed(written):
        destination, old = entry['path'], entry['old']
        relative = destination.relative_to(target)
        try:
            safe_path(destination, file_expected=True)
            current = destination.read_bytes() if destination.exists() else None
            if current == old:
                continue
            if current is None or hashlib.sha256(current).hexdigest() != entry['installed_digest']:
                unresolved.append(f'{relative}: zwischenzeitlich geändert; aktuelle Fassung bleibt erhalten')
                continue
            if old is None:
                destination.unlink()
            else:
                saved = safe_path(backup / relative, file_expected=True)
                if not saved.is_file() or saved.read_bytes() != old:
                    raise InstallationError('Backup stimmt nicht mit der ursprünglichen Datei überein')
                atomic_copy(saved, destination)
                if destination.read_bytes() != old:
                    raise InstallationError('Wiederhergestellte Bytes weichen vom Original ab')
        except (OSError, InstallationError) as exc:
            unresolved.append(f'{relative}: {exc}')
    return unresolved


def install(repository, *, dry_run=False, replace_existing=False, with_github_pages=False):
    target = safe_path(Path(repository).expanduser())
    safe_path(SITE)
    if not SITE.is_dir():
        raise InstallationError('Das Verzeichnis site/ fehlt im Vollpaket.')
    if target == SITE or SITE in target.parents or target in SITE.parents:
        raise InstallationError('Ziel und Quellpaket müssen getrennte Verzeichnisse sein.')
    homepage = safe_path(target / 'index.html', file_expected=True)
    if not target.is_dir() or not homepage.is_file():
        raise InstallationError('Ziel muss die vorhandene index.html deines Portfolios enthalten.')
    original = homepage.read_bytes()
    changed = integrate_homepage(original)
    known_path = HERE / 'source/previous-files-sha256.json'
    safe_path(known_path, file_expected=True)
    known = json.loads(known_path.read_text()) if known_path.exists() else {}
    copies, conflicts, upgrades = [], [], []
    candidates = []
    for source in sorted(SITE.rglob('*')):
        safe_path(source)
        relative = source.relative_to(SITE)
        if relative.parts[0].casefold() in {'.git', '.github'}:
            raise InstallationError(f'Repository- und Workflowdateien dürfen nicht im Website-Overlay liegen: {relative}')
        if source.is_dir():
            continue
        if not source.is_file():
            raise InstallationError(f'Unzulässiger Quelldateityp: {source.relative_to(SITE)}')
        if relative.as_posix() in {'index.html', 'README.md'} or (len(relative.parts) == 1 and re.fullmatch(r'google[^/]*\.html', relative.name, re.I)):
            raise InstallationError(f'Geschützte Portfoliodatei darf nicht im Overlay liegen: {relative}')
        candidates.append((source, relative))
    if with_github_pages:
        candidates.extend(github_files(target))
    for source, relative in candidates:
        destination = safe_path(target / relative, file_expected=True)
        old = destination.read_bytes() if destination.exists() else None
        new = source.read_bytes()
        if old == new:
            continue
        if old is not None:
            known_digests = known.get(relative.as_posix(), [])
            if isinstance(known_digests, str):
                known_digests = [known_digests]
            if hashlib.sha256(old).hexdigest() in known_digests:
                upgrades.append(relative)
            else:
                conflicts.append(relative)
        copies.append((source, destination, old, hashlib.sha256(new).hexdigest()))
    print(f'Ziel: {target}\n{len(copies)} neue/geänderte Release-Dateien, {len(conflicts)} Konflikte, {len(upgrades)} bekannte Release-Dateien zur Aktualisierung.\nStartseite: {"Link und Einführung ergänzen" if changed != original else "bereits integriert"}.')
    if with_github_pages:
        print('GitHub-Pages-Workflow wird vorbereitet. Die Einstellung Settings > Pages > Source muss auf GitHub Actions stehen.')
    if conflicts:
        print('Konflikte:\n' + '\n'.join(map(str, conflicts[:40])))
        if not replace_existing:
            raise InstallationError('Konflikte zuerst prüfen; nur nach bewusster Prüfung --replace-existing nutzen.')
    if dry_run:
        print('Dry run: keine Dateien geändert.')
        return
    if not copies and changed == original:
        print('Bereits aktuell: keine Dateien geändert, kein zusätzliches Backup angelegt.')
        return
    backup = target.parent / (target.name + '-labs-backup-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    safe_path(backup)
    backup.mkdir()
    # Back up the exact preflight snapshot, not a second read that could have
    # changed while the install was being prepared.
    atomic_bytes(original, backup / 'index.html')
    if (backup / 'index.html').read_bytes() != original:
        raise InstallationError('Backup der Startseite stimmt nicht mit der Vorprüfung überein.')
    safe_path(homepage, file_expected=True)
    shutil.copystat(homepage, backup / 'index.html', follow_symlinks=False)
    for source, destination, old, _ in copies:
        if old is not None:
            saved = backup / destination.relative_to(target)
            saved.parent.mkdir(parents=True, exist_ok=True)
            atomic_bytes(old, saved)
            if saved.read_bytes() != old:
                raise InstallationError(f'Backup stimmt nicht mit der Vorprüfung überein: {destination.relative_to(target)}')
            safe_path(destination, file_expected=True)
            shutil.copystat(destination, saved, follow_symlinks=False)
    written = []
    try:
        for source, destination, old, source_digest in copies:
            safe_path(source, file_expected=True)
            safe_path(destination, file_expected=True)
            current = destination.read_bytes() if destination.exists() else None
            if current != old or hashlib.sha256(source.read_bytes()).hexdigest() != source_digest:
                raise InstallationError('Dateien wurden während der Installation verändert; Vorgang wird zurückgerollt.')
            # Register before replacement: an interruption immediately after
            # os.replace must still participate in rollback.
            entry = {'path': destination, 'old': old, 'installed_digest': source_digest}
            written.append(entry)
            written_digest = atomic_copy(source, destination)
            # The source may change after the pre-copy check or while copy2 reads
            # it. Only accept the bytes actually installed, using the preflight
            # digest; include this destination in rollback before checking it.
            safe_path(destination, file_expected=True)
            # Ownership comes from the private temporary file before replacement,
            # not from an arbitrary writer's bytes observed after the write.
            if not isinstance(written_digest, str) or not re.fullmatch(r'[a-f0-9]{64}', written_digest):
                raise InstallationError('Schreibvorgang lieferte keine gültige Bytebestätigung.')
            entry['installed_digest'] = written_digest
            if written_digest != source_digest or hashlib.sha256(destination.read_bytes()).hexdigest() != written_digest:
                raise InstallationError('Kopierte Datei stimmt nicht mit der Vorprüfung überein; Vorgang wird zurückgerollt.')
        safe_path(homepage, file_expected=True)
        if homepage.read_bytes() != original:
            raise InstallationError('Startseite wurde während der Installation verändert; Vorgang wird zurückgerollt.')
        if changed != original:
            entry = {'path': homepage, 'old': original, 'installed_digest': hashlib.sha256(changed).hexdigest()}
            written.append(entry)
            written_digest = atomic_bytes(changed, homepage)
            safe_path(homepage, file_expected=True)
            if not isinstance(written_digest, str) or not re.fullmatch(r'[a-f0-9]{64}', written_digest):
                raise InstallationError('Schreibvorgang lieferte keine gültige Bytebestätigung.')
            entry['installed_digest'] = written_digest
            if written_digest != hashlib.sha256(changed).hexdigest() or hashlib.sha256(homepage.read_bytes()).hexdigest() != written_digest:
                raise InstallationError('Geschriebene Startseite stimmt nicht mit der Vorprüfung überein; Vorgang wird zurückgerollt.')
        # A later operation must not hide an independent edit to an earlier one.
        for entry in written:
            destination = safe_path(entry['path'], file_expected=True)
            if not destination.is_file() or hashlib.sha256(destination.read_bytes()).hexdigest() != entry['installed_digest']:
                raise InstallationError(f'Datei wurde nach dem Kopieren verändert: {destination.relative_to(target)}')
    except BaseException as cause:
        unresolved = rollback_entries(written, backup, target)
        if unresolved:
            raise InstallationError(
                f'Installation abgebrochen ({cause}). Rücknahme nicht vollständig; fremde Änderungen wurden erhalten. '
                f'Originaldateien im Backup: {backup}\n' + '\n'.join(unresolved)
            ) from cause
        raise
    print(f'Installation erfolgreich. Backup: {backup}\nGoogle-Verifizierungsdatei und bestehende README wurden nicht verändert.\nDie automatische Browserprüfung läuft beim GitHub-Pages-Workflow. Commit und Push sind separate Schritte.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', help='Pfad zum lokalen GitHub-Pages-Repository')
    parser.add_argument('--dry-run', action='store_true', help='Nur geplante Änderungen anzeigen')
    parser.add_argument('--replace-existing', action='store_true', help='Abweichende Dateien nach bewusster Prüfung und Backup ersetzen')
    parser.add_argument('--with-github-pages', action='store_true', help='Geprüfte Pages-Integrationsdateien und Veröffentlichungsworkflow zusätzlich installieren')
    args = parser.parse_args()
    try:
        install(args.repository, dry_run=args.dry_run, replace_existing=args.replace_existing, with_github_pages=args.with_github_pages)
    except (InstallationError, OSError, ValueError) as exc:
        sys.exit(f'Abbruch: {exc}')


if __name__ == '__main__':
    main()
