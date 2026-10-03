import json
import sys
import urllib.request
from pathlib import Path

SERVER = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"C:/Users/nightus/source/repos/openkogama-server")
SITE = Path(__file__).resolve().parent.parent / "site"
SOURCE = "https://cdn.openkogama.org/webgl.json"
NEWEST_UNSUPPORTED = (2, 30, 12)
LEGACY_SET = "2015"


def family(unity):
    major, minor = unity.split(".")[:2]
    if major == "5":
        return {"2": "5.2", "3": "5.3"}.get(minor, "5.6")
    if major in ("2017", "2018", "2019", "2020"):
        return "2018"
    return None


def key(version):
    return tuple(int(part) for part in version.split("."))


def bundle_set(version, bundles):
    if version in bundles["builds"]:
        return bundles["builds"][version]
    chosen = None
    for entry in bundles["ranges"]:
        if key(version) >= key(entry["from"]):
            chosen = entry["set"]
    return chosen


request = urllib.request.Request(SOURCE, headers={"User-Agent": "openkogama-site"})
builds = json.load(urllib.request.urlopen(request))["versions"]
bundles = json.loads((SERVER / "data" / "streaming" / "bundles.json").read_text(encoding="utf-8-sig"))

versions = []
for build in sorted(builds, key=lambda build: build["timestamp"], reverse=True):
    kind = family(build["unityVersion"])
    if not kind or not build["version"] or key(build["version"]) >= NEWEST_UNSUPPORTED:
        continue
    chosen = bundle_set(build["version"], bundles)
    versions.append({
        "id": build["id"],
        "version": build["version"],
        "unity": build["unityVersion"],
        "family": kind,
        "time": build["timestamp"],
        "size": build["zipSize"],
        "url": build["urls"][0],
        "set": (chosen or LEGACY_SET) + "-webgl",
    })

(SITE / "versions.json").write_text(json.dumps(versions, separators=(",", ":")), encoding="utf-8")
print(len(versions), "versions")
