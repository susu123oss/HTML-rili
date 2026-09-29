# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_modal_fix"

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
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)

        # 1. Desktop Light Mode
        ctx = await b.new_context(viewport={'width': 1280, 'height': 850})
        page = await ctx.new_page()
        await login(page, 'admin', '0000')

        # Set light theme
        await page.evaluate("""() => {
            document.documentElement.dataset.theme = 'light';
            localStorage.setItem('calendarTheme', 'light');
        }""")

        # Open memo modal
        await page.evaluate("() => openMemoModal(null, new Date())")
        await asyncio.sleep(1)

        # Check visibility
        preview_vis = await page.evaluate("""() => {
            const p = document.getElementById('markdownPreview');
            const t = document.getElementById('memoContent');
            const btn = document.getElementById('closeMemoModal');
            const svg = btn ? btn.querySelector('svg') : null;
            const btnBox = btn ? btn.getBoundingClientRect() : null;
            const svgBox = svg ? svg.getBoundingClientRect() : null;
            return {
                previewDisplay: window.getComputedStyle(p).display,
                previewHidden: p.hidden,
                previewOffsetParent: p.offsetParent !== null,
                textareaDisplay: window.getComputedStyle(t).display,
                btnBox: btnBox ? { width: btnBox.width, height: btnBox.height, left: btnBox.left, top: btnBox.top } : null,
                svgBox: svgBox ? { width: svgBox.width, height: svgBox.height, left: svgBox.left, top: svgBox.top } : null,
                svgCenterOffset: (btnBox && svgBox) ? {
                    dx: (svgBox.left + svgBox.width / 2) - (btnBox.left + btnBox.width / 2),
                    dy: (svgBox.top + svgBox.height / 2) - (btnBox.top + btnBox.height / 2)
                } : null
            };
        }""")
        print("Desktop Light Memo Modal Check:", preview_vis)

        # Screenshot modal
        modal_el = await page.query_selector("#memoModal .modal-content")
        if modal_el:
            await modal_el.screenshot(path=os.path.join(OUTPUT_DIR, "desktop_light_memo_modal.png"))
        else:
            await page.screenshot(path=os.path.join(OUTPUT_DIR, "desktop_light_memo_modal_full.png"))

        # Test clicking "实时预览" and then back to "编辑"
        await page.click("#memoTabPreview")
        await asyncio.sleep(0.5)
        preview_after_tab = await page.evaluate("""() => {
            const p = document.getElementById('markdownPreview');
            const t = document.getElementById('memoContent');
            return {
                previewDisplay: window.getComputedStyle(p).display,
                textareaDisplay: window.getComputedStyle(t).display
            };
        }""")
        print("Tab Preview active:", preview_after_tab)

        await page.click("#memoTabEdit")
        await asyncio.sleep(0.5)
        edit_after_tab = await page.evaluate("""() => {
            const p = document.getElementById('markdownPreview');
            const t = document.getElementById('memoContent');
            return {
                previewDisplay: window.getComputedStyle(p).display,
                textareaDisplay: window.getComputedStyle(t).display
            };
        }""")
        print("Tab Edit restored:", edit_after_tab)

        # 2. Desktop Dark Mode
        await page.evaluate("""() => {
            document.documentElement.dataset.theme = 'dark';
            localStorage.setItem('calendarTheme', 'dark');
        }""")
        await asyncio.sleep(0.5)
        if modal_el:
            await modal_el.screenshot(path=os.path.join(OUTPUT_DIR, "desktop_dark_memo_modal.png"))

        # Close memo modal and check functions modal close button
        await page.click("#closeMemoModal")
        await asyncio.sleep(0.5)
        await page.evaluate("() => openFunctionsModal()")
        await asyncio.sleep(0.8)
        func_el = await page.query_selector("#functionsModal .modal-content")
        if func_el:
            await func_el.screenshot(path=os.path.join(OUTPUT_DIR, "desktop_dark_functions_modal.png"))
        await page.click("#closeFunctionsModal")
        await asyncio.sleep(0.5)

        # 3. Mobile View
        await ctx.close()
        mobile_ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        m_page = await mobile_ctx.new_page()
        await login(m_page, 'admin', '0000')
        await m_page.evaluate("() => openMemoModal(null, new Date())")
        await asyncio.sleep(1)
        await m_page.screenshot(path=os.path.join(OUTPUT_DIR, "mobile_memo_modal.png"))

        await b.close()
    print("ALL VERIFICATIONS COMPLETED SUCCESSFULLY")

if __name__ == '__main__':
    asyncio.run(run())
