# -*- coding: utf-8 -*-
import asyncio
import pathlib
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
OUTPUT_DIR = pathlib.Path(r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)
        ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        page = await ctx.new_page()
        await page.goto('http://45.205.25.3:8090', wait_until='domcontentloaded')
        await asyncio.sleep(1)
        
        # Login
        resp = await page.evaluate("""async () => {
            const r = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: 'admin', password: '0000' })
            });
            return r.json();
        }""")
        token = resp.get('token')
        if not token:
            print("Login error:", resp)
            return
            
        await page.evaluate(f"localStorage.setItem('calendarToken', '{token}')")
        await page.reload(wait_until='domcontentloaded')
        await asyncio.sleep(2)
        
        # Capture current mobile view (closed sidebar)
        await page.screenshot(path=str(OUTPUT_DIR / 'mobile_before_fix_closed.png'))
        
        # Open sidebar
        await page.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await page.screenshot(path=str(OUTPUT_DIR / 'mobile_before_fix_sidebar_open.png'))
        
        # Scroll down slightly to see sticky header behavior
        await page.evaluate("window.scrollTo(0, 300)")
        await asyncio.sleep(0.5)
        await page.screenshot(path=str(OUTPUT_DIR / 'mobile_before_fix_scrolled.png'))
        
        await browser.close()
    print('SUCCESS')

if __name__ == '__main__':
    asyncio.run(main())
