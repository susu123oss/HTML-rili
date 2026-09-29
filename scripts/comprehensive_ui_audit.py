# -*- coding: utf-8 -*-
import asyncio
import pathlib
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = pathlib.Path(r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_comprehensive")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

async def login(page, username="admin", password="000"):
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
        resp = await page.evaluate(f"""async () => {{
            const r = await fetch('/api/auth/login', {{
                method: 'POST',
                headers: {{'Content-Type': 'application/json'}},
                body: JSON.stringify({{ username: '{username}', password: '0000' }})
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
    await asyncio.sleep(1.5)

async def set_theme(page, theme='light'):
    await page.evaluate(f"""(theme) => {{
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        const icon = document.querySelector('#themeToggle i');
        if (icon) {{
            icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }}
    }}""", theme)
    await asyncio.sleep(0.5)

async def run_audit():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)

        # =========================================================
        # 1. Desktop Light Mode
        # =========================================================
        dctx = await browser.new_context(viewport={'width': 1500, 'height': 900})
        page = await dctx.new_page()
        await login(page, 'admin', '0000')
        await set_theme(page, 'light')

        # 1.1 Desktop Light - Calendar View
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_light_calendar.png'))

        # 1.2 Desktop Light - Weekly Plan
        await page.click('#navWeeklyPlan')
        await asyncio.sleep(1)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_light_weekly_plan.png'))

        # 1.3 Desktop Light - Memo Modal
        await page.click('#navCalendar')
        await asyncio.sleep(0.8)
        first_day = page.locator(".calendar-day:not(.other-month)").first
        await first_day.click()
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_light_memo_modal.png'))
        await page.evaluate("() => { hideDialog('memoModal'); }")
        await asyncio.sleep(0.5)

        # 1.4 Desktop Light - Data Management
        await page.click('#navDataManagement')
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_light_data_modal.png'))
        await page.evaluate("() => { hideDialog('functionsModal'); }")
        await asyncio.sleep(0.5)

        # =========================================================
        # 2. Desktop Dark Mode
        # =========================================================
        await set_theme(page, 'dark')

        # 2.1 Desktop Dark - Calendar View
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_dark_calendar.png'))

        # 2.2 Desktop Dark - Weekly Plan
        await page.click('#navWeeklyPlan')
        await asyncio.sleep(1)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_dark_weekly_plan.png'))

        # 2.3 Desktop Dark - Memo Modal
        await page.click('#navCalendar')
        await asyncio.sleep(0.8)
        first_day = page.locator(".calendar-day:not(.other-month)").first
        await first_day.click()
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_dark_memo_modal.png'))
        await page.evaluate("() => { hideDialog('memoModal'); }")
        await asyncio.sleep(0.5)

        # 2.4 Desktop Dark - Data Management
        await page.click('#navDataManagement')
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_dark_data_modal.png'))
        await page.evaluate("() => { hideDialog('functionsModal'); }")
        await asyncio.sleep(0.5)

        await dctx.close()

        # =========================================================
        # 3. Mobile Light Mode (390x844)
        # =========================================================
        mctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        mpage = await mctx.new_page()
        await login(mpage, 'admin', '0000')
        await set_theme(mpage, 'light')

        # 3.1 Mobile Light - Calendar
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_light_calendar.png'))

        # 3.2 Mobile Light - Drawer
        await mpage.click('#sidebarToggle')
        await asyncio.sleep(0.6)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_light_drawer.png'))

        # 3.3 Mobile Light - Weekly Plan
        await mpage.click('#navWeeklyPlan')
        await asyncio.sleep(1)
        await mpage.evaluate("() => { document.getElementById('appSidebar')?.classList.remove('mobile-open'); document.getElementById('sidebarBackdrop')?.classList.remove('active'); }")
        await asyncio.sleep(0.5)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_light_weekly_plan.png'))

        # 3.4 Mobile Light - Memo Modal
        await mpage.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await mpage.click('#navCalendar')
        await asyncio.sleep(0.8)
        await mpage.evaluate("() => { document.getElementById('appSidebar')?.classList.remove('mobile-open'); document.getElementById('sidebarBackdrop')?.classList.remove('active'); }")
        await asyncio.sleep(0.5)
        await mpage.evaluate("() => { if (typeof showMemoModal === 'function') showMemoModal(); else document.getElementById('mobileAgendaAdd')?.click(); }")
        await asyncio.sleep(0.8)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_light_memo_modal.png'))
        await mpage.evaluate("() => { hideDialog('memoModal'); }")
        await asyncio.sleep(0.5)

        # =========================================================
        # 4. Mobile Dark Mode
        # =========================================================
        await set_theme(mpage, 'dark')

        # 4.1 Mobile Dark - Calendar
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_dark_calendar.png'))

        # 4.2 Mobile Dark - Drawer
        await mpage.click('#sidebarToggle')
        await asyncio.sleep(0.6)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_dark_drawer.png'))

        # 4.3 Mobile Dark - Weekly Plan
        await mpage.click('#navWeeklyPlan')
        await asyncio.sleep(1)
        await mpage.evaluate("() => { document.getElementById('appSidebar')?.classList.remove('mobile-open'); document.getElementById('sidebarBackdrop')?.classList.remove('active'); }")
        await asyncio.sleep(0.5)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_dark_weekly_plan.png'))

        # 4.4 Mobile Dark - Memo Modal
        await mpage.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await mpage.click('#navCalendar')
        await asyncio.sleep(0.8)
        await mpage.evaluate("() => { document.getElementById('appSidebar')?.classList.remove('mobile-open'); document.getElementById('sidebarBackdrop')?.classList.remove('active'); }")
        await asyncio.sleep(0.5)
        await mpage.evaluate("() => { if (typeof showMemoModal === 'function') showMemoModal(); else document.getElementById('mobileAgendaAdd')?.click(); }")
        await asyncio.sleep(0.8)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_dark_memo_modal.png'))
        await mpage.evaluate("() => { hideDialog('memoModal'); }")
        await asyncio.sleep(0.5)

        await mctx.close()
        await browser.close()
    print("COMPREHENSIVE AUDIT FINISHED!")

if __name__ == '__main__':
    asyncio.run(run_audit())
