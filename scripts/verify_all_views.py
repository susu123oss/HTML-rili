# -*- coding: utf-8 -*-
import asyncio
import pathlib
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = pathlib.Path(r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416")

async def login(page, username, password):
    await page.goto(BASE_URL, wait_until='domcontentloaded')
    await asyncio.sleep(1)
    resp = await page.evaluate(f"""async () => {{
        const r = await fetch('/api/auth/login', {{
            method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{ username: '{username}', password: '{password}' }})
        }});
        return r.json();
    }}""")
    token = resp.get('token')
    if not token:
        raise Exception(f"Login failed: {resp}")
    await page.evaluate(f"localStorage.setItem('calendarToken', '{token}')")
    await page.reload(wait_until='domcontentloaded')
    # Wait for loading overlays to completely disappear
    try:
        await page.wait_for_selector("#serverSessionOverlay", state="hidden", timeout=10000)
    except Exception:
        pass
    await asyncio.sleep(2)
    return resp.get('user')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)
        
        # 1. Desktop Admin View
        print("[1] Verifying Desktop Admin View...")
        desktop_ctx = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = await desktop_ctx.new_page()
        await login(page, 'admin', '0000')
        await page.screenshot(path=str(OUTPUT_DIR / 'verified_desktop_admin.png'))
        print("Captured verified_desktop_admin.png")
        await desktop_ctx.close()

        # 2. Mobile Admin View (Light mode)
        print("[2] Verifying Mobile Admin View (Light)...")
        mobile_ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        page = await mobile_ctx.new_page()
        await login(page, 'admin', '0000')
        await page.screenshot(path=str(OUTPUT_DIR / 'verified_mobile_admin_light.png'))
        print("Captured verified_mobile_admin_light.png")

        # 3. Mobile Admin Sidebar Open (with backdrop)
        print("[3] Verifying Mobile Admin Sidebar Open...")
        await page.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await page.screenshot(path=str(OUTPUT_DIR / 'verified_mobile_sidebar_open.png'))
        print("Captured verified_mobile_sidebar_open.png")

        # 4. Mobile Dark Mode
        print("[4] Verifying Mobile Admin View (Dark)...")
        # Close sidebar by clicking close button
        await page.click('#sidebarCloseBtn')
        await asyncio.sleep(0.5)
        await page.evaluate("() => { if (typeof applyTheme === 'function') applyTheme('dark'); else document.documentElement.setAttribute('data-theme', 'dark'); }")
        await asyncio.sleep(1)
        await page.screenshot(path=str(OUTPUT_DIR / 'verified_mobile_admin_dark.png'))
        print("Captured verified_mobile_admin_dark.png")
        await mobile_ctx.close()

        # 5. Mobile Staff View (孔致镔)
        print("[5] Verifying Mobile Staff View...")
        staff_ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        page = await staff_ctx.new_page()
        await login(page, '孔致镔', '0000')
        await page.screenshot(path=str(OUTPUT_DIR / 'verified_mobile_staff_light.png'))
        print("Captured verified_mobile_staff_light.png")

        # Open staff sidebar
        await page.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await page.screenshot(path=str(OUTPUT_DIR / 'verified_mobile_staff_sidebar.png'))
        print("Captured verified_mobile_staff_sidebar.png")
        await staff_ctx.close()

        await browser.close()
    print("ALL 5 VERIFICATIONS COMPLETED SUCCESSFULLY!")

if __name__ == '__main__':
    asyncio.run(main())
