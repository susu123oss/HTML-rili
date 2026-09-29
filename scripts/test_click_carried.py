# -*- coding: utf-8 -*-
import asyncio
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)
        ctx = await b.new_context(viewport={'width': 1366, 'height': 850})
        pg = await ctx.new_page()

        console_logs = []
        pg.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        pg.on("pageerror", lambda err: console_logs.append(f"[PAGE_ERROR] {err}"))

        await pg.goto(BASE_URL)
        res = await pg.evaluate("""async () => {
            const r = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: 'admin', password: '0000' })
            });
            return r.json();
        }""")
        await pg.evaluate(f"localStorage.setItem('calendarToken', '{res['token']}')")
        await pg.reload()
        await pg.wait_for_selector('#serverSessionOverlay', state='hidden')
        await asyncio.sleep(2)

        # Check all day-memo-items on day 23
        day23_memos = await pg.evaluate("""() => {
            const items = Array.from(document.querySelectorAll(".calendar-day[data-date='2026-09-23'] .day-memo-item"));
            return items.map(el => ({
                id: el.dataset.memoId,
                text: el.innerText.trim(),
                html: el.outerHTML
            }));
        }""")
        print("Day 23 memos on DOM:", day23_memos)

        # Try clicking any item on day 23
        item = await pg.query_selector(".calendar-day[data-date='2026-09-23'] .day-memo-item:has-text('[结转]')")
        if not item:
            print("No [结转] item on day 23 yet! Let's check day 22 and hover carry it over...")
            # Click carryover on day 22 uncompleted memo
            day22_item = await pg.query_selector(".day-memo-item[data-memo-id='1181']")
            await day22_item.hover()
            await asyncio.sleep(0.5)
            carry_btn = await pg.query_selector("#memoHoverTooltip .mht-btn-carryover")
            print("carry_btn found:", carry_btn is not None)
            if carry_btn:
                await carry_btn.click()
                await asyncio.sleep(1.5)

            # Check day 23 again
            item = await pg.query_selector(".calendar-day[data-date='2026-09-23'] .day-memo-item:has-text('[结转]')")
            print("Now item with [结转] found on day 23:", item is not None)

        if item:
            print("Clicking the [结转] item...")
            await item.click()
            await asyncio.sleep(1)

            # Check if memoModal is active/visible
            modal_state = await pg.evaluate("""() => {
                const m = document.getElementById('memoModal');
                return {
                    hasActive: m ? m.classList.contains('active') : false,
                    display: m ? window.getComputedStyle(m).display : 'none',
                    visibility: m ? window.getComputedStyle(m).visibility : 'none',
                    opacity: m ? window.getComputedStyle(m).opacity : 'none',
                    title: document.getElementById('memoTitle') ? document.getElementById('memoTitle').value : '',
                    selectedMemoId: state.selectedMemoId
                };
            }""")
            print("Modal state after click:", modal_state)

        print("\nConsole logs during test:")
        for log in console_logs:
            print(log)

        await b.close()

if __name__ == "__main__":
    asyncio.run(main())
