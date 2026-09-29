# -*- coding: utf-8 -*-
import asyncio
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_FILE = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit\mobile_memo_modal_verified.png"

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
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        page = await ctx.new_page()
        await login(page, 'admin', '0000')

        # Open an existing memo directly via JS openMemoModal
        memos = await page.evaluate("() => state.memos")
        first_memo_id = memos[0]['id'] if memos else None
        if first_memo_id:
            await page.evaluate(f"() => openMemoModal('{first_memo_id}')")
        else:
            await page.evaluate("() => openMemoModal(null, new Date())")
        await asyncio.sleep(1)
        await page.screenshot(path=OUTPUT_FILE)
        await b.close()
    print('SUCCESS')

if __name__ == '__main__':
    asyncio.run(run())
