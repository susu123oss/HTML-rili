# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
AUDIT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit"
os.makedirs(AUDIT_DIR, exist_ok=True)

async def login(page):
    await page.goto(BASE_URL, wait_until='domcontentloaded')
    await asyncio.sleep(1)
    resp = await page.evaluate("""async () => {
        const r = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username: 'admin', password: '0000' })
        });
        return r.json();
    }""")
    token = resp.get('token')
    await page.evaluate(f"localStorage.setItem('calendarToken', '{token}')")
    await page.reload(wait_until='domcontentloaded')
    try:
        await page.wait_for_selector("#serverSessionOverlay", state="hidden", timeout=8000)
    except Exception:
        pass
    await asyncio.sleep(1.5)

async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)

        # 1. Desktop Test
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        page = await ctx.new_page()
        await login(page)

        # State 1: Expanded (default)
        await page.screenshot(path=os.path.join(AUDIT_DIR, "desktop_sidebar_expanded.png"))
        print("Captured desktop_sidebar_expanded.png")

        # State 2: Click toggle to Collapse
        await page.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(AUDIT_DIR, "desktop_sidebar_collapsed.png"))
        print("Captured desktop_sidebar_collapsed.png")

        # State 3: Click toggle to Re-expand
        await page.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(AUDIT_DIR, "desktop_sidebar_reexpanded.png"))
        print("Captured desktop_sidebar_reexpanded.png")
        await ctx.close()

        # 2. Mobile Test
        ctx_m = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        page_m = await ctx_m.new_page()
        await login(page_m)

        # Mobile Topbar with new icon
        await page_m.screenshot(path=os.path.join(AUDIT_DIR, "mobile_sidebar_icon.png"))
        print("Captured mobile_sidebar_icon.png")

        # Click to open mobile drawer
        await page_m.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await page_m.screenshot(path=os.path.join(AUDIT_DIR, "mobile_sidebar_drawer_open.png"))
        print("Captured mobile_sidebar_drawer_open.png")
        await ctx_m.close()

        await b.close()
    print("ALL VERIFICATIONS DONE!")

if __name__ == '__main__':
    asyncio.run(run())
