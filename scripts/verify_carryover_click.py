# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_carryover_click_fix"

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
        ctx = await b.new_context(viewport={'width': 1366, 'height': 850})
        page = await ctx.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[PAGE_ERROR] {err}"))

        print("[1] Logging in as admin...")
        await login(page, 'admin', '0000')

        # Check tooltip style when idle
        tt_idle = await page.evaluate("""() => {
            const tt = document.getElementById('memoHoverTooltip');
            if (!tt) return null;
            const style = window.getComputedStyle(tt);
            return {
                pointerEvents: style.pointerEvents,
                visibility: style.visibility,
                opacity: style.opacity
            };
        }""")
        print("  -> Tooltip idle style:", tt_idle)
        assert tt_idle['pointerEvents'] == 'none', "Idle tooltip must have pointer-events: none"
        assert tt_idle['visibility'] == 'hidden', "Idle tooltip must have visibility: hidden"

        # Find or create a test memo to carry over
        print("[2] Creating an uncompleted memo on day 24 to test single carry-over...")
        test_memo = await page.evaluate("""async () => {
            const r = await fetch('/api/memos', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('calendarToken')
                },
                body: JSON.stringify({
                    date: '2026-09-24',
                    title: '测试待办-点转结测试',
                    content: '详细说明：测试点击转结事项是否能够正常弹出编辑备忘录弹窗',
                    color: '#6366f1',
                    completed: false,
                    dueTime: '2026-09-24T18:00:00'
                })
            });
            return r.json();
        }""")
        memo_id = test_memo.get('id')
        print("  -> Created memo ID:", memo_id)

        await page.reload(wait_until='domcontentloaded')
        try:
            await page.wait_for_selector("#serverSessionOverlay", state="hidden", timeout=8000)
        except Exception:
            pass
        await asyncio.sleep(2)

        # 1. Hover on the day 24 item
        print("[3] Hovering on test memo item on day 24...")
        memo_el = await page.query_selector(f".day-memo-item[data-memo-id='{memo_id}']")
        assert memo_el is not None, "Test memo item must exist on calendar"
        await memo_el.scroll_into_view_if_needed()
        await asyncio.sleep(0.5)
        await memo_el.hover()
        await asyncio.sleep(0.5)

        tt_hover = await page.evaluate("""() => {
            const tt = document.getElementById('memoHoverTooltip');
            const style = window.getComputedStyle(tt);
            return {
                visible: tt.classList.contains('visible'),
                pointerEvents: style.pointerEvents,
                visibility: style.visibility,
                datasetMemoId: tt.dataset.memoId
            };
        }""")
        print("  -> Tooltip hover style:", tt_hover)
        assert tt_hover['visible'] is True
        assert tt_hover['pointerEvents'] == 'auto'
        assert str(tt_hover['datasetMemoId']) == str(memo_id)

        await page.screenshot(path=os.path.join(OUTPUT_DIR, "01_hover_card_visible.png"))
        print("  -> Saved 01_hover_card_visible.png")

        # 2. Click "转到下一天"
        print("[4] Clicking '转到下一天' button on hover card...")
        carry_btn = await page.query_selector('#memoHoverTooltip .mht-btn-carryover')
        assert carry_btn is not None
        await carry_btn.click()
        await asyncio.sleep(2)

        # Verify tooltip is hidden immediately after carryover
        tt_after_carry = await page.evaluate("""() => {
            const tt = document.getElementById('memoHoverTooltip');
            const style = window.getComputedStyle(tt);
            return {
                visible: tt.classList.contains('visible'),
                pointerEvents: style.pointerEvents,
                visibility: style.visibility
            };
        }""")
        print("  -> Tooltip style immediately after carryover:", tt_after_carry)
        assert tt_after_carry['visible'] is False
        assert tt_after_carry['pointerEvents'] == 'none'

        await page.screenshot(path=os.path.join(OUTPUT_DIR, "02_calendar_after_carryover.png"))
        print("  -> Saved 02_calendar_after_carryover.png")

        # 3. Locate the carried-over item on day 25
        print("[5] Locating the carried-over item on day 25...")
        day25_carried = await page.query_selector(".calendar-day[data-date='2026-09-25'] .day-memo-item:has-text('[结转]')")
        assert day25_carried is not None, "Carried-over item must appear on day 25"

        # 4. Directly CLICK the carried-over item on day 25
        print("[6] Directly clicking the carried-over item on day 25...")
        await day25_carried.scroll_into_view_if_needed()
        await asyncio.sleep(0.3)
        await day25_carried.click()
        await asyncio.sleep(1)

        modal_info = await page.evaluate("""() => {
            const m = document.getElementById('memoModal');
            const style = m ? window.getComputedStyle(m) : null;
            const titleEl = m ? m.querySelector('.modal-title') : null;
            const titleInput = document.getElementById('memoTitle');
            const saveBtn = document.getElementById('saveMemo');
            return {
                isActive: m ? m.classList.contains('active') : false,
                display: style ? style.display : 'none',
                modalTitle: titleEl ? titleEl.innerText.trim() : '',
                memoTitleVal: titleInput ? titleInput.value : '',
                memoTitleReadonly: titleInput ? titleInput.readOnly : true,
                saveBtnDisplay: saveBtn ? saveBtn.style.display : 'none'
            };
        }""")
        print("  -> Modal info after clicking carried-over item:", modal_info)
        assert modal_info['isActive'] is True, "Modal must be active"
        assert modal_info['display'] == 'flex', "Modal must be displayed"
        assert '编辑备忘录' in modal_info['modalTitle'], f"Modal title should be 编辑备忘录, got {modal_info['modalTitle']}"
        assert '[结转]' in modal_info['memoTitleVal'], f"Title input should contain [结转], got {modal_info['memoTitleVal']}"

        await page.screenshot(path=os.path.join(OUTPUT_DIR, "03_edit_modal_opened_successfully.png"))
        print("  -> Saved 03_edit_modal_opened_successfully.png")

        # Close the modal
        print("[7] Closing modal and testing hover card click-to-edit...")
        await page.click('#cancelMemo')
        await asyncio.sleep(0.8)

        # 5. Now hover over day 25 carried item and click on the hover card body (e.g. meta)
        day25_carried = await page.query_selector(".calendar-day[data-date='2026-09-25'] .day-memo-item:has-text('[结转]')")
        await day25_carried.scroll_into_view_if_needed()
        await asyncio.sleep(0.3)
        await day25_carried.hover()
        await asyncio.sleep(0.5)

        # Click the hover tooltip card meta area
        meta_el = await page.query_selector('#memoHoverTooltip .mht-meta')
        assert meta_el is not None
        await meta_el.click()
        await asyncio.sleep(1)

        modal_info2 = await page.evaluate("""() => {
            const m = document.getElementById('memoModal');
            return {
                isActive: m ? m.classList.contains('active') : false,
                modalTitle: m ? m.querySelector('.modal-title')?.innerText.trim() : ''
            };
        }""")
        print("  -> Modal info after clicking hover card body:", modal_info2)
        assert modal_info2['isActive'] is True, "Modal must open when clicking hover card body"
        assert '编辑备忘录' in modal_info2['modalTitle']

        await page.screenshot(path=os.path.join(OUTPUT_DIR, "04_edit_modal_from_hover_card.png"))
        print("  -> Saved 04_edit_modal_from_hover_card.png")

        await ctx.close()
        await b.close()
        print("\nALL VERIFICATIONS PASSED 100%!")

if __name__ == '__main__':
    asyncio.run(run())
