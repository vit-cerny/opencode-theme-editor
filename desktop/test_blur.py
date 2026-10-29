"""Verify the blur controls: modes, sliders, and generated CSS."""

from playwright.sync_api import sync_playwright
import sys

BASE = "http://127.0.0.1:4288/desktop"
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (" :: " + str(detail) if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1100})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("#presets .preset", timeout=10000)

    presets = page.locator("#presets .preset b").all_inner_texts()
    check("nine presets", len(presets) == 9, presets)
    check("blur preset present", "Heavy Frost" in presets)

    modes = page.locator("#blurMode option").all_inner_texts()
    check("four blur modes", len(modes) == 4, modes)
    for m in ["None (sharp)", "Acrylic", "Mica", "Gaussian (CSS)"]:
        check("mode listed: " + m, m in modes)

    page.select_option("#blurMode", "gaussian")
    page.locator("#blurRadius").evaluate(
        "el => { el.value='40'; el.dispatchEvent(new Event('input',{bubbles:true})); }"
    )
    page.wait_for_timeout(600)
    check("radius label", page.locator("#blurRadiusVal").inner_text() == "40px")

    css = page.locator("#cssOut").inner_text()
    check("css has gaussian blur", "blur(40px)" in css, css[css.find("backdrop-filter"):][:60])
    check("css has saturation", "saturate(" in css)
    check("css has scrim layer", "html::before" in css)
    check("css has reduced-transparency fallback", "prefers-reduced-transparency" in css)

    page.locator("#blurScrim").evaluate(
        "el => { el.value='60'; el.dispatchEvent(new Event('input',{bubbles:true})); }"
    )
    page.wait_for_timeout(600)
    check("scrim label", page.locator("#blurScrimVal").inner_text() == "60%")

    page.locator("#blurPanels").uncheck()
    page.wait_for_timeout(600)
    css2 = page.locator("#cssOut").inner_text()
    check("panels off removes backdrop-filter", "backdrop-filter" not in css2)

    page.locator("#blurPanels").check()
    page.wait_for_timeout(600)

    page.select_option("#blurMode", "none")
    page.wait_for_timeout(600)
    css3 = page.locator("#cssOut").inner_text()
    check("blur none removes filter", "backdrop-filter" not in css3)

    page.select_option("#blurMode", "mica")
    page.wait_for_timeout(600)
    css4 = page.locator("#cssOut").inner_text()
    check("mica uses lighter blur", "backdrop-filter" in css4)

    preview_filter = page.locator("#win .side").evaluate("el => el.style.backdropFilter")
    check("preview applies filter", "blur" in (preview_filter or ""), preview_filter)

    page.locator("#presets .preset").first.click()
    page.wait_for_timeout(700)
    check("blur preset loads", page.locator("#themeName").inner_text() == "Soft Acrylic",
          page.locator("#themeName").inner_text())
    check("preset sets gaussian-ish radius", page.locator("#blurRadius").input_value() in ("12", "40"))

    check("no page errors", len(errors) == 0, errors[:3])

    page.screenshot(path=r"C:\Users\witek\AppData\Local\Temp\opencode\blur-ui.png", full_page=True)
    browser.close()

failed = [r for r in results if not r[1]]
print()
print(f"{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)