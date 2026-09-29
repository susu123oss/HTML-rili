# -*- coding: utf-8 -*-
import asyncio
import pathlib
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = pathlib.Path(r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_phases_verified")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

async def login(page):
    await page.goto(BASE_URL, wait_until='domcontentloaded')
    await asyncio.sleep(1)
    resp = await page.evaluate('''async () => {
        const r = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username: 'admin', password: '000' })
        });
        return r.json();
    }''')
    token = resp.get('token')
    if not token:
        resp = await page.evaluate('''async () => {
            const r = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: 'admin', password: '0000' })
            });
            return r.json();
        }''')
        token = resp.get('token')
    await page.evaluate(f"localStorage.setItem('calendarToken', '{token}')")
    await page.reload(wait_until='domcontentloaded')
    try:
        await page.wait_for_selector("#serverSessionOverlay", state="hidden", timeout=8000)
    except Exception:
        pass
    await asyncio.sleep(2)

async def test_and_capture():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)

        # -----------------------------------------------------------------
        # 1. Desktop Mode (1500 x 920)
        # -----------------------------------------------------------------
        dctx = await browser.new_context(viewport={'width': 1500, 'height': 920})
        page = await dctx.new_page()
        await login(page)

        # 1.1 Desktop Light - Calendar & Leaderboard Folded
        await page.evaluate("() => { if (typeof applyTheme === 'function') applyTheme('light'); }")
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_1_light_calendar_podium.png'))

        # 1.2 Click Leaderboard Expand
        toggle_btn = page.locator('#btnToggleLeaderboard')
        if await toggle_btn.count() > 0:
            await toggle_btn.click()
            await asyncio.sleep(0.5)
            await page.screenshot(path=str(OUTPUT_DIR / 'desktop_2_light_leaderboard_expanded.png'))
            # Fold it back
            await toggle_btn.click()
            await asyncio.sleep(0.5)

        # 1.3 Desktop Light - Memo Modal
        await page.evaluate("() => openMemoModal(null, new Date())")
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_3_light_memo_modal.png'))
        await page.click('#closeMemoModal')
        await asyncio.sleep(0.5)

        # 1.4 Desktop Dark Mode Activation
        await page.evaluate("() => { if (typeof applyTheme === 'function') applyTheme('dark'); }")
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_4_dark_calendar_podium.png'))

        # 1.5 Desktop Dark - Functions Modal (Data Management)
        await page.click('#navDataManagement')
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_5_dark_functions_modal.png'))
        await page.click('#closeFunctionsModal')
        await asyncio.sleep(0.5)

        # 1.6 Desktop Dark - Memo Modal
        await page.evaluate("() => openMemoModal(null, new Date())")
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_6_dark_memo_modal.png'))
        await page.click('#closeMemoModal')
        await asyncio.sleep(0.5)

        # 1.7 Desktop Dark - Weekly Plan
        await page.click('#navWeeklyPlan')
        await asyncio.sleep(1)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_7_dark_weekly_plan.png'))

        await dctx.close()

        # -----------------------------------------------------------------
        # 2. Mobile Mode (390 x 844)
        # -----------------------------------------------------------------
        mctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        mpage = await mctx.new_page()
        await login(mpage)

        # 2.1 Mobile Light - Calendar with FAB
        await mpage.evaluate("() => { if (typeof applyTheme === 'function') applyTheme('light'); }")
        await asyncio.sleep(0.8)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_1_light_calendar_fab.png'))

        # 2.2 Mobile Light - Bottom Sheet Memo Modal triggered by FAB
        await mpage.click('#mobileFabAdd')
        await asyncio.sleep(0.8)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_2_light_bottom_sheet_modal.png'))
        await mpage.click('#closeMemoModal')
        await asyncio.sleep(0.5)

        # 2.3 Mobile Dark Mode
        await mpage.evaluate("() => { if (typeof applyTheme === 'function') applyTheme('dark'); }")
        await asyncio.sleep(0.8)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_3_dark_calendar_fab.png'))

        # 2.4 Mobile Dark - Bottom Sheet Memo Modal
        await mpage.click('#mobileFabAdd')
        await asyncio.sleep(0.8)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_4_dark_bottom_sheet_modal.png'))
        await mpage.click('#closeMemoModal')
        await asyncio.sleep(0.5)

        # 2.5 Mobile Dark - Weekly Plan
        await mpage.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await mpage.click('#navWeeklyPlan')
        await asyncio.sleep(1)
        await mpage.evaluate("() => { document.getElementById('appSidebar')?.classList.remove('mobile-open'); document.getElementById('sidebarBackdrop')?.classList.remove('active'); }")
        await asyncio.sleep(0.5)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_5_dark_weekly_plan.png'))

        await mctx.close()
        await browser.close()
    print("VERIFICATION SCREENSHOTS SAVED SUCCESSFULLY!")

if __name__ == '__main__':
    asyncio.run(test_and_capture())
