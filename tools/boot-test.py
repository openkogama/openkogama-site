import asyncio
import json
import sys
import time

from playwright.async_api import async_playwright

SITE = "http://127.0.0.1:8092"
LIMIT = 540


async def boot(context, entry):
    page = await context.new_page()
    logs = []
    page.on("console", lambda message: logs.append(message.text[:300]))
    page.on("pageerror", lambda error: logs.append("pageerror " + str(error)[:300]))
    result = {"version": entry["version"], "id": entry["id"], "family": entry["family"], "unity": entry["unity"], "set": entry["set"]}
    start = time.time()
    try:
        await page.goto(f"{SITE}/play/?v={entry['id']}&mode=avatar&world=0", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        await page.click("#play")
        stage = "clicked"
        while time.time() - start < LIMIT:
            await page.wait_for_timeout(5000)
            error = await page.evaluate("document.getElementById('error')?.textContent || ''")
            if error:
                result["error"] = error
                break
            if await page.evaluate("document.getElementById('launch')?.hidden === true"):
                stage = "params"
            if any("peer 1: joined" in line for line in logs):
                stage = "joined"
            if any("world sent" in line or "synchronized" in line for line in logs):
                stage = "world"
                break
        result["stage"] = stage
    except Exception as error:
        result["error"] = str(error)[:300]
    result["seconds"] = round(time.time() - start)
    result["log"] = [line for line in logs if "rror" in line or "peer 1" in line or "ailed" in line][-25:]
    await page.close()
    return result


async def main(set_name, out):
    versions = json.load(open("site/versions.json"))
    seen, chosen = set(), []
    for entry in versions:
        if entry["set"] == set_name and entry["version"] not in seen:
            seen.add(entry["version"])
            chosen.append(entry)
    results = []
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context("/tmp/profile", headless=True, viewport={"width": 1100, "height": 700},
            args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for entry in chosen:
            result = await boot(context, entry)
            print(json.dumps({k: v for k, v in result.items() if k != "log"}), flush=True)
            results.append(result)
            json.dump(results, open(out, "w"), indent=1)
        await context.close()


asyncio.run(main(sys.argv[1], sys.argv[2]))
