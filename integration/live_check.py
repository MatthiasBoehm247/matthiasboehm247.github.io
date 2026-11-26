#!/usr/bin/env python3
"""Read-only public HTTP check after a deployment; no browser execution."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from http.client import HTTPException
import json
from pathlib import Path
import sys
import time
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pages import HASH, ORIGIN, ValidationError, check_path, checked_file, checked_report_path, load_manifest, write_report


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def select_files(manifest, all_files=False):
    public_names = set(manifest["files"]) | set(manifest["portfolioFiles"])
    if all_files:
        # .nojekyll is a build-control file, not a required public HTTP endpoint.
        return sorted(public_names - {".nojekyll"})
    wanted = {"index.html", "robots.txt", "sitemap.xml", "digital-labs/index.html", "tools/index.html", "wissen/index.html", "vorlagen/index.html", "studios/index.html", "arbeitsbereich/index.html", "suche/index.html", "assets/labs/release.json"}
    wanted |= {name for name in manifest["files"] if "catalog" in name.lower() and name.endswith((".json", ".csv"))}
    wanted |= {name for name in public_names if name.lower().endswith((".js", ".mjs", ".css"))}
    # At least one interactive tool per category, chosen deterministically.
    clusters = set()
    for name in sorted(manifest["files"]):
        parts = name.split("/")
        if len(parts) == 4 and parts[0] == "tools" and parts[-1] == "index.html" and parts[1] not in clusters:
            wanted.add(name)
            clusters.add(parts[1])
    return sorted(wanted & public_names)


def url_for(name):
    check_path(name)
    route = name[:-10] if name == "index.html" or name.endswith("/index.html") else name
    return ORIGIN + "/" + quote(route, safe="/")


def fetch_file(name, digest, timeout=20, opener=None):
    url = url_for(name)
    opener = opener or build_opener(NoRedirect())
    try:
        request = Request(url, headers={"User-Agent": "DigitalLabs-DeploymentCheck", "Cache-Control": "no-cache", "Accept-Encoding": "identity"})
        with opener.open(request, timeout=timeout) as response:
            if response.status != 200:
                raise ValidationError(f"HTTP {response.status}")
            raw = response.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                raise ValidationError("Antwort überschreitet 16 MiB.")
            mime = response.headers.get_content_type()
            if name.lower().endswith((".mjs", ".js")) and mime not in {"application/javascript", "text/javascript"}:
                raise ValidationError(f"JavaScript-MIME falsch: {mime}")
            if name.lower().endswith(".css") and mime != "text/css":
                raise ValidationError(f"CSS-MIME falsch: {mime}")
            if name.lower().endswith(".html") and mime != "text/html":
                raise ValidationError(f"HTML-MIME falsch: {mime}")
            if digest and hashlib.sha256(raw).hexdigest() != digest:
                raise ValidationError("Ausgelieferte Datei stimmt nicht mit dem erwarteten Release überein.")
            return {"file": name, "url": url, "status": "PASS", "http": 200, "bytes": len(raw), "mime": mime, "release_hash_checked": bool(digest)}
    except (OSError, URLError, HTTPError, HTTPException, ValidationError) as exc:
        return {"file": name, "url": url, "status": "FAIL", "error": str(exc)}


def expected_digests(manifest, root=None, portfolio_hashes=None):
    """Pin optional portfolio files to this checkout, not merely HTTP 200."""
    digests = dict(manifest["files"])
    if portfolio_hashes is not None:
        if root is not None:
            raise ValidationError("Nur eine Quelle für Portfolio-Prüfsummen ist erlaubt.")
        if not isinstance(portfolio_hashes, dict) or set(portfolio_hashes) != set(manifest['portfolioFiles']):
            raise ValidationError("Portfolio-Prüfsummen decken nicht genau die freigegebenen Dateien ab.")
        if any(not isinstance(value, str) or not HASH.fullmatch(value) for value in portfolio_hashes.values()):
            raise ValidationError("Ungültige Portfolio-Prüfsumme.")
        digests.update(portfolio_hashes)
    if root is not None:
        root = Path(root).resolve(strict=True)
        if not root.is_dir():
            raise ValidationError("Erwartetes Repository ist kein Verzeichnis.")
        for name in set(manifest["files"]) | set(manifest["portfolioFiles"]):
            raw = checked_file(root, name).read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if name in digests and digests[name] != digest:
                raise ValidationError(f"Lokale Datei passt nicht zum freigegebenen Release: {name}")
            digests[name] = digest
    return digests


def run_checks(manifest, *, all_files=False, root=None, portfolio_hashes=None, timeout=20, attempts=1,
               retry_delay=15, budget_seconds=300, fetcher=fetch_file, sleeper=time.sleep,
               clock=time.monotonic):
    if type(attempts) is not int or not 1 <= attempts <= 8:
        raise ValidationError("Versuche müssen zwischen 1 und 8 liegen.")
    if type(retry_delay) is not int or not 0 <= retry_delay <= 60:
        raise ValidationError("Wartezeit muss zwischen 0 und 60 Sekunden liegen.")
    if type(timeout) is not int or not 1 <= timeout <= 60:
        raise ValidationError("Timeout muss zwischen 1 und 60 Sekunden liegen.")
    if type(budget_seconds) is not int or not 1 <= budget_seconds <= 600:
        raise ValidationError("Gesamtzeitbudget muss zwischen 1 und 600 Sekunden liegen.")
    digests = expected_digests(manifest, root, portfolio_hashes)
    names = select_files(manifest, all_files)
    pending, by_name, history = list(names), {}, []
    started = clock()
    deadline = started + budget_seconds
    def bounded_fetch(name):
        remaining = deadline - clock()
        if remaining <= 0:
            return {"file": name, "url": url_for(name), "status": "FAIL", "requested": False,
                    "error": "Gesamtzeitbudget erreicht; kein weiterer Abruf gestartet."}
        return {**fetcher(name, digests.get(name), min(timeout, remaining)), "requested": True}
    for number in range(1, attempts + 1):
        with ThreadPoolExecutor(max_workers=6) as pool:
            batch = list(pool.map(bounded_fetch, pending))
        for result in batch:
            by_name[result["file"]] = {**result, "attempt": number}
        pending = [result["file"] for result in batch if result["status"] != "PASS"]
        history.append({"attempt": number, "requests": sum(result.get("requested", False) for result in batch), "failed": len(pending)})
        if not pending:
            break
        if number < attempts:
            remaining = deadline - clock()
            if remaining <= retry_delay:
                break
            sleeper(retry_delay)
    results = [by_name[name] for name in names]
    return {
        "status": "PASS" if not pending else "FAIL", "release": manifest["version"],
        "origin": ORIGIN, "mode": "all" if all_files else "sample",
        "files": len(results), "requests": sum(item["requests"] for item in history),
        "passed": sum(item["status"] == "PASS" for item in results),
        "hash_checked": sum(item.get("release_hash_checked", False) for item in results),
        "portfolio_hash_checked": root is not None or portfolio_hashes is not None, "attempts": history,
        "budget_seconds": budget_seconds, "elapsed_seconds": round(clock() - started, 3),
        "scope": "Öffentliche HTTP-Statuscodes, MIME-Typen und Release-Prüfsummen. " +
                 ("Portfolio-Dateien sind auf die Bytes des geprüften Checkouts festgelegt. " if root is not None or portfolio_hashes is not None else "Portfolio-Dateien werden nur auf HTTP-Erreichbarkeit geprüft. ") +
                 "Keine Indexierungsbestätigung und kein Hör- oder Gerätetest.",
        "results": results,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Öffentlich ausgelieferte Digital-Labs-Dateien nach dem Deployment prüfen.")
    parser.add_argument("--manifest", type=Path, default=Path(".github/digital-labs/deployment.json"))
    parser.add_argument("--all", action="store_true", help="Alle öffentlichen Dateien außer der Build-Steuerdatei .nojekyll statt einer Stichprobe abrufen.")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--expected-root", type=Path, help="Prüfsummen auch für Portfolio-Dateien aus diesem bereits geprüften Checkout übernehmen.")
    parser.add_argument("--attempts", type=int, default=1, help="Höchstens acht Versuche; erneut abgerufen werden ausschließlich noch fehlgeschlagene Dateien.")
    parser.add_argument("--retry-delay", type=int, default=15, help="Sekunden zwischen Versuchen (0–60).")
    parser.add_argument("--budget-seconds", type=int, default=300, help="Gesamtbudget für Abrufe und Wiederholungen (1–600 Sekunden); danach werden keine weiteren Requests gestartet.")
    args = parser.parse_args(argv)
    report_path = None
    try:
        report_path = checked_report_path(args.report, roots=(args.expected_root,), protected=(args.manifest,))
        if not 1 <= args.timeout <= 60:
            raise ValidationError("Timeout muss zwischen 1 und 60 Sekunden liegen.")
        manifest = load_manifest(args.manifest)
        report = run_checks(manifest, all_files=args.all, root=args.expected_root,
                            timeout=args.timeout, attempts=args.attempts, retry_delay=args.retry_delay,
                            budget_seconds=args.budget_seconds)
    except (OSError, ValueError) as exc:
        report = {"status": "FAIL", "error": str(exc), "requests": 0}
    if report_path:
        try:
            write_report(report_path, report, roots=(args.expected_root,), protected=(args.manifest,))
        except (OSError, ValueError) as exc:
            report = {**report, "status": "FAIL", "report_error": str(exc)}
    print(json.dumps({key: value for key, value in report.items() if key != "results"}, ensure_ascii=False, indent=2))
    for result in report.get("results", []):
        if result["status"] != "PASS":
            print("FAIL " + result["file"] + ": " + result.get("error", "Unbekannter Fehler"))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
