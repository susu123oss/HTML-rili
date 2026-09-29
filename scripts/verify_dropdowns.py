# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
AUDIT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit"
os.makedirs(AUDIT_DIR, exist_ok=True)

async def login(page, username="admin", password="0000"):
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
    await page.evaluate(f"localStorage.setItem('calendarToken', '{token}')")
    await page.reload(wait_until='domcontentloaded')
    try:
        await page.wait_for_selector("#serverSessionOverlay", state="hidden", timeout=8000)
    except Exception:
        pass
    await asyncio.sleep(2)

async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)

        # 1. Desktop Test
        print("Testing Desktop Dropdowns...")
        ctx_desktop = await b.new_context(viewport={'width': 1280, 'height': 800})
        page = await ctx_desktop.new_page()
        await login(page, 'admin', '0000')

        # Click Member Dropdown
        await page.click('#customMemberBtn')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(AUDIT_DIR, "desktop_member_dropdown.png"))
        print("Saved desktop_member_dropdown.png")

        # Click Month Dropdown
        await page.click('#customMonthBtn')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(AUDIT_DIR, "desktop_month_dropdown.png"))
        print("Saved desktop_month_dropdown.png")
        await ctx_desktop.close()

        # 2. Mobile Test
        print("Testing Mobile Dropdowns...")
        ctx_mobile = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        page_m = await ctx_mobile.new_page()
        await login(page_m, 'admin', '0000')

        # Mobile Member Dropdown
        await page_m.click('#customMemberBtn')
        await asyncio.sleep(0.5)
        await page_m.screenshot(path=os.path.join(AUDIT_DIR, "mobile_member_dropdown.png"))
        print("Saved mobile_member_dropdown.png")

        # Mobile Month Dropdown
        await page_m.click('#customMonthBtn')
        await asyncio.sleep(0.5)
        await page_m.screenshot(path=os.path.join(AUDIT_DIR, "mobile_month_dropdown.png"))
        print("Saved mobile_month_dropdown.png")
        await ctx_mobile.close()

        await b.close()
    print("ALL VERIFICATIONS COMPLETED!")

if __name__ == '__main__':
    asyncio.run(run())
