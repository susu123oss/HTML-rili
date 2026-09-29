# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_calendar_highlight"

async def login_api(page, username, password):
    resp = await page.evaluate(f"""async () => {{
        const r = await fetch('/api/auth/login', {{
            method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{ username: '{username}', password: '{password}' }})
        }});
        return r.json();
    }}""")
    token = resp.get('token')
    user = resp.get('user')
    return token, user

async def run():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)
        ctx = await b.new_context(viewport={'width': 1680, 'height': 950})
        page = await ctx.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[PAGE_ERROR] {err}"))

        await page.goto(BASE_URL, wait_until='domcontentloaded')
        await asyncio.sleep(1)

        # 1. Admin logs in
        print("[1] Admin logging in...")
        admin_token, _ = await login_api(page, 'admin', '0000')

        # Find target employee (user id 17 or any staff)
        staff_res = await page.evaluate(f"""async () => {{
            const r = await fetch('/api/users', {{ headers: {{ 'Authorization': 'Bearer {admin_token}' }} }});
            return r.json();
        }}""")
        employees = [u for u in staff_res.get('users', []) if u.get('role') != 'admin']
        target_emp = employees[0]
        print(f"  Target employee: {target_emp.get('displayName')} ({target_emp.get('username')})")

        # Employee creates a memo on 2026-09-02 (matching user's context)
        emp_token, _ = await login_api(page, target_emp['username'], '0000')
        memo_res = await page.evaluate(f"""async () => {{
            const r = await fetch('/api/memos', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer {emp_token}'
                }},
                body: JSON.stringify({{
                    title: 'w8电池组结构设计-日历定位高亮测试',
                    content: '测试点击顶部横幅后自动定位到日历并高亮闪烁几下',
                    date: '2026-09-02',
                    category: '工作',
                    type: '工作',
                    priority: 'high',
                    status: '待办',
                    completed: false
                }})
            }});
            return r.json();
        }}""")
        test_memo_id = memo_res.get('id') or (memo_res.get('memo') or {}).get('id')
        print(f"  Created test memo #{test_memo_id} on 2026-09-02")

        # Admin likes and reviews this memo
        await page.evaluate(f"""async () => {{
            await fetch('/api/memos/{test_memo_id}/react', {{
                method: 'POST',
                headers: {{ 'Content-Type': 'application/json', 'Authorization': 'Bearer {admin_token}' }},
                body: JSON.stringify({{ action: 'toggle-like' }})
            }});
            await fetch('/api/memos/{test_memo_id}/react', {{
                method: 'POST',
                headers: {{ 'Content-Type': 'application/json', 'Authorization': 'Bearer {admin_token}' }},
                body: JSON.stringify({{ action: 'toggle-read' }})
            }});
        }}""")
        print("  Admin toggled like + review successfully")

        # 2. Login as employee in browser
        print("[2] Employee logging in...")
        await page.evaluate(f"""() => {{
            localStorage.setItem('calendarToken', '{emp_token}');
            localStorage.setItem('calendarMonthCount', '1');
        }}""")
        await page.reload(wait_until='domcontentloaded')
        try:
            await page.wait_for_selector("#serverSessionOverlay", state="hidden", timeout=8000)
        except Exception:
            pass
        await asyncio.sleep(2)

        # Trigger notification check
        await page.evaluate("""async () => {
            if (typeof checkEngineerNotifications === 'function') {
                await checkEngineerNotifications();
            }
        }""")
        await asyncio.sleep(1)

        banner_text = await page.evaluate("document.getElementById('engineerUrgeBanner')?.innerText")
        print("  Banner Text:", repr(banner_text))
        assert "点击日历定位" in banner_text, f"Banner text must contain '点击日历定位', got: {banner_text}"

        # Screenshot: Banner showing with '点击日历定位'
        shot1 = os.path.join(OUTPUT_DIR, "01_banner_with_calendar_locate_hint.png")
        await page.screenshot(path=shot1)
        print(f"  Saved screenshot 1: {shot1}")

        # 3. Click the top banner!
        print("[3] Clicking Top Banner to trigger calendar navigation and pulse highlight...")
        await page.click('#engineerUrgeBanner')
        # Wait for highlight class to apply
        highlight_el = await page.wait_for_selector(f'.day-memo-item[data-memo-id="{test_memo_id}"].memo-praise-highlight', timeout=8000)
        assert highlight_el is not None, "Target memo must have received memo-praise-highlight class!"

        highlight_check = await page.evaluate(f"""() => {{
            const btn = document.querySelector('.day-memo-item[data-memo-id="{test_memo_id}"]');
            const dayCell = btn ? btn.closest('.calendar-day') : null;
            const memoModal = document.getElementById('memoModal');
            return {{
                hasBtn: !!btn,
                hasHighlightClass: btn ? btn.classList.contains('memo-praise-highlight') : false,
                hasDayGlowClass: dayCell ? dayCell.classList.contains('calendar-day-praise-flash') : false,
                memoModalOpen: memoModal ? memoModal.classList.contains('active') : false
            }};
        }}""")
        print("  Highlight Check Result:", highlight_check)
        assert highlight_check['hasBtn'] == True, "The target memo element must exist on the calendar"
        assert highlight_check['hasHighlightClass'] == True, "The target memo element must have memo-praise-highlight class"
        assert highlight_check['memoModalOpen'] == False, "Memo modal MUST NOT be opened (direct calendar immersion)"

        # Screenshot: Calendar glowing with highlighted memo!
        shot2 = os.path.join(OUTPUT_DIR, "02_calendar_memo_praise_pulse_highlight.png")
        await page.screenshot(path=shot2)
        print(f"  Saved screenshot 2: {shot2}")

        # Wait a little to capture mid-pulse
        await asyncio.sleep(0.8)
        shot3 = os.path.join(OUTPUT_DIR, "03_calendar_memo_pulsing_close_view.png")
        await page.screenshot(path=shot3)
        print(f"  Saved screenshot 3: {shot3}")

        # 4. Clean up test memo
        await page.evaluate(f"""async () => {{
            await fetch('/api/memos/{test_memo_id}', {{
                method: 'DELETE',
                headers: {{ 'Authorization': 'Bearer {emp_token}' }}
            }});
        }}""")
        print("  Cleaned up test memo.")

        await b.close()
        print("\nAll calendar highlight & navigation assertions PASSED!")

if __name__ == '__main__':
    asyncio.run(run())
