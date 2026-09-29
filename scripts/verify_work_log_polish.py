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

        # ----------------------------------------------------
        # Part 1: Staff User (孔致镔) creates a test task for Admin to review
        # ----------------------------------------------------
        print("[0] Staff (孔致镔) creates a test memo for review & like verification...")
        staff_init_ctx = await b.new_context(viewport={'width': 1280, 'height': 850})
        staff_init_page = await staff_init_ctx.new_page()
        await login(staff_init_page, '孔致镔', '0000')

        test_memo_id = await staff_init_page.evaluate("""async () => {
            const todayStr = dateKey(new Date());
            const res = await request('/memos', {
                method: 'POST',
                body: JSON.stringify({
                    title: '【孔致镔】端到端闭环研发工作汇报',
                    content: '### 每日工作汇报\\n- [x] 完成核心功能开发\\n- [ ] 进行端到端测试与管理员审阅确认',
                    date: todayStr,
                    dueTime: `${todayStr} 18:00:00`,
                    color: '#3b82f6',
                    completed: false,
                    planKind: 'memo'
                })
            });
            return res?.memo?.id;
        }""")
        print(f"  -> Created staff memo ID: {test_memo_id}")
        await staff_init_ctx.close()

        # ----------------------------------------------------
        # Part 2: Admin User
        # ----------------------------------------------------
        print("[1] Admin tests redesigned memo modal, carry-over, review & like...")
        ctx = await b.new_context(viewport={'width': 1280, 'height': 850})
        page = await ctx.new_page()
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
        await login(page, 'admin', '0000')

        # Set light theme
        await page.evaluate("""() => {
            document.documentElement.dataset.theme = 'light';
            localStorage.setItem('calendarTheme', 'light');
        }""")
        await asyncio.sleep(0.5)

        # 1. Test Redesigned Memo Modal with spacious editor
        print("  -> Testing Redesigned Memo Modal layout & height...")
        await page.evaluate("() => openMemoModal(null, new Date())")
        await asyncio.sleep(1)

        # Click "⚡ 研发日志" template button
        await page.click('button[data-tpl="dev"]')
        await asyncio.sleep(0.5)
        await page.fill('#memoTitle', '日常研发进度与联调测试（排版与充裕高度验证）')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "01_memo_modal_redesign_spacious_light.png"))
        print("  -> Saved 01_memo_modal_redesign_spacious_light.png")

        # 2. Test Carry-over button in memo modal
        print("  -> Testing Carry-over from Yesterday...")
        await page.click('#btnCarryoverYesterday')
        await asyncio.sleep(1)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "02_memo_modal_carryover.png"))
        print("  -> Saved 02_memo_modal_carryover.png")

        # Close memo modal cleanly
        await page.evaluate("() => closeMemoModal()")
        await asyncio.sleep(0.8)

        # 3. Test Topbar Quick Weekly Report
        print("  -> Testing Topbar Quick Weekly Report...")
        await page.click('#btnQuickWeeklyReport')
        await asyncio.sleep(1.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "03_topbar_quick_weekly_report.png"))
        print("  -> Saved 03_topbar_quick_weekly_report.png")

        # Close weekly report dialog
        await page.evaluate("() => document.getElementById('wpReportDialog')?.close()")
        await asyncio.sleep(0.8)

        # 4. Daily Detail Modal & Admin Reaction Buttons (Review & Like)
        print(f"  -> Testing Admin Review & Like on staff task {test_memo_id}...")
        today_date_str = await page.evaluate("() => dateKey(new Date())")
        await page.evaluate(f"() => openDailyDetailModal('{today_date_str}')")
        await asyncio.sleep(1.5)

        # Verify carryover button is present in daily detail modal footer
        daily_carry_btn = await page.query_selector('#btnDailyCarryover')
        assert daily_carry_btn is not None, "btnDailyCarryover should exist in dailyDetailModal footer"

        # Admin clicks reaction buttons on the newly created staff memo
        react_read_btn = await page.query_selector(f'.task-btn-react[data-id="{test_memo_id}"][data-action="toggle-read"]')
        if react_read_btn:
            await react_read_btn.click()
            await asyncio.sleep(0.8)
            print("  -> Admin clicked [审阅 / 已阅]")

        react_like_btn = await page.query_selector(f'.task-btn-react[data-id="{test_memo_id}"][data-action="toggle-like"]')
        if react_like_btn:
            await react_like_btn.click()
            await asyncio.sleep(0.8)
            print("  -> Admin clicked [点赞 / 已赞]")

        await page.screenshot(path=os.path.join(OUTPUT_DIR, "04_daily_detail_admin_with_reactions.png"))
        print("  -> Saved 04_daily_detail_admin_with_reactions.png")

        # Close daily detail modal
        await page.evaluate("() => closeDailyDetailModal()")
        await asyncio.sleep(0.8)

        # 5. Test Dark Theme
        print("  -> Testing Dark Theme...")
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
        await page.evaluate(f"() => openDailyDetailModal('{today_date_str}')")
        await asyncio.sleep(1.2)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "06_daily_detail_dark.png"))
        print("  -> Saved 06_daily_detail_dark.png")
        await page.evaluate("() => closeDailyDetailModal()")
        await ctx.close()

        # ----------------------------------------------------
        # Part 3: Non-Admin Employee (孔致镔) - Closed Loop Verification
        # ----------------------------------------------------
        print("[2] Testing Employee View (孔致镔) - Closed loop notifications and stamps...")
        staff_ctx = await b.new_context(viewport={'width': 1280, 'height': 850})
        staff_page = await staff_ctx.new_page()
        staff_page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
        await login(staff_page, '孔致镔', '0000')

        await staff_page.evaluate("""() => {
            document.documentElement.dataset.theme = 'light';
            localStorage.setItem('calendarTheme', 'light');
        }""")
        await asyncio.sleep(0.5)

        # Trigger notification check
        await staff_page.evaluate("async () => { await checkEngineerNotifications(); }")
        await asyncio.sleep(1.5)

        # Verify notification banner or badge
        notif_badge_text = await staff_page.evaluate("() => $('reminderBadge')?.textContent || ''")
        print(f"  -> Employee floating reminder badge text: {notif_badge_text}")
        await staff_page.screenshot(path=os.path.join(OUTPUT_DIR, "08_staff_notification_banner_and_badge.png"))
        print("  -> Saved 08_staff_notification_banner_and_badge.png")

        # Open Reminder Modal to check notifications list
        await staff_page.evaluate("() => showReminderModal()")
        await asyncio.sleep(1.2)

        # Check if reminder-notifs-box exists
        has_notifs_box = await staff_page.evaluate("() => Boolean(document.querySelector('.reminder-notifs-box'))")
        print(f"  -> reminder-notifs-box displayed: {has_notifs_box}")
        await staff_page.screenshot(path=os.path.join(OUTPUT_DIR, "09_staff_reminder_modal_with_notifications.png"))
        print("  -> Saved 09_staff_reminder_modal_with_notifications.png")

        # Click on the notification item to verify it directly opens the memo modal
        first_notif = await staff_page.query_selector('.reminder-notif-item')
        if first_notif:
            await first_notif.click()
            await asyncio.sleep(1.2)
            await staff_page.screenshot(path=os.path.join(OUTPUT_DIR, "10_staff_memo_modal_from_notification.png"))
            print("  -> Saved 10_staff_memo_modal_from_notification.png")
            await staff_page.evaluate("() => closeMemoModal()")
            await asyncio.sleep(0.8)

        # Open Daily Detail Modal as employee to verify stamps and no action buttons
        await staff_page.evaluate(f"() => openDailyDetailModal('{today_date_str}')")
        await asyncio.sleep(1.2)

        # Verify that .task-btn-react buttons do NOT exist for regular employees
        staff_react_btns = await staff_page.query_selector_all('.task-btn-react')
        print(f"  -> Employee view: found {len(staff_react_btns)} reaction action buttons (expected 0).")
        assert len(staff_react_btns) == 0, "Non-admin should not see reaction buttons!"

        # Verify stamps are present
        stamps = await staff_page.query_selector_all('.task-stamp')
        print(f"  -> Employee view: found {len(stamps)} task stamps.")
        assert len(stamps) >= 2, "Employee should see '已阅' and '+1' stamps!"

        await staff_page.screenshot(path=os.path.join(OUTPUT_DIR, "11_staff_daily_detail_with_stamps.png"))
        print("  -> Saved 11_staff_daily_detail_with_stamps.png")

        await staff_ctx.close()
        await b.close()
        print("\nALL VERIFICATIONS (ADMIN & STAFF CLOSED LOOP) COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(run())
