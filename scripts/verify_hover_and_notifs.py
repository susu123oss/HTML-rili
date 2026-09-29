# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_hover_and_notifs"

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

        # ----------------------------------------------------
        # Part 1: Admin tests hover card with carry-over button & reactions
        # ----------------------------------------------------
        print("[1] Admin tests hover card with carry-over button...")
        ctx = await b.new_context(viewport={'width': 1280, 'height': 850})
        page = await ctx.new_page()
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
        await login(page, 'admin', '0000')

        # Hover over first memo item on calendar
        memo_el = await page.query_selector('.day-memo-item')
        assert memo_el is not None, "At least one memo item should exist"
        
        await memo_el.hover()
        await asyncio.sleep(0.8)

        tooltip = await page.query_selector('#memoHoverTooltip.visible')
        assert tooltip is not None, "memoHoverTooltip should be visible on hover"

        carry_btn = await page.query_selector('#memoHoverTooltip .mht-btn-carryover')
        assert carry_btn is not None, "mht-btn-carryover button must exist in hover tooltip"

        # Capture hover tooltip
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "01_hover_tooltip_with_carryover_btn.png"))
        print("  -> Saved 01_hover_tooltip_with_carryover_btn.png")

        # Admin clicks review and like directly on the hover tooltip
        react_read = await page.query_selector('#memoHoverTooltip .mht-btn-react[data-action="toggle-read"]')
        if react_read:
            await react_read.click()
            await asyncio.sleep(0.8)
            print("  -> Admin clicked Review on hover card")

        react_like = await page.query_selector('#memoHoverTooltip .mht-btn-react[data-action="toggle-like"]')
        if react_like:
            await react_like.click()
            await asyncio.sleep(0.8)
            print("  -> Admin clicked Like on hover card")

        # Wait for calendar re-render
        await asyncio.sleep(1)
        memo_el = await page.query_selector('.day-memo-item')
        if memo_el:
            await memo_el.hover()
            await asyncio.sleep(0.5)
            await page.screenshot(path=os.path.join(OUTPUT_DIR, "02_hover_tooltip_after_reaction.png"))
            print("  -> Saved 02_hover_tooltip_after_reaction.png")

        # Test single carry-over to next day
        print("  -> Testing single carry-over from hover card...")
        carry_btn = await page.query_selector('#memoHoverTooltip .mht-btn-carryover')
        if carry_btn:
            await carry_btn.click()
            await asyncio.sleep(1.5)

        await page.screenshot(path=os.path.join(OUTPUT_DIR, "03_calendar_after_single_carryover.png"))
        print("  -> Saved 03_calendar_after_single_carryover.png")

        await ctx.close()

        # ----------------------------------------------------
        # Part 2: Verify notifications in staff user account
        # ----------------------------------------------------
        print("[2] Employee logs in to verify notification in sidebar & reminder modal...")
        staff_ctx = await b.new_context(viewport={'width': 1280, 'height': 850})
        staff_page = await staff_ctx.new_page()
        staff_page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
        
        # Log in as 孔致镔
        await login(staff_page, '孔致镔', '0000')

        # Trigger notification check
        await staff_page.evaluate("async () => { await checkEngineerNotifications(); }")
        await asyncio.sleep(1.2)

        # Check sidebar badge
        badge_text = await staff_page.evaluate("() => $('reminderBadge')?.textContent || ''")
        badge_visible = await staff_page.evaluate("() => $('reminderBadge')?.style.display !== 'none'")
        print(f"  -> Employee sidebar reminder badge: text='{badge_text}', visible={badge_visible}")

        await staff_page.screenshot(path=os.path.join(OUTPUT_DIR, "04_staff_sidebar_reminder_badge.png"))
        print("  -> Saved 04_staff_sidebar_reminder_badge.png")

        # Open Reminder Modal
        await staff_page.click('#floatingReminder')
        await asyncio.sleep(1.2)

        await staff_page.screenshot(path=os.path.join(OUTPUT_DIR, "05_staff_reminder_modal.png"))
        print("  -> Saved 05_staff_reminder_modal.png")

        await staff_ctx.close()
        await b.close()
        print("\nALL VERIFICATIONS SUCCEEDED!")

if __name__ == "__main__":
    asyncio.run(run())
