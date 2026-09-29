# -*- coding: utf-8 -*-
import asyncio
import pathlib
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = pathlib.Path(r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit")
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
        # fallback to 0000
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
    await asyncio.sleep(2)

async def audit():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)

        # ----------------------------------------------------
        # 1. Desktop Audit (1920x1080)
        # ----------------------------------------------------
        dctx = await browser.new_context(viewport={'width': 1600, 'height': 960})
        page = await dctx.new_page()
        await login(page, 'admin', '0000')

        # D1: Main Calendar Top
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_1_calendar_top.png'))

        # D2: Main Calendar Scrolled (Days grid)
        await page.evaluate("window.scrollTo(0, 500)")
        await asyncio.sleep(0.5)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_2_calendar_grid.png'))

        # D3: Click a day cell to see Memo Modal
        first_day = page.locator(".calendar-day:not(.other-month)").first
        await first_day.click()
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_3_memo_modal.png'))
        await page.evaluate("() => { hideDialog('memoModal'); }")
        await asyncio.sleep(0.5)

        # D4: Weekly Plan Page
        await page.click('#navWeeklyPlan')
        await asyncio.sleep(1)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_4_weekly_plan.png'))

        # D5: Dashboard Page
        await page.click('#toolbarDashboard')
        await asyncio.sleep(1)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_5_dashboard.png'))

        # D6: Data Management Modal
        await page.click('#navCalendar')
        await asyncio.sleep(0.5)
        await page.click('#navDataManagement')
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_6_data_modal.png'))
        await page.evaluate("() => { hideDialog('functionsModal'); }")
        await asyncio.sleep(0.5)

        # D7: Reminder Modal
        await page.click('#floatingReminder')
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_7_reminder_modal.png'))
        await page.click('#closeReminderModal')
        await asyncio.sleep(0.5)

        # D8: Weekly Plan Summary & Report Dialogs
        await page.click('#navWeeklyPlan')
        await asyncio.sleep(0.8)
        await page.click('#wpPageGoalsBtn')
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_8_wp_summary_dialog.png'))
        await page.evaluate("() => { document.getElementById('wpSummaryDialog')?.close(); }")
        await asyncio.sleep(0.5)

        await page.click('#wpPageCopyReportBtn')
        await asyncio.sleep(0.8)
        await page.screenshot(path=str(OUTPUT_DIR / 'desktop_9_wp_report_dialog.png'))
        await page.evaluate("() => { document.getElementById('wpReportDialog')?.close(); }")
        await asyncio.sleep(0.5)

        await dctx.close()

        # ----------------------------------------------------
        # 2. Mobile Audit (390x844)
        # ----------------------------------------------------
        mctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        mpage = await mctx.new_page()
        await login(mpage, 'admin', '0000')

        # M1: Mobile Calendar Top
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_1_calendar_top.png'))

        # M2: Mobile Calendar Grid Scrolled
        await mpage.evaluate("window.scrollTo(0, 380)")
        await asyncio.sleep(0.5)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_2_calendar_grid.png'))

        # M3: Mobile Agenda at Bottom
        await mpage.evaluate("window.scrollTo(0, 900)")
        await asyncio.sleep(0.5)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_3_calendar_bottom.png'))

        # M4: Mobile Weekly Plan Page
        await mpage.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await mpage.click('#navWeeklyPlan')
        await asyncio.sleep(1)
        # explicitly close mobile sidebar if still open
        await mpage.evaluate("() => { document.getElementById('appSidebar')?.classList.remove('mobile-open'); document.getElementById('sidebarBackdrop')?.classList.remove('active'); }")
        await asyncio.sleep(0.5)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_4_weekly_plan.png'))

        # M5: Mobile Dashboard Page (closed drawer)
        await mpage.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await mpage.click('#toolbarDashboard')
        await asyncio.sleep(1)
        await mpage.evaluate("() => { document.getElementById('appSidebar')?.classList.remove('mobile-open'); document.getElementById('sidebarBackdrop')?.classList.remove('active'); }")
        await asyncio.sleep(0.5)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_5_dashboard.png'))

        # M6: Mobile Memo Modal
        await mpage.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await mpage.click('#navCalendar')
        await asyncio.sleep(0.8)
        await mpage.evaluate("() => { document.getElementById('appSidebar')?.classList.remove('mobile-open'); document.getElementById('sidebarBackdrop')?.classList.remove('active'); }")
        await asyncio.sleep(0.5)
        # Click today's cell to open modal or agenda add
        await mpage.click('#mobileAgendaAdd')
        await asyncio.sleep(0.8)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_6_memo_modal.png'))
        await mpage.evaluate("() => { hideDialog('memoModal'); }")
        await asyncio.sleep(0.5)

        # M7: Mobile Reminder Modal
        await mpage.click('#sidebarToggle')
        await asyncio.sleep(0.5)
        await mpage.click('#floatingReminder')
        await asyncio.sleep(0.8)
        await mpage.screenshot(path=str(OUTPUT_DIR / 'mobile_7_reminder_modal.png'))

        await mctx.close()
        await browser.close()
    print("AUDIT CAPTURES COMPLETE!")

if __name__ == '__main__':
    asyncio.run(audit())
