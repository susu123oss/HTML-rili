# -*- coding: utf-8 -*-
import asyncio
import os
import pathlib
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = pathlib.Path(r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416")

async def login_via_api(page, username, password):
    await page.goto(BASE_URL, wait_until="networkidle")
    resp = await page.evaluate(f"""async () => {{
        const r = await fetch('/api/auth/login', {{
            method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{ username: '{username}', password: '{password}' }})
        }});
        return r.json();
    }}""")
    token = resp.get("token")
    if not token:
        raise Exception(f"Login failed: {resp}")
    await page.evaluate(f"localStorage.setItem('calendarToken', '{token}')")
    await page.reload(wait_until="networkidle")
    await asyncio.sleep(2)
    return resp.get("user")

async def run_verification():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)

        # ----------------------------------------------------
        # 1. Staff Test (孔致镔)
        # ----------------------------------------------------
        context = await browser.new_context(viewport={'width': 1440, 'height': 900})
        page = await context.new_page()

        print("[1] Logging in as staff 孔致镔 via API...")
        user = await login_via_api(page, "孔致镔", "0000")
        print("Logged in successfully:", user.get("displayName") or user.get("username"))

        # 1. Verify and capture the new button in the monthly calendar card header
        print("[2] Capturing calendar header with new button...")
        header_btn = page.locator(".calendar-weekly-plan-btn").first
        await header_btn.wait_for(state="visible", timeout=10000)
        await page.screenshot(path=str(OUTPUT_DIR / "live_page_calendar_header_btn.png"))
        print("Captured live_page_calendar_header_btn.png")

        # 2. Click button to enter Weekly Plan Page
        print("[3] Clicking 周计划与周报 button to enter workspace...")
        await header_btn.click()
        await page.wait_for_selector("#weeklyPlanPage:not([hidden])", timeout=10000)
        await asyncio.sleep(1)

        # 3. Add a plan under Wednesday
        print("[4] Adding a plan on Wednesday...")
        wed_col = page.locator(".wp-day-column").nth(2) # Monday=0, Tuesday=1, Wednesday=2
        wed_input = wed_col.locator(".wp-day-input")
        await wed_input.fill("【攻坚】完成工作台独立全屏重构上线")
        await wed_input.press("Enter")
        await asyncio.sleep(2)

        # 4. Capture staff view
        await page.screenshot(path=str(OUTPUT_DIR / "live_page_weekly_workspace_staff.png"))
        print("Captured live_page_weekly_workspace_staff.png")

        # 5. Switch to dark theme
        print("[5] Switching to dark theme...")
        await page.evaluate("() => { if (typeof applyTheme === 'function') applyTheme('dark'); else document.documentElement.setAttribute('data-theme', 'dark'); }")
        await asyncio.sleep(1)
        await page.screenshot(path=str(OUTPUT_DIR / "live_page_weekly_workspace_dark.png"))
        print("Captured live_page_weekly_workspace_dark.png")
        await page.evaluate("() => { if (typeof applyTheme === 'function') applyTheme('light'); else document.documentElement.setAttribute('data-theme', 'light'); }")

        # 6. Test Back to Calendar
        print("[6] Testing '返回月历' button...")
        await page.click("#wpBackToCalendar")
        await page.wait_for_selector(".calendar-container:not([hidden])", timeout=10000)
        print("Successfully returned to calendar.")

        await context.close()

        # ----------------------------------------------------
        # 2. Mobile View Test (孔致镔)
        # ----------------------------------------------------
        print("[7] Testing Mobile View (390x844)...")
        mobile_context = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        mobile_page = await mobile_context.new_page()
        await login_via_api(mobile_page, "孔致镔", "0000")

        mobile_btn = mobile_page.locator(".calendar-weekly-plan-btn").first
        await mobile_btn.click()
        await mobile_page.wait_for_selector("#weeklyPlanPage:not([hidden])", timeout=10000)
        await asyncio.sleep(1)
        await mobile_page.screenshot(path=str(OUTPUT_DIR / "live_page_weekly_workspace_mobile.png"))
        print("Captured live_page_weekly_workspace_mobile.png")
        await mobile_context.close()

        # ----------------------------------------------------
        # 3. Admin Team View Test (admin)
        # ----------------------------------------------------
        print("[8] Logging in as admin to test Team Planner View...")
        admin_context = await browser.new_context(viewport={'width': 1440, 'height': 900})
        admin_page = await admin_context.new_page()
        await login_via_api(admin_page, "admin", "0000")

        admin_btn = admin_page.locator(".calendar-weekly-plan-btn").first
        await admin_btn.click()
        await admin_page.wait_for_selector("#weeklyPlanPage:not([hidden])", timeout=10000)
        await admin_page.wait_for_selector("#wpPageViewTeamBtn", timeout=10000)
        await admin_page.click("#wpPageViewTeamBtn")
        await asyncio.sleep(1.5)
        await admin_page.screenshot(path=str(OUTPUT_DIR / "live_page_weekly_workspace_admin_team.png"))
        print("Captured live_page_weekly_workspace_admin_team.png")
        await admin_context.close()

        await browser.close()
        print("All verification steps completed successfully!")

if __name__ == "__main__":
    asyncio.run(run_verification())
