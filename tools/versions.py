import json
import re
import struct
import sys
import urllib.request
import zlib
from pathlib import Path

SERVER = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"C:/Users/nightus/source/repos/openkogama-server")
SITE = Path(__file__).resolve().parent.parent / "site"
SOURCE = "https://cdn.openkogama.org/webgl.json"
NEWEST_UNSUPPORTED = (3, 6, 0)
LEGACY_SET = "2015"


def family(unity):
    major, minor = unity.split(".")[:2]
    if major == "5":
        return {"2": "5.2", "3": "5.3"}.get(minor, "5.6")
    if major in ("2017", "2018", "2019", "2020"):
        return "2018"
    if major in ("2021", "2022", "6000"):
        return "2021"
    return None


def key(version):
    return tuple(int(part) for part in version.split("."))


def engine(unity):
    major, minor = unity.split(".")[:2]
    return "5" if int(major) < 2017 else f"{major}.{minor}"


def bundle_set(version, bundles, unity):
    if version in bundles["builds"]:
        return bundles["builds"][version]
    reached = [entry["set"] for entry in bundles["ranges"] if key(version) >= key(entry["from"])]
    chosen = reached[-1] if reached else None
    engines = bundles.get("engines", {})
    wanted = engine(unity)
    if chosen is None or engines.get(chosen, "5") == wanted:
        return chosen
    matching = sorted((name for name in bundles["sets"] if engines.get(name, "5") == wanted), key=lambda name: int(name.lstrip("v")))
    if not matching:
        return chosen
    return next((name for name in reversed(reached) if name in matching), matching[-1])


def fetch(url, start=None, end=None):
    headers = {"User-Agent": "openkogama-site"}
    if start is not None:
        headers["Range"] = f"bytes={start}-{end}" if end is not None else f"bytes={start}"
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60).read()


def product_version(url):
    tail = fetch(url, "-65536")
    at = tail.find(b"PK\x01\x02")
    while at >= 0:
        size = struct.unpack("<H", tail[at + 28:at + 30])[0]
        if tail[at + 46:at + 46 + size] == b"index.html":
            method, = struct.unpack("<H", tail[at + 10:at + 12])
            packed, = struct.unpack("<I", tail[at + 20:at + 24])
            offset, = struct.unpack("<I", tail[at + 42:at + 46])
            head = fetch(url, offset, offset + 30 + 1024 + packed)
            skip = 30 + sum(struct.unpack("<HH", head[26:30]))
            raw = head[skip:skip + packed]
            page = raw if method == 0 else zlib.decompress(raw, -15)
            found = re.search(rb'productVersion:\s*"([\d.]+)"', page)
            return found.group(1).decode() if found else ""
        at = tail.find(b"PK\x01\x02", at + 46)
    return ""


request = urllib.request.Request(SOURCE, headers={"User-Agent": "openkogama-site"})
builds = json.load(urllib.request.urlopen(request))["versions"]
bundles = json.loads((SERVER / "data" / "streaming" / "bundles.json").read_text(encoding="utf-8-sig"))

versions = []
for build in sorted(builds, key=lambda build: build["timestamp"], reverse=True):
    kind = family(build["unityVersion"])
    if kind and not build["version"]:
        build["version"] = product_version(build["urls"][0])
    if not kind or not build["version"] or key(build["version"]) >= NEWEST_UNSUPPORTED:
        continue
    chosen = bundle_set(build["version"], bundles, build["unityVersion"])
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
