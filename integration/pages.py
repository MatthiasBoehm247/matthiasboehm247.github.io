#!/usr/bin/env python3
"""Validate and stage the installed Digital Labs site. Python 3.10+, stdlib only.

The manifest is an explicit public-file allowlist, not a directory crawler.
No repository write, Git command, deployment or network request is performed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET

ORIGIN = "https://matthiasboehm247.github.io"
REPOSITORY = "MatthiasBoehm247/matthiasboehm247.github.io"
FORBIDDEN_PARTS = {"source", "tests", "planung", "integration", "node_modules", "__pycache__"}
PUBLIC_SUFFIXES = {".html", ".css", ".js", ".mjs", ".json", ".xml", ".txt", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".ogg", ".wav", ".mp4", ".webm", ".pdf", ".csv", ".webmanifest"}
HASH = re.compile(r"^[a-f0-9]{64}$")


class ValidationError(ValueError):
    pass


def check_path(value: str) -> str:
    """Portable, relative and explicitly public paths only; never a glob."""
    if not isinstance(value, str) or not value or len(value) > 400:
        raise ValidationError("Leerer oder zu langer Dateipfad im Manifest.")
    if any(ord(c) < 32 for c in value) or any(c in value for c in "\\:*?<>|\"%#"):
        raise ValidationError(f"Unzulässiger Dateipfad: {value!r}")
    p = PurePosixPath(value)
    if p.is_absolute() or value != p.as_posix() or ".." in p.parts:
        raise ValidationError(f"Dateipfad muss relativ und normalisiert sein: {value}")
    if value == ".nojekyll":
        return value
    if any(part.startswith(".") or part.casefold() in FORBIDDEN_PARTS for part in p.parts):
        raise ValidationError(f"Interner Pfad darf nicht veröffentlicht werden: {value}")
    if any("backup" in part.casefold() for part in p.parts):
        raise ValidationError(f"Backup-Pfad darf nicht veröffentlicht werden: {value}")
    if p.stem.casefold() in {"secret", "secrets", "credentials", "token", "password", "id_rsa", "id_ed25519"}:
        raise ValidationError(f"Dateiname ist als vertraulich gesperrt: {value}")
    if p.suffix.casefold() not in PUBLIC_SUFFIXES:
        raise ValidationError(f"Dateityp ist nicht für die Website freigegeben: {value}")
    return value


def checked_file(root: Path, relative: str) -> Path:
    check_path(relative)
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValidationError(f"Symlink nicht erlaubt: {relative}")
    if not current.is_file():
        raise ValidationError(f"Datei fehlt oder ist keine reguläre Datei: {relative}")
    if not current.resolve().is_relative_to(root):
        raise ValidationError(f"Datei liegt außerhalb des Repositorys: {relative}")
    return current


def checked_report_path(path: Path | None, *, roots=(), protected=()) -> Path | None:
    """Reports must not overwrite input/staged files or follow links."""
    if path is None:
        return None
    path = path.absolute()
    for part in [path, *path.parents]:
        if part.is_symlink():
            raise ValidationError("Prüfbericht darf keinem Symlink folgen.")
    destination = path.resolve()
    if any(destination.is_relative_to(Path(root).resolve()) for root in roots if root is not None):
        raise ValidationError("Prüfbericht muss außerhalb des geprüften Repositorys und des Stagingziels liegen.")
    if any(destination == Path(item).resolve() for item in protected if item is not None):
        raise ValidationError("Prüfbericht darf keine Eingabedatei überschreiben.")
    if destination.exists() and not destination.is_file():
        raise ValidationError("Prüfbericht benötigt einen regulären Dateipfad.")
    return destination


def write_report(path: Path, report: dict, *, roots=(), protected=()) -> None:
    """Replace the report path without mutating a possibly hardlinked input inode."""
    destination = checked_report_path(path, roots=roots, protected=protected)
    destination.parent.mkdir(parents=True, exist_ok=True)
    checked_report_path(destination, roots=roots, protected=protected)
    fd, name = tempfile.mkstemp(prefix='.digital-labs-report-', suffix='.json', dir=destination.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write('\n')
        checked_report_path(destination, roots=roots, protected=protected)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def route_file(route: str) -> str:
    if not isinstance(route, str) or not route.startswith("/") or route.startswith("//"):
        raise ValidationError(f"Ungültige Seitenroute: {route!r}")
    u = urlsplit(route)
    if u.scheme or u.netloc or u.query or u.fragment or unquote(u.path) != route:
        raise ValidationError(f"Route darf keine URL-Parameter oder Kodierungen enthalten: {route}")
    relative = route.lstrip("/") + ("index.html" if route.endswith("/") else "")
    return check_path(relative)


def load_manifest(path: Path) -> dict:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"Manifest kann nicht gelesen werden: {exc}") from exc
    required = {"schemaVersion", "version", "origin", "files", "routes", "portfolioFiles"}
    if not isinstance(manifest, dict) or set(manifest) != required:
        raise ValidationError("Manifest benötigt genau schemaVersion, version, origin, files, routes, portfolioFiles.")
    if type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != 1:
        raise ValidationError("Unbekannte Manifest-Version.")
    if not isinstance(manifest["version"], str) or not re.fullmatch(r"\d+\.\d+\.\d+", manifest["version"]):
        raise ValidationError("Releaseversion muss drei Zahlen enthalten.")
    if manifest["origin"] != ORIGIN:
        raise ValidationError(f"Dieses Paket ist für {ORIGIN} gebaut. Für eine andere Domain neu bauen.")
    files, routes, portfolio = manifest["files"], manifest["routes"], manifest["portfolioFiles"]
    if not isinstance(files, dict) or not files or not isinstance(routes, list) or not routes:
        raise ValidationError("Leere oder ungültige Release-Dateien/Seitenrouten.")
    if not isinstance(portfolio, list) or "index.html" not in portfolio:
        raise ValidationError("portfolioFiles muss die bestehende index.html ausdrücklich enthalten.")
    for name, digest in files.items():
        check_path(name)
        if not isinstance(digest, str) or not HASH.fullmatch(digest):
            raise ValidationError(f"Ungültige SHA-256-Prüfsumme: {name}")
    for name in portfolio:
        check_path(name)
    all_names = list(files) + portfolio
    if len(all_names) != len(set(name.casefold() for name in all_names)):
        raise ValidationError("Doppelte Dateipfade oder Überschneidung von Release und Portfolio.")
    if not {".nojekyll", "robots.txt", "sitemap.xml"}.issubset(files):
        raise ValidationError(".nojekyll, robots.txt und sitemap.xml müssen im Release enthalten sein.")
    names, route_names, route_files = set(all_names), set(), set()
    for item in routes:
        if not isinstance(item, dict) or not {"route", "file", "canonicalRoute", "indexable", "noindex"}.issubset(item):
            raise ValidationError("Unvollständiger Seiteneintrag im Manifest.")
        expected = route_file(item["route"])
        if item["file"] != expected or expected not in files:
            raise ValidationError(f"Route und Release-Datei passen nicht zusammen: {item['route']}")
        route_file(item["canonicalRoute"])
        if type(item["indexable"]) is not bool or type(item["noindex"]) is not bool:
            raise ValidationError("Indexierungsangaben müssen true/false sein.")
        if item["indexable"] != (not item["noindex"] and item["route"] == item["canonicalRoute"]):
            raise ValidationError(f"Indexierungsangaben widersprechen dem Canonical: {item['route']}")
        if item["route"] in route_names or item["file"] in route_files:
            raise ValidationError(f"Doppelte Seitenroute: {item['route']}")
        route_names.add(item["route"])
        route_files.add(item["file"])
    if route_files != {name for name in files if name.lower().endswith(".html")}:
        raise ValidationError("Nicht alle Release-HTML-Dateien haben genau einen Routeneintrag.")
    for item in routes:
        if item["canonicalRoute"] not in route_names | {"/"}:
            raise ValidationError(f"Canonical-Ziel fehlt: {item['canonicalRoute']}")
    return manifest


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.title = ""
        self.in_title = False
        self.json_buffer = None
        self.jsonld = []
        self.templates = 0
        self.script_buffer = None
        self.inline_scripts = []
        self.style_buffer = None
        self.inline_styles = []

    def handle_starttag(self, tag, attrs):
        if tag == "template":
            self.templates += 1
        if self.templates:
            return
        attrs = dict(attrs)
        self.elements.append((tag, attrs))
        if attrs.get("style"):
            self.inline_styles.append(attrs["style"])
        if tag == "title":
            self.in_title = True
        if tag == "style":
            self.style_buffer = ""
        if tag == "script":
            script_type = (attrs.get("type") or "").strip().lower()
            if script_type == "application/ld+json":
                self.json_buffer = ""
            elif "src" not in attrs and (script_type in {"", "module"} or script_type in JS_MIME_TYPES):
                self.script_buffer = ["module" if script_type == "module" else "classic", ""]

    def handle_data(self, value):
        if self.templates:
            return
        if self.in_title:
            self.title += value
        if self.json_buffer is not None:
            self.json_buffer += value
        if self.script_buffer is not None:
            self.script_buffer[1] += value
        if self.style_buffer is not None:
            self.style_buffer += value

    def handle_endtag(self, tag):
        if tag == "template" and self.templates:
            self.templates -= 1
            return
        if self.templates:
            return
        if tag == "title":
            self.in_title = False
        if tag == "script" and self.json_buffer is not None:
            try:
                self.jsonld.append(json.loads(self.json_buffer))
            except json.JSONDecodeError as exc:
                raise ValidationError(f"Ungültiges JSON-LD: {exc}") from exc
            self.json_buffer = None
        if tag == "script" and self.script_buffer is not None:
            self.inline_scripts.append(tuple(self.script_buffer))
            self.script_buffer = None
        if tag == "style" and self.style_buffer is not None:
            self.inline_styles.append(self.style_buffer)
            self.style_buffer = None


JS_MIME_TYPES = {
    "application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript",
    "text/ecmascript", "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2",
    "text/javascript1.3", "text/javascript1.4", "text/javascript1.5", "text/jscript", "text/livescript",
    "text/x-ecmascript", "text/x-javascript",
}


def srcset_references(text: str):
    """Read candidate URLs using the HTML srcset token boundaries, including data URLs.

    This discovers file dependencies; it does not validate density/width descriptors.
    A comma inside a URL token belongs to that URL, while a trailing comma or a
    comma after its descriptors starts the next candidate.
    """
    whitespace = "\t\n\f\r "
    position, length = 0, len(text)
    while position < length:
        while position < length and text[position] in whitespace + ",":
            position += 1
        start = position
        while position < length and text[position] not in whitespace:
            position += 1
        value = text[start:position]
        if not value:
            break
        if value.endswith(","):
            yield value.rstrip(",")
            continue
        yield value
        parentheses = 0
        while position < length:
            character = text[position]
            position += 1
            if character == "(":
                parentheses += 1
            elif character == ")" and parentheses:
                parentheses -= 1
            elif character == "," and not parentheses:
                break


def css_references(text: str):
    """Discover ordinary CSS url() and quoted @import dependencies, skipping prose.

    Comments and other quoted strings are not dependencies. CSS string escapes
    are decoded so quoted spaces and escaped parentheses identify the same file
    as they do in the stylesheet. This is not a complete CSS validity checker.
    """
    length = len(text)

    def escape(position):
        position += 1
        if position == length:
            return "", position
        if text[position] in "\n\r\f":
            return "", position + (2 if text[position:position + 2] == "\r\n" else 1)
        match = re.match(r"[0-9a-fA-F]{1,6}", text[position:])
        if match:
            number = int(match.group(), 16)
            position += len(match.group())
            if position < length and text[position] in "\t\n\f\r ":
                position += 2 if text[position:position + 2] == "\r\n" else 1
            return chr(number) if 0 < number <= 0x10ffff and not 0xd800 <= number <= 0xdfff else "\ufffd", position
        return text[position], position + 1

    def string(position):
        quote = text[position]
        position += 1
        value = []
        while position < length:
            character = text[position]
            if character == quote:
                return "".join(value), position + 1
            if character == "\\":
                character, position = escape(position)
            else:
                position += 1
            value.append(character)
        return "".join(value), position

    def spaces(position):
        while position < length:
            if text[position].isspace():
                position += 1
            elif text.startswith("/*", position):
                closing = text.find("*/", position + 2)
                position = length if closing == -1 else closing + 2
            else:
                break
        return position

    position = 0
    while position < length:
        if text.startswith("/*", position):
            position = spaces(position)
        elif text[position] in "\"'":
            _, position = string(position)
        elif text[position:position + 7].lower() == "@import" and (position + 7 == length or not re.match(r"[\w-]", text[position + 7])):
            position = spaces(position + 7)
            if position < length and text[position] in "\"'":
                value, position = string(position)
                yield value
        elif (position == 0 or not re.match(r"[\w-]", text[position - 1])) and (match := re.match(r"url\s*\(", text[position:], re.I)):
            position = spaces(position + len(match.group()))
            if position < length and text[position] in "\"'":
                value, position = string(position)
            else:
                value = []
                while position < length and text[position] != ")":
                    character = text[position]
                    if character == "\\":
                        character, position = escape(position)
                    else:
                        position += 1
                    value.append(character)
                value = "".join(value).strip()
            yield value
            if position < length and text[position] == ")":
                position += 1
        else:
            position += 1


def local_reference(value: str, current: str) -> str | None:
    if not value or value.startswith(("#", "data:", "blob:", "mailto:", "tel:", "javascript:")):
        return None
    parsed = urlsplit(urljoin(ORIGIN + current, value))
    if parsed.scheme not in {"http", "https"} or parsed.netloc.casefold() != urlsplit(ORIGIN).netloc:
        return None
    path = unquote(parsed.path)
    return route_file(path)


def references(page: Page):
    for tag, attrs in page.elements:
        for key in ("href", "src", "poster"):
            if attrs.get(key):
                yield attrs[key]
        if attrs.get("srcset"):
            yield from srcset_references(attrs["srcset"])
        if tag == "meta" and attrs.get("property") in {"og:image", "og:url"}:
            yield attrs.get("content", "")


def module_references(text: str, *, imports_only: bool = False):
    """Find literal imports/exports and new URL/Worker paths outside comments/strings.

    This is dependency discovery, not a complete JavaScript parser. Computed
    specifiers and template interpolation require the actual browser gate.
    """
    tokens = []
    position, length = 0, len(text)
    identifiers = re.compile(r"[A-Za-z_$][\w$]*")
    escapes = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}

    def quoted(start):
        quote, value, current = text[start], [], start + 1
        while current < length:
            character = text[current]
            current += 1
            if character == quote:
                break
            if character == "\\" and current < length:
                character = text[current]
                current += 1
                if character in "\r\n":
                    if character == "\r" and current < length and text[current] == "\n":
                        current += 1
                    continue
                if character in {"x", "u"}:
                    width = 2 if character == "x" else 4
                    if character == "u" and text[current:current + 1] == "{":
                        end = text.find("}", current + 1)
                        candidate = text[current + 1:end] if end != -1 else ""
                        if re.fullmatch(r"[0-9a-fA-F]{1,6}", candidate) and int(candidate, 16) <= 0x10ffff:
                            character, current = chr(int(candidate, 16)), end + 1
                    elif re.fullmatch(r"[0-9a-fA-F]{" + str(width) + "}", text[current:current + width]):
                        character, current = chr(int(text[current:current + width], 16)), current + width
                else:
                    character = escapes.get(character, character)
            value.append(character)
        return "".join(value), current

    regex_allowed = True
    while position < length:
        character = text[position]
        if character.isspace():
            position += 1
            continue
        if text.startswith("//", position):
            end = text.find("\n", position + 2)
            position = length if end == -1 else end + 1
            continue
        if text.startswith("/*", position):
            end = text.find("*/", position + 2)
            position = length if end == -1 else end + 2
            continue
        if character in "\"'`":
            value, position = quoted(position)
            tokens.append(("string" if character != "`" else "template", value))
            regex_allowed = False
            continue
        if character == "/" and regex_allowed:
            position += 1
            brackets = False
            while position < length:
                current = text[position]
                position += 1
                if current == "\\":
                    position += position < length
                elif current == "[":
                    brackets = True
                elif current == "]":
                    brackets = False
                elif current == "/" and not brackets:
                    break
                elif current in "\r\n":
                    break
            while position < length and text[position].isalpha():
                position += 1
            tokens.append(("regex", ""))
            regex_allowed = False
            continue
        if match := identifiers.match(text, position):
            value = match.group()
            tokens.append(("identifier", value))
            position = match.end()
            regex_allowed = value in {"return", "throw", "case", "delete", "void", "typeof", "instanceof", "in", "of", "yield", "await", "else", "do"}
            continue
        tokens.append(("punctuation", character))
        regex_allowed = character not in ")]}." and not character.isdigit()
        position += 1

    specs = []
    for index, (kind, value) in enumerate(tokens):
        if kind != "identifier" or value not in {"import", "export", "new"} or (index and tokens[index - 1][1] == "."):
            continue
        following = tokens[index + 1:]
        if value == "import":
            if following and following[0][0] == "string":
                specs.append(following[0][1])
            elif len(following) > 2 and following[0][1] == "(" and following[1][0] == "string" and following[2][1] in {")", ","}:
                specs.append(following[1][1])
        if value in {"import", "export"} and following and following[0][1] not in {"(", "."}:
            for offset, token in enumerate(following):
                if token[1] == ";":
                    break
                if token == ("identifier", "from") and offset + 1 < len(following) and following[offset + 1][0] == "string":
                    specs.append(following[offset + 1][1])
                    break
        elif not imports_only and value == "new" and len(following) > 3 and following[0] in {("identifier", "Worker"), ("identifier", "URL")} and following[1][1] == "(" and following[2][0] == "string" and following[3][1] in {")", ","}:
            specs.append(following[2][1])
    return [spec for spec in specs if spec.startswith((".", "/"))]


def validate(root: Path, manifest: dict, check_js: bool = False) -> dict:
    if root.is_symlink():
        raise ValidationError("Repository-Pfad darf kein Symlink sein.")
    root = root.resolve(strict=True)
    files = manifest["files"]
    names = set(files) | set(manifest["portfolioFiles"])
    errors, total_bytes, ref_count, module_edges = [], 0, 0, 0
    digests, payloads, inline_scripts, script_kinds = {}, {}, [], {}
    for name in sorted(names):
        try:
            path = checked_file(root, name)
            raw = path.read_bytes()
            digests[name] = hashlib.sha256(raw).hexdigest()
            total_bytes += len(raw)
            if name in files and digests[name] != files[name]:
                errors.append(f"{name}: Prüfsumme weicht vom Release ab. Datei prüfen und Manifest mit dem Release neu erzeugen.")
            if path.suffix.lower() in {".html", ".css", ".mjs", ".js", ".xml", ".txt"}:
                payloads[name] = raw.decode("utf-8")
        except (OSError, UnicodeError, ValidationError) as exc:
            errors.append(str(exc))

    def require_reference(value: str, current: str):
        nonlocal ref_count
        try:
            name = local_reference(value, current)
            if name is not None:
                ref_count += 1
                if name not in names:
                    errors.append(f"{current}: lokales Ziel fehlt in der Freigabeliste: {value}")
        except (ValueError, ValidationError) as exc:
            errors.append(f"{current}: ungültiger lokaler Verweis {value!r}: {exc}")

    def script_kind(value: str, current: str, kind: str):
        try:
            name = local_reference(value, current)
            if name in names:
                script_kinds.setdefault(name, set()).add(kind)
        except (ValueError, ValidationError):
            # The ordinary dependency check already reports invalid references.
            pass

    def imported_script_kinds(text: str, current: str):
        for spec in module_references(text, imports_only=True):
            script_kind(spec, current, "module")

    titles = set()
    route_by_file = {r["file"]: r for r in manifest["routes"]}
    for name, text in payloads.items():
        if name.lower().endswith(".html"):
            parser = Page()
            try:
                parser.feed(text)
                parser.close()
                route = route_by_file.get(name)
                if route:
                    current = route["route"]
                    lang = [a.get("lang") for t, a in parser.elements if t == "html"]
                    if lang != ["de"] or sum(t == "h1" for t, _ in parser.elements) != 1:
                        errors.append(f"{current}: genau ein H1 und html lang=de erwartet.")
                    if not parser.title.strip() or parser.title in titles:
                        errors.append(f"{current}: leerer oder doppelter Seitentitel.")
                    titles.add(parser.title)
                    canons = [a.get("href") for t, a in parser.elements if t == "link" and a.get("rel") == "canonical"]
                    if canons != [ORIGIN + route["canonicalRoute"]]:
                        errors.append(f"{current}: Canonical stimmt nicht mit dem Manifest überein.")
                    robots = [a.get("content", "") for t, a in parser.elements if t == "meta" and a.get("name") == "robots"]
                    if len(robots) != 1 or ("noindex" in re.split(r"[\s,]+", robots[0].lower())) != route["noindex"]:
                        errors.append(f"{current}: Robots-Angabe stimmt nicht mit dem Manifest überein.")
                    desc = [a.get("content", "") for t, a in parser.elements if t == "meta" and a.get("name") == "description"]
                    if len(desc) != 1 or not desc[0].strip() or not parser.jsonld:
                        errors.append(f"{current}: Meta Description oder JSON-LD fehlt.")
                else:
                    current = "/" if name == "index.html" else "/" + name
                # Existing portfolio is exempt from Labs editorial rules, but all its
                # local dependencies must be explicitly staged as well.
                for value in references(parser):
                    require_reference(value, current)
                for tag, attrs in parser.elements:
                    script_type = (attrs.get("type") or "").strip().lower()
                    if tag == "script" and attrs.get("src") and (script_type in {"", "module"} or script_type in JS_MIME_TYPES):
                        script_kind(attrs["src"], current, "module" if script_type == "module" else "classic")
                for style in parser.inline_styles:
                    for value in css_references(style):
                        require_reference(value, current)
                for number, (kind, script) in enumerate(parser.inline_scripts, 1):
                    inline_scripts.append((f"{name} (Inline-Skript {number})", kind, script))
                    imported_script_kinds(script, current)
                    for spec in module_references(script):
                        require_reference(spec, current)
                        module_edges += 1
            except (ValueError, ValidationError) as exc:
                errors.append(f"{name}: {exc}")
        elif name.lower().endswith((".mjs", ".js")):
            imported_script_kinds(text, "/" + name)
            for spec in module_references(text):
                require_reference(spec, "/" + name)
                module_edges += 1
        elif name.lower().endswith(".css"):
            for value in css_references(text):
                require_reference(value, "/" + name)
    try:
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        sitemap = [node.text for node in ET.fromstring(payloads.get("sitemap.xml", "")).findall(".//s:loc", ns)]
        expected = {ORIGIN + "/"} | {ORIGIN + r["route"] for r in manifest["routes"] if r["indexable"]}
        if len(sitemap) != len(set(sitemap)) or set(sitemap) != expected:
            errors.append("Sitemap muss die Homepage und genau die selbstkanonischen indexierbaren Release-Seiten enthalten.")
        if f"Sitemap: {ORIGIN}/sitemap.xml" not in payloads.get("robots.txt", "").splitlines():
            errors.append("robots.txt enthält nicht die erwartete Sitemap-Adresse.")
    except ET.ParseError as exc:
        sitemap = []
        errors.append(f"Sitemap ist kein gültiges XML: {exc}")
    js_checked = inline_js_checked = js_grammar_checks = 0
    if check_js:
        executable = shutil.which("node")
        if executable is None:
            errors.append("Node.js fehlt: JavaScript-Syntax konnte nicht geprüft werden.")
        else:
            def parse_script(script, kind):
                # Parse verified bytes using the browser's declared grammar,
                # independent of file extension, package.json or Node's CJS wrapper.
                command = [executable, "--check", "--input-type=module"] if kind == "module" else [
                    executable, "--input-type=commonjs", "-e",
                    "new (require('node:vm').Script)(require('node:fs').readFileSync(0, 'utf8'), {filename: 'browser-script.js'});",
                ]
                return subprocess.run(command, input=script, capture_output=True, text=True, timeout=30)

            for name in sorted(names):
                if (name.lower().endswith((".mjs", ".js")) or name in script_kinds) and name in payloads:
                    js_checked += 1
                    kinds = script_kinds.get(name) or {"module" if name.lower().endswith(".mjs") else "classic"}
                    for kind in sorted(kinds):
                        result = parse_script(payloads[name], kind)
                        js_grammar_checks += 1
                        if result.returncode:
                            errors.append(f"{name}: JavaScript-Syntaxfehler ({kind}): {result.stderr.strip()[:700]}")
            for name, kind, script in inline_scripts:
                # Parse executable inline scripts as their declared script kind.
                # CommonJS wrappers accept top-level return and reserve names such
                # as module; vm.Script uses the browser's classic Script grammar.
                # Constructing a Script parses it without running its contents.
                result = parse_script(script, kind)
                inline_js_checked += 1
                if result.returncode:
                    errors.append(f"{name}: JavaScript-Syntaxfehler: {result.stderr.strip()[:700]}")
    return {
        "status": "FAIL" if errors else "PASS", "version": manifest["version"],
        "origin": ORIGIN, "files": len(names), "release_files": len(files),
        "portfolio_files": len(manifest["portfolioFiles"]), "html_routes": len(manifest["routes"]),
        "canonical_aliases": sum(r["route"] != r["canonicalRoute"] for r in manifest["routes"]),
        "noindex_pages": sum(r["noindex"] for r in manifest["routes"]), "sitemap_urls": len(sitemap),
        "local_references": ref_count, "module_edges": module_edges, "js_syntax_checked": js_checked,
        "inline_js_syntax_checked": inline_js_checked,
        "external_js_grammar_checks": js_grammar_checks,
        "bytes": total_bytes, "file_sha256": digests, "errors": errors,
        "scope": "Lokale Dateien, Prüfsummen, HTML-/CSS-Verweise, Module, Metadaten und Sitemap; bei --check-js auch ausführbare Inline-Skripte. Keine JavaScript-Ausführung, Browserdarstellung oder Live-Prüfung."
    }


def stage(root: Path, output: Path, report: dict) -> dict:
    """Stage validated bytes into a new directory without changing the checkout."""
    if report["status"] != "PASS":
        raise ValidationError("Staging abgebrochen: Die lokale Prüfung ist fehlgeschlagen.")
    root = root.resolve(strict=True)
    if output.is_symlink():
        raise ValidationError("Zielverzeichnis darf kein Symlink sein.")
    output = output.absolute()
    # Never follow an output parent symlink or replace a populated folder.
    for part in [output, *output.parents]:
        if part.is_symlink():
            raise ValidationError("Zielverzeichnis enthält einen Symlink.")
    destination = output.resolve()
    if destination == root or root.is_relative_to(destination):
        raise ValidationError("Stagingziel darf nicht das Repository oder dessen übergeordnetes Verzeichnis sein.")
    if destination.exists():
        raise ValidationError("Stagingziel existiert bereits. Neues, leeres Ziel angeben; es wird nichts gelöscht.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".digital-labs-stage-", dir=destination.parent))
    try:
        for name, expected in report["file_sha256"].items():
            source = checked_file(root, name)
            raw = source.read_bytes()
            if hashlib.sha256(raw).hexdigest() != expected:
                raise ValidationError(f"Datei wurde seit der Prüfung verändert: {name}")
            target = temporary / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        # Validate the actual artifact bytes, not only the inputs read above.
        # This also rejects symlinks introduced after an individual write.
        for name, expected in report["file_sha256"].items():
            staged = checked_file(temporary, name)
            if hashlib.sha256(staged.read_bytes()).hexdigest() != expected:
                raise ValidationError(f"Geschriebene Stagingdatei weicht von der Prüfung ab: {name}")
        staged_names = {path.relative_to(temporary).as_posix() for path in temporary.rglob('*') if not path.is_dir()}
        if staged_names != set(report["file_sha256"]):
            raise ValidationError("Staging enthält zusätzliche oder fehlende Dateien.")
        if destination.exists() or destination.is_symlink():
            raise ValidationError("Stagingziel wurde zwischenzeitlich angelegt; es wird nicht ersetzt.")
        temporary.rename(destination)
    except Exception:
        shutil.rmtree(temporary)
        raise
    return {**report, "staged": True, "output": str(destination)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Digital Labs: lokale GitHub-Pages-Dateien prüfen und vollständig bereitstellen.")
    parser.add_argument("command", choices=["validate", "stage"])
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--manifest", type=Path, default=Path(".github/digital-labs/deployment.json"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-js", action="store_true", help="Zusätzlich node --check für ausgelieferte JavaScript-Dateien und ausführbare Inline-Skripte ausführen.")
    parser.add_argument("--report", type=Path, help="JSON-Bericht außerhalb der veröffentlichten Dateien schreiben.")
    args = parser.parse_args(argv)
    report_path = None
    try:
        if args.command == "stage" and args.output is None:
            raise ValidationError("stage benötigt --output mit einem neuen Zielverzeichnis.")
        root = args.root.absolute()
        manifest_path = args.manifest if args.manifest.is_absolute() else root / args.manifest
        report_path = checked_report_path(args.report, roots=(root, args.output), protected=(manifest_path,))
        manifest = load_manifest(manifest_path)
        report = validate(root, manifest, args.check_js)
        if report["status"] == "PASS" and args.command == "stage":
            report = stage(root, args.output, report)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        report = {"status": "FAIL", "errors": [str(exc)], "staged": False}
    if report_path:
        # Recheck after validation/staging so a replaced parent cannot redirect
        # the report write into the just-verified site.
        try:
            write_report(report_path, report, roots=(args.root, args.output), protected=(manifest_path,))
        except (OSError, ValueError) as exc:
            report = {**report, "status": "FAIL", "errors": [*report.get("errors", []), str(exc)]}
    summary = {key: value for key, value in report.items() if key != "file_sha256"}
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
