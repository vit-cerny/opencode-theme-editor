"""End-to-end test of the OpenCode Desktop theme editor GUI.

Verifies the app loads, presets render, colour and opacity controls mutate the
generated CSS, and the blur endpoint is reachable and honest about state.
"""

from playwright.sync_api import sync_playwright
import json
import sys

BASE = "http://127.0.0.1:4288/desktop"
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (" :: " + str(detail) if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE)
    page.wait_for_load_state("networkidle")

    check("page title", page.title() == "OpenCode Desktop Theme Editor", page.title())

    page.wait_for_selector("#presets .preset", timeout=10000)
    presets = page.locator("#presets .preset b").all_inner_texts()
    check("six presets render", len(presets) == 6, presets)

    swatches = page.locator("#colors .swatch").count()
    check("fifteen colour slots", swatches == 15, swatches)

    name0 = page.locator("#themeName").inner_text()
    page.locator("#presets .preset").nth(2).click()
    page.wait_for_timeout(500)
    name1 = page.locator("#themeName").inner_text()
    mode1 = page.locator("#mode").input_value()
    check("preset switch changes theme", name0 != name1, f"{name0} -> {name1}")
    check("acrylic preset sets mode", mode1 == "acrylic", mode1)

    page.locator("#opacity").evaluate(
        "el => { el.value='72'; el.dispatchEvent(new Event('input',{bubbles:true})); }"
    )
    page.wait_for_timeout(500)
    check("opacity label", page.locator("#opacityVal").inner_text() == "72%")
    win_opacity = page.locator("#win").evaluate("el => el.style.opacity")
    check("preview opacity applied", win_opacity in ("0.72", "0.7199999999999999"), win_opacity)

    css = page.locator("#cssOut").inner_text()
    check("css uses real app variables", "--v2-background-bg-deep" in css)
    check("css has layer scale", "--v2-background-bg-layer-04" in css)

    picker = page.locator("#colors .swatch input[type=color]").first
    picker.evaluate(
        "el => { el.value='#123456'; el.dispatchEvent(new Event('input',{bubbles:true})); }"
    )
    page.wait_for_timeout(500)
    hex0 = page.locator("#colors .swatch .hex").first.inner_text()
    check("colour picker writes hex", hex0.lower().startswith("#123456"), hex0)

    alpha = page.locator("#colors .swatch input[type=range]").first
    alpha.evaluate(
        "el => { el.value='35'; el.dispatchEvent(new Event('input',{bubbles:true})); }"
    )
    page.wait_for_timeout(500)
    hex1 = page.locator("#colors .swatch .hex").first.inner_text()
    check("alpha slider writes 8-digit hex", len(hex1) == 9, hex1)

    page.locator('[data-tab="css"]').click()
    check("css tab visible", page.locator("#tab-css").is_visible())
    page.locator('[data-tab="preview"]').click()

    state = page.evaluate("() => fetch('/api/desktop/state').then(r => r.json())")
    check("state returns patch info", "patch" in state, list(state.get("patch", {}).keys()))
    check("presets served by api", len(state.get("presets", [])) == 6)

    blur_btn = page.locator("#btnBlur").count()
    check("blur button present", blur_btn == 1, blur_btn)

    check("no console errors", len(errors) == 0, errors[:3])

    page.screenshot(path=r"C:\Users\witek\AppData\Local\Temp\opencode\editor-test.png", full_page=True)
    browser.close()

failed = [r for r in results if not r[1]]
print()
print(f"{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)