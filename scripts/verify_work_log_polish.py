# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_work_log_polish"

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

        ctx = await b.new_context(viewport={'width': 1280, 'height': 850})
        page = await ctx.new_page()
        await login(page, 'admin', '0000')

        # Set light theme
        await page.evaluate("""() => {
            document.documentElement.dataset.theme = 'light';
            localStorage.setItem('calendarTheme', 'light');
        }""")
        await asyncio.sleep(0.5)

        # 1. Test Memo Modal & Quick Templates
        print("[1] Testing Memo Modal & Quick Templates...")
        await page.evaluate("() => openMemoModal(null, new Date())")
        await asyncio.sleep(1)

        # Click "⚡ 研发日志" template button
        await page.click('button[data-tpl="dev"]')
        await asyncio.sleep(0.5)
        await page.fill('#memoTitle', '日常研发进度与联调测试')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "01_memo_modal_templates_dev.png"))
        print("  -> Saved 01_memo_modal_templates_dev.png")

        # 2. Test Carry-over button
        print("[2] Testing Carry-over from Yesterday...")
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
        await page.click('#btnCarryoverYesterday')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "02_memo_modal_carryover.png"))
        print("  -> Saved 02_memo_modal_carryover.png")

        # Close memo modal cleanly
        await page.evaluate("() => closeMemoModal()")
        await asyncio.sleep(0.8)

        # 3. Test Topbar Quick Weekly Report
        print("[3] Testing Topbar Quick Weekly Report...")
        await page.click('#btnQuickWeeklyReport')
        await asyncio.sleep(1.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "03_topbar_quick_weekly_report.png"))
        print("  -> Saved 03_topbar_quick_weekly_report.png")

        # Close weekly report dialog
        await page.evaluate("() => document.getElementById('wpReportDialog')?.close()")
        await asyncio.sleep(0.8)

        # 4. Find date with memos & test Daily Detail Modal & Reaction Stamps
        print("[4] Testing Daily Detail Modal & Reactions...")
        date_with_memos = await page.evaluate("""() => {
            const memos = state.memos || [];
            if (memos.length > 0) return memos[0].date;
            return '2026-09-28';
        }""")
        print(f"  Target date for daily detail: {date_with_memos}")
        await page.evaluate(f"() => openDailyDetailModal('{date_with_memos}')")
        await asyncio.sleep(1.2)

        # Click reaction buttons: "审阅" and "点赞"
        read_btn = await page.query_selector('.task-btn-react[data-action="toggle-read"]')
        if read_btn:
            await read_btn.click()
            await asyncio.sleep(0.6)
        like_btn = await page.query_selector('.task-btn-react[data-action="toggle-like"]')
        if like_btn:
            await like_btn.click()
            await asyncio.sleep(0.6)

        await page.screenshot(path=os.path.join(OUTPUT_DIR, "04_daily_detail_review_reactions.png"))
        print("  -> Saved 04_daily_detail_review_reactions.png")

        # Close daily detail modal
        await page.evaluate("() => closeDailyDetailModal()")
        await asyncio.sleep(0.8)

        # 5. Test Dark Theme
        print("[5] Testing Dark Theme...")
        await page.evaluate("""() => {
            document.documentElement.dataset.theme = 'dark';
            localStorage.setItem('calendarTheme', 'dark');
        }""")
        await asyncio.sleep(0.5)

        # Open memo modal in dark mode
        await page.evaluate("() => openMemoModal(null, new Date())")
        await asyncio.sleep(1)
        await page.click('button[data-tpl="meeting"]')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "05_memo_modal_dark.png"))
        print("  -> Saved 05_memo_modal_dark.png")
        await page.evaluate("() => closeMemoModal()")
        await asyncio.sleep(0.8)

        # Open daily detail modal in dark mode
        await page.evaluate(f"() => openDailyDetailModal('{date_with_memos}')")
        await asyncio.sleep(1.2)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "06_daily_detail_dark.png"))
        print("  -> Saved 06_daily_detail_dark.png")
        await page.evaluate("() => closeDailyDetailModal()")

        await b.close()
        print("All verification steps completed successfully!")

if __name__ == "__main__":
    asyncio.run(run())
