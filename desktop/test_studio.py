"""Verify the rebuilt studio UI: preview, view switch, transparency and blur."""

from playwright.sync_api import sync_playwright
import sys

BASE = "http://127.0.0.1:4288/desktop"
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (" :: " + str(detail) if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1680, "height": 1080})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("#presets .preset", timeout=10000)

    check("title", page.title() == "OpenCode Theme Studio", page.title())
    check("nine presets", page.locator("#presets .preset").count() == 9)
    check("fifteen colors", page.locator("#colors .swatch").count() == 15)

    check("preview visible on load", page.locator("#wall").is_visible())
    check("css view hidden on load", not page.locator("#view-css").is_visible())

    page.locator('[data-view="css"]').click()
    check("css view shows", page.locator("#view-css").is_visible())
    check("preview hides", not page.locator("#view-preview").is_visible())
    page.locator('[data-view="wall"]').click()
    check("back to preview", page.locator("#wall").is_visible())

    page.locator('[data-view="checker"]').click()
    has_checker = page.locator("#wall").evaluate("el => el.classList.contains('checker')")
    check("alpha checker toggles", has_checker is True)

    page.select_option("#mode", "transparent")
    page.select_option("#blurMode", "gaussian")
    page.locator("#blurRadius").evaluate("el => { el.value='32'; el.dispatchEvent(new Event('input',{bubbles:true})); }")
    page.wait_for_timeout(700)

    root_bg = page.locator("#win").evaluate("el => getComputedStyle(el).getPropertyValue('--t-root').trim()")
    check("root is transparent, not painted", root_bg == "transparent", root_bg)

    filter_val = page.locator("#win").evaluate("el => getComputedStyle(el).getPropertyValue('--t-filter').trim()")
    check("preview filter uses radius", "blur(32px)" in filter_val, filter_val)

    side_filter = page.locator("#win .side").evaluate("el => getComputedStyle(el).backdropFilter")
    check("side panel frosted", "blur(32px)" in (side_filter or ""), side_filter)

    card_filter = page.locator("#win .cards .c").first.evaluate("el => getComputedStyle(el).backdropFilter")
    check("cards frosted", "blur(32px)" in (card_filter or ""), card_filter)

    win_bg = page.locator("#win").evaluate("el => getComputedStyle(el).backgroundColor")
    check("window fully transparent", win_bg in ("rgba(0, 0, 0, 0)", "transparent"), win_bg)

    summary = page.locator("#blurSummary").inner_text()
    check("blur summary reflects state", "gaussian" in summary and "32px" in summary, summary)

    css = page.locator("#cssOut").inner_text()
    check("css root transparent", "background: transparent !important" in css)
    check("css keeps user panel colour", "rgba(10, 51, 72" in css or "rgba(5, 31, 48" in css)
    check("css has gaussian", "blur(32px)" in css)

    page.select_option("#mode", "opaque")
    page.wait_for_timeout(700)
    root_opaque = page.locator("#win").evaluate("el => getComputedStyle(el).getPropertyValue('--t-root').trim()")
    check("opaque mode paints root", root_opaque.startswith("rgba("), root_opaque)

    page.select_option("#mode", "acrylic")
    page.wait_for_timeout(500)
    page.locator("#presets .preset").nth(1).click()
    page.wait_for_timeout(800)
    check("preset applies", page.locator("#themeName").inner_text() == "Heavy Frost",
          page.locator("#themeName").inner_text())

    page.locator("#btnReset").click()
    page.wait_for_timeout(600)
    check("reset works", page.locator("#themeName").inner_text() == "Heavy Frost")

    check("no page errors", len(errors) == 0, errors[:3])

    page.screenshot(path=r"C:\Users\witek\AppData\Local\Temp\opencode\studio.png", full_page=True)
    browser.close()

failed = [r for r in results if not r[1]]
print()
print(f"{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)