# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_notify_segregation"

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
        ctx = await b.new_context(viewport={'width': 1366, 'height': 850})
        page = await ctx.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[PAGE_ERROR] {err}"))

        await page.goto(BASE_URL, wait_until='domcontentloaded')
        await asyncio.sleep(1)

        # 1. First login as admin to find an employee's memo and like/review it
        print("[1] Logging in as admin to find/toggle like/review on employee memo...")
        admin_token, admin_user = await login_api(page, 'admin', '0000')
        print(f"  Admin logged in: {admin_user.get('displayName')}")

        # Fetch staff members
        staff_res = await page.evaluate(f"""async () => {{
            const r = await fetch('/api/users', {{
                headers: {{ 'Authorization': 'Bearer {admin_token}' }}
            }});
            return r.json();
        }}""")
        employees = [u for u in staff_res.get('users', []) if u.get('role') != 'admin']
        target_emp = employees[0] if employees else None
        print(f"  Target employee: {target_emp.get('username')} ({target_emp.get('displayName')}, id={target_emp.get('id')})")

        # Create or find a memo owned by target employee
        emp_token, _ = await login_api(page, target_emp['username'], '0000')
        memo_res = await page.evaluate(f"""async () => {{
            const r = await fetch('/api/memos', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer {emp_token}'
                }},
                body: JSON.stringify({{
                    title: '测试通知隔离与横幅展现事项',
                    content: '测试审阅点赞通知不在提醒中心显示而在顶部横幅提醒展现',
                    date: '2026-09-29',
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
        print(f"  Created test memo #{test_memo_id} for employee {target_emp['username']}")

        # Admin toggles like and review to generate notifications
        await page.evaluate(f"""async () => {{
            const r1 = await fetch('/api/memos/{test_memo_id}/react', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer {admin_token}'
                }},
                body: JSON.stringify({{ action: 'toggle-like' }})
            }});
            const r2 = await fetch('/api/memos/{test_memo_id}/react', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer {admin_token}'
                }},
                body: JSON.stringify({{ action: 'toggle-read' }})
            }});
            console.log('React API results:', await r1.json(), await r2.json());
        }}""")
        print("  Admin toggled like + review successfully")

        # 2. Now login as the employee in the browser page
        print("[2] Logging in as employee to verify notifications...")
        await page.evaluate(f"localStorage.setItem('calendarToken', '{emp_token}')")
        await page.reload(wait_until='domcontentloaded')
        try:
            await page.wait_for_selector("#serverSessionOverlay", state="hidden", timeout=8000)
        except Exception:
            pass
        await asyncio.sleep(2)

        # Poll notifications manually or let app trigger it
        await page.evaluate("""async () => {
            if (typeof checkEngineerNotifications === 'function') {
                await checkEngineerNotifications();
            }
        }""")
        await asyncio.sleep(1)

        # 3. Check Top Floating Banner
        banner_info = await page.evaluate("""() => {
            const b = document.getElementById('engineerUrgeBanner');
            if (!b) return null;
            const style = window.getComputedStyle(b);
            return {
                display: style.display,
                text: b.innerText,
                classes: b.className,
                background: style.background,
                opacity: style.opacity
            };
        }""")
        print("  Top Banner Info:", banner_info)
        assert banner_info is not None, "engineerUrgeBanner must exist"
        assert banner_info['display'] == 'flex', "Banner should be visible with display: flex"
        assert 'banner-praise' in banner_info['classes'], "Banner should have banner-praise class"
        print("  -> Top Banner visible and styled as banner-praise!")

        # Screenshot: Top banner displayed
        banner_shot = os.path.join(OUTPUT_DIR, "01_top_banner_praise_displayed.png")
        await page.screenshot(path=banner_shot)
        print(f"  Saved screenshot: {banner_shot}")

        # 4. Check Reminder Modal & Badge
        print("[3] Checking Reminder Modal (提醒中心)...")
        # Click sidebar reminder button to open reminder modal
        await page.click('#floatingReminder')
        await asyncio.sleep(1)

        modal_info = await page.evaluate("""() => {
            const m = document.getElementById('reminderModal');
            const notifsBox = document.querySelector('.reminder-notifs-box');
            const list = document.getElementById('reminderList');
            return {
                active: m ? m.classList.contains('active') : false,
                hasNotifsBox: !!notifsBox,
                listHtml: list ? list.innerHTML : ''
            };
        }""")
        print("  Modal Info:", { 'active': modal_info['active'], 'hasNotifsBox': modal_info['hasNotifsBox'] })
        assert modal_info['hasNotifsBox'] == False, "提醒中心弹窗内不应再出现 reminder-notifs-box！"
        print("  -> Verified: 提醒中心 modal cleanly contains NO review/like notification boxes!")

        # Screenshot: Reminder Modal clean
        modal_shot = os.path.join(OUTPUT_DIR, "02_reminder_modal_clean_no_notifs_box.png")
        await page.screenshot(path=modal_shot)
        print(f"  Saved screenshot: {modal_shot}")

        # Close reminder modal
        await page.click('#closeReminderModal')
        await asyncio.sleep(0.5)

        # 5. Click the Top Banner to open the memo directly
        print("[4] Clicking Top Banner to open memo and mark read...")
        await page.click('#engineerUrgeBanner')
        await asyncio.sleep(1.5)

        memo_modal_open = await page.evaluate("""() => {
            const mm = document.getElementById('memoModal');
            const titleInput = document.getElementById('memoTitle');
            const banner = document.getElementById('engineerUrgeBanner');
            return {
                memoModalActive: mm ? mm.classList.contains('active') : false,
                memoTitle: titleInput ? titleInput.value : '',
                bannerDisplay: banner ? banner.style.display : ''
            };
        }""")
        print("  After clicking banner:", memo_modal_open)
        assert memo_modal_open['memoModalActive'] == True, "Memo modal should open when clicking the banner"
        assert '测试通知隔离与横幅展现事项' in memo_modal_open['memoTitle'], f"Memo modal should display the memo: {memo_modal_open['memoTitle']}"
        print("  -> Verified: Clicking Top Banner directly opened the reviewed/liked memo!")

        # Screenshot: Memo modal opened from banner
        opened_memo_shot = os.path.join(OUTPUT_DIR, "03_memo_modal_opened_from_banner.png")
        await page.screenshot(path=opened_memo_shot)
        print(f"  Saved screenshot: {opened_memo_shot}")

        # Close memo modal
        await page.click('#closeMemoModal')
        await asyncio.sleep(1)

        # Verify notifications are marked read in backend
        notifs_after = await page.evaluate("""async () => {
            const r = await fetch('/api/notifications');
            return r.json();
        }""")
        print("  Notifications count after clicking banner:", len(notifs_after.get('notifications', [])))
        assert len(notifs_after.get('notifications', [])) == 0, "Notifications should be marked as read"
        print("  -> Verified: Notifications successfully marked read!")

        # Clean up test memo
        await page.evaluate(f"""async () => {{
            await fetch('/api/memos/{test_memo_id}', {{
                method: 'DELETE',
                headers: {{ 'Authorization': 'Bearer {emp_token}' }}
            }});
        }}""")
        print("  Cleaned up test memo.")

        # 6. Test closing banner with × button
        print("[5] Testing close banner with × button...")
        memo_res2 = await page.evaluate(f"""async () => {{
            const r = await fetch('/api/memos', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer {emp_token}'
                }},
                body: JSON.stringify({{
                    title: '测试点击关闭按钮',
                    content: '测试关闭按钮',
                    date: '2026-09-29',
                    category: '工作',
                    type: '工作',
                    priority: 'medium',
                    status: '待办',
                    completed: false
                }})
            }});
            return r.json();
        }}""")
        test_memo_id2 = memo_res2.get('id') or (memo_res2.get('memo') or {}).get('id')
        await page.evaluate(f"""async () => {{
            await fetch('/api/memos/{test_memo_id2}/react', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer {admin_token}'
                }},
                body: JSON.stringify({{ action: 'toggle-like' }})
            }});
        }}""")

        # Poll notifications
        await page.evaluate("""async () => {
            if (typeof checkEngineerNotifications === 'function') {
                await checkEngineerNotifications();
            }
        }""")
        await asyncio.sleep(1)

        banner_display_before = await page.evaluate("document.getElementById('engineerUrgeBanner').style.display")
        assert banner_display_before == 'flex', "Banner should be displayed before clicking close"
        print("  Banner displayed before clicking ×:", banner_display_before)

        # Click close button
        await page.click('#engineerUrgeBanner .close-banner')
        await asyncio.sleep(1)

        banner_display_after = await page.evaluate("document.getElementById('engineerUrgeBanner').style.display")
        assert banner_display_after == 'none', "Banner should be hidden after clicking close"
        print("  Banner hidden after clicking ×:", banner_display_after)

        # Check backend unread notifications count
        notifs_after_close = await page.evaluate("""async () => {
            const r = await fetch('/api/notifications');
            return r.json();
        }""")
        assert len(notifs_after_close.get('notifications', [])) == 0, "Notifications should be marked read when closed"
        print("  -> Verified: Closing banner marked notification as read!")

        # Clean up second test memo
        await page.evaluate(f"""async () => {{
            await fetch('/api/memos/{test_memo_id2}', {{
                method: 'DELETE',
                headers: {{ 'Authorization': 'Bearer {emp_token}' }}
            }});
        }}""")
        print("  Cleaned up second test memo.")

        await b.close()
        print("\nAll verification assertions (including close button test) PASSED!")

if __name__ == '__main__':
    asyncio.run(run())
