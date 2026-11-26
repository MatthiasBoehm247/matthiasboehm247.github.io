#!/usr/bin/env python3
"""Refresh the public release manifest after build and asset generation."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'integration'))
from pages import ORIGIN, REPOSITORY, check_path, load_manifest, ValidationError


def generate():
    site = ROOT / 'site'
    files = {}
    for path in sorted(site.rglob('*')):
        if path.is_symlink():
            raise ValidationError(f'Symlink im Release: {path.relative_to(site)}')
        if path.is_file():
            relative = check_path(path.relative_to(site).as_posix())
            files[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        elif not path.is_dir():
            raise ValidationError(f'Unbekannter Dateityp: {path}')
    release = json.loads((ROOT / 'source/release-config.json').read_text(encoding='utf-8'))
    settings = json.loads((ROOT / 'source/github-pages.json').read_text(encoding='utf-8'))
    if settings.get('origin') != ORIGIN or settings.get('repository') != REPOSITORY or settings.get('branch') != 'main':
        raise ValidationError('Diese Konfiguration passt nicht zum festgelegten GitHub-Pages-Ziel. Andere Domains oder Repository-Unterpfade benötigen einen angepassten Build und Workflow.')
    routes = json.loads((ROOT / 'source/routes.json').read_text(encoding='utf-8'))
    return {'schemaVersion': 1, 'version': release['version'], 'origin': ORIGIN,
            'files': files, 'routes': routes, 'portfolioFiles': settings['portfolioFiles']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'integration/deployment.json')
    args = parser.parse_args()
    try:
        manifest = generate()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=args.output.parent, prefix='.manifest-', suffix='.json')
        temporary = Path(name)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(manifest, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
            load_manifest(temporary)
            os.replace(temporary, args.output)
        finally:
            temporary.unlink(missing_ok=True)
        (ROOT / 'source/release-files-sha256.json').write_text(json.dumps(manifest['files'], indent=2) + '\n', encoding='utf-8')
        print(f"Release {manifest['version']}: {len(manifest['files'])} Website-Dateien und {len(manifest['routes'])} Seitenrouten. Manifest: {args.output}")
        print('Prüfsummen dokumentieren den lokalen Dateistand, keine fachliche oder Browser-Freigabe.')
    except (OSError, ValueError) as exc:
        parser.exit(1, f'Abbruch: {exc}\n')


if __name__ == '__main__':
    main()
