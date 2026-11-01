import hashlib
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ElementTree
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "site" / "plugins.json"
WORK = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build"
REPO = "openkogama/openkogama-site"
SOURCE = re.compile(r"https://github\.com/([^/]+)/([^/]+?)(?:/tree/([^/]+)(?:/(.+?))?)?/?$")
SERVER = ("openkogama", "openkogama-server")


def setting(project, name):
    for element in ElementTree.parse(project).getroot().iter(name):
        if element.text and element.text.strip():
            return element.text.strip()
    return None


def checkout(owner, repo, ref):
    target = WORK / repo
    if not target.exists():
        branch = ["--branch", ref] if ref else []
        subprocess.run(["git", "clone", "--quiet", "--depth", "1", *branch, f"https://github.com/{owner}/{repo}", str(target)], check=True)
    return target


def commit(folder):
    return subprocess.run(["git", "-C", str(folder), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()


plugins = json.loads(CATALOG.read_text(encoding="utf-8"))
sources = {plugin["id"]: SOURCE.match(plugin["source"]).groups() for plugin in plugins}
server = checkout(*SERVER, next((ref for owner, repo, ref, _ in sources.values() if (owner, repo) == SERVER), None))
api = ".".join(setting(server / "api" / "openkogama-api.csproj", "Version").split(".")[:2])
published = 0

for plugin in plugins:
    owner, repo, ref, path = sources[plugin["id"]]
    folder = checkout(owner, repo, ref)
    project = next((folder / (path or "")).glob("*.csproj"))
    version = setting(project, "Version") or "1.0.0"
    if any(entry["version"] == version for entry in plugin["versions"]):
        continue
    subprocess.run(["dotnet", "build", str(project), "-c", "Release", "--nologo", "-v", "quiet"], check=True)
    dll = project.parent / "bin" / "Release" / setting(project, "TargetFramework") / f"{setting(project, 'AssemblyName') or project.stem}.dll"
    tag = f"{plugin['id']}-{version}"
    built = f"https://github.com/{owner}/{repo}/tree/{commit(folder)}" + (f"/{path}" if path else "")
    subprocess.run(["gh", "release", "create", tag, str(dll), "--repo", REPO, "--title", f"{plugin['name']} {version}", "--notes", f"Built from {built}"], check=True)
    data = dll.read_bytes()
    plugin["versions"].insert(0, {
        "version": version,
        "api": api,
        "file": f"https://github.com/{REPO}/releases/download/{tag}/{dll.name}",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    })
    published += 1

CATALOG.write_text(json.dumps(plugins, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(published, "published")
