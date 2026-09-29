# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_carryover_v4"
os.makedirs(OUTPUT_DIR, exist_ok=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)
        context = await browser.new_context(viewport={'width': 1366, 'height': 850})
        page = await context.new_page()

        # Catch native dialogs
        dialogs = []
        page.on("dialog", lambda dialog: (dialogs.append(dialog.message), asyncio.create_task(dialog.accept())))

        print("1. Opening page and logging in as admin...")
        await page.goto(BASE_URL, wait_until='domcontentloaded')
        await asyncio.sleep(1)

        resp = await page.evaluate("""async () => {
            const r = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: 'admin', password: '0000' })
            });
            return r.json();
        }""")
        token = resp.get('token')
        await page.evaluate(f"localStorage.setItem('calendarToken', '{token}')")
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_selector("#serverSessionOverlay", state="hidden", timeout=8000)
        await asyncio.sleep(2)

        # 1. Verify topbar button removal
        quick_carry = await page.query_selector("#btnQuickCarryoverToday")
        print("Topbar btnQuickCarryoverToday exists:", quick_carry is not None)
        assert quick_carry is None, "btnQuickCarryoverToday should NOT exist in topbar!"

        # 2. Check completed item hover tooltip (e.g. memo 1182)
        print("2. Checking completed memo hover tooltip (MUST NOT have carryover button)...")
        completed_memo = await page.query_selector(".day-memo-item[data-memo-id='1182']")
        if completed_memo:
            await completed_memo.hover()
            await asyncio.sleep(0.5)
            await page.screenshot(path=os.path.join(OUTPUT_DIR, "01_hover_completed_no_carryover_btn.png"))
            btn_carry = await page.query_selector("#memoHoverTooltip .mht-btn-carryover")
            print("Completed item hover has carryover btn:", btn_carry is not None)
            assert btn_carry is None, "Completed memo hover tooltip MUST NOT have carryover button!"
        
        # 3. Check in-progress item hover tooltip (memo 1181)
        print("3. Checking in-progress memo hover tooltip (MUST have '转到下一天' button)...")
        uncompleted_memo = await page.query_selector(".day-memo-item[data-memo-id='1181']")
        assert uncompleted_memo is not None, "Memo 1181 must exist!"
        await uncompleted_memo.hover()
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "02_hover_uncompleted_with_carryover_btn.png"))
        
        btn_carry = await page.query_selector("#memoHoverTooltip .mht-btn-carryover")
        print("Uncompleted item hover has carryover btn:", btn_carry is not None)
        assert btn_carry is not None, "Uncompleted memo hover tooltip MUST have carryover button!"
        
        # 4. Click '转到下一天' on uncompleted item
        print("4. Clicking '转到下一天' on uncompleted item...")
        await btn_carry.click()
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "03_carryover_toast_feedback_no_popups.png"))
        await asyncio.sleep(2)

        # 5. Check native dialogs count
        print("Native dialogs caught during carryover:", dialogs)
        assert len(dialogs) == 0, f"Expected 0 native dialogs, but got: {dialogs}"

        # 6. Check daily detail modal footer
        print("5. Checking daily detail modal footer...")
        await page.click(".calendar-day[data-date='2026-09-22'] .day-number")
        await asyncio.sleep(1)
        daily_carry = await page.query_selector("#btnDailyCarryover")
        print("Daily modal btnDailyCarryover exists:", daily_carry is not None)
        assert daily_carry is None, "btnDailyCarryover should NOT exist in daily modal footer!"

        await page.screenshot(path=os.path.join(OUTPUT_DIR, "04_daily_detail_modal_clean_footer.png"))

        # 7. Check memo edit dialog
        print("6. Opening memo modal from calendar day click...")
        await page.click("#closeDailyDetailModalBtn")
        await asyncio.sleep(0.5)
        # Click on an empty day e.g. 2026-09-30
        await page.click(".calendar-day[data-date='2026-09-30']")
        await asyncio.sleep(1)
        chip_carry = await page.query_selector("#btnCarryoverYesterday")
        print("Template chip btnCarryoverYesterday exists:", chip_carry is not None)
        assert chip_carry is None, "btnCarryoverYesterday should NOT exist in memo template chips!"

        await page.screenshot(path=os.path.join(OUTPUT_DIR, "05_memo_modal_clean_template_chips.png"))

        print("\n✔✔✔ ALL 7 VERIFICATIONS PASSED PERFECTLY! ✔✔✔")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
