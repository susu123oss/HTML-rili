"""Verify weekly member drill-down and quiet reminder settings in Edge."""
import asyncio
import copy
import datetime as dt
import json
import pathlib
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from playwright.async_api import async_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'scratch' / 'weekly-member-view'
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

USERS = [
    dict(id=1, username='admin', displayName='系统管理员', role='admin', departmentName='总经办'),
    dict(id=2, username='kong', displayName='孔致镔', role='staff', departmentName='测试部', jobTitle='测试工程师'),
]


class QuietFiles(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'frontend'), **kwargs)

    def log_message(self, *_):
        pass


async def run(base_url):
    today = dt.date.today()
    monday = today - dt.timedelta(days=today.weekday())
    mon_str = monday.isoformat()
    wed_str = (monday + dt.timedelta(days=2)).isoformat()

    memos = [
        dict(id=101, ownerId=2, ownerName='孔致镔', date=mon_str, title='1.W&F系列电池包报告总结输出',
             content='完成电池包测试报告并归档', contentPreview='完成电池包测试报告并归档', color='#206bc4',
             dueTime=f'{mon_str}T18:00:00+08:00', completed=False, planKind='plan',
             actualDeliverable='', deliveryStatus='in_progress'),
        dict(id=102, ownerId=1, ownerName='系统管理员', date=wed_str, title='管理全员KPI考核',
             content='制定各部门考核指标', contentPreview='制定各部门考核指标', color='#4361ee',
             dueTime=f'{wed_str}T18:00:00+08:00', completed=False, planKind='plan',
             actualDeliverable='', deliveryStatus='in_progress'),
    ]

    summaries = [
        dict(ownerId=2, weekStart=mon_str, goals='完成W&F系列测试与报告归档', deliverables='W&F测试报告一份',
             actual='', risks=''),
        dict(ownerId=1, weekStart=mon_str, goals='推进全员绩效评定', deliverables='绩效评定表',
             actual='', risks=''),
    ]

    async def api(route):
        req = route.request
        path = urlparse(req.url).path.removeprefix('/api')
        method = req.method
        payload = req.post_data_json or {}

        if path == '/auth/me':
            return await route.fulfill(status=200, json={'user': USERS[0]})
        if path == '/users':
            return await route.fulfill(status=200, json={'users': USERS})
        if path.startswith('/memos/reminders'):
            return await route.fulfill(status=200, json={'memos': memos})
        if path.startswith('/memos/weekly-summaries'):
            return await route.fulfill(status=200, json={'summaries': summaries})
        if path.startswith('/memos'):
            return await route.fulfill(status=200, json={'memos': memos})
        if path == '/notifications':
            return await route.fulfill(status=200, json={'notifications': []})
        if path == '/ops/status':
            return await route.fulfill(status=200, json={'level': 'ok'})
        return await route.fulfill(status=200, json={'ok': True})

    OUTPUT.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE, headless=True)
        context = await browser.new_context(viewport={'width': 1400, 'height': 900})
        page = await context.new_page()

        await page.add_init_script("""
            localStorage.setItem('calendarToken', 'test-token');
            localStorage.setItem('calendarUser', JSON.stringify({
                id: 1, username: 'admin', displayName: '系统管理员', role: 'admin'
            }));
            localStorage.setItem('calendarReminderSettingsV1', JSON.stringify({
                checkInterval: 5, advanceMinutes: 60, sound: true, desktop: false,
                scope: 'mine', includeWeeklyPlans: false
            }));
        """)

        await page.route('**/api/**', api)
        await page.goto(base_url, wait_until='networkidle')

        # 1. 验证到期提醒免打扰设置
        scope_setting = await page.evaluate("() => readReminderSettings().scope")
        quiet_plans = await page.evaluate("() => readReminderSettings().includeWeeklyPlans")
        assert scope_setting == 'mine', f"Expected scope 'mine', got {scope_setting}"
        assert quiet_plans is False, f"Expected includeWeeklyPlans False, got {quiet_plans}"

        # 2. 验证提醒检查不给管理员弹其他人的周计划
        toasts = await page.evaluate("""() => {
            state.reminders = [
                { id: 101, ownerId: 2, title: '孔致镔的周计划', dueTime: new Date(Date.now() + 1000).toISOString(), completed: false, planKind: 'plan' },
                { id: 102, ownerId: 2, title: '孔致镔的备忘', dueTime: new Date(Date.now() + 1000).toISOString(), completed: false, planKind: 'memo' }
            ];
            // Clear fired state
            writeReminderFiredState({});
            dispatchPendingDueReminders();
            return document.querySelectorAll('.toast, .operation-feedback.info').length;
        }""")
        assert toasts == 0, f"Expected 0 quiet notifications, got {toasts}"
        print("PASS: Reminder quiet mode correctly filters out colleague items and weekly plans")

        # 3. 验证进入周计划
        await page.evaluate("() => openWeeklyPlanPage()")
        await page.wait_for_selector('#wpPageViewTeamBtn', state='visible')
        print("PASS: Weekly plan opened")

        # 4. 切换到全员看板
        await page.click('#wpPageViewTeamBtn')
        await page.wait_for_selector('.wp-team-card[data-user-id="2"]', state='visible')
        audit_dir = pathlib.Path(r'C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\weekly_member_audit')
        audit_dir.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(audit_dir / '01_team_board.png'))
        print("PASS: Team view rendered with member cards")

        # 5. 点击孔致镔卡片穿透进入其个人周计划
        await page.click('.wp-team-card[data-user-id="2"]')
        await page.wait_for_selector('#wpTargetUserSelect', state='visible')

        # 验证当前视图切换为 personal，且当前选中目标为孔致镔 (ID=2)
        current_target = await page.evaluate("() => getWeeklyTargetUserId()")
        assert current_target == 2, f"Expected targetUserId 2, got {current_target}"

        # 验证下拉框的值也是 2
        select_val = await page.input_value('#wpTargetUserSelect')
        assert select_val == '2', f"Expected select value '2', got {select_val}"

        # 验证“我的计划”按钮可见
        my_plan_btn_display = await page.evaluate("() => document.getElementById('wpViewMyPlanBtn').style.display")
        assert my_plan_btn_display != 'none', "Expected wpViewMyPlanBtn to be visible"

        # 验证看板中展示了孔致镔的周计划卡片
        kong_card = await page.wait_for_selector('.wp-day-task-card[data-memo-id="101"]')
        assert kong_card is not None, "Expected task card for memo 101"
        await page.screenshot(path=str(audit_dir / '02_kong_weekly_plan.png'))
        print("PASS: Drill-down to member weekly plan successfully displays member 7-day schedule")

        # 6. 打开本周目标与复盘弹窗，验证标题带有孔致镔名字
        await page.click('#wpPageGoalsBtn')
        await page.wait_for_selector('#wpSummaryDialog[open]')
        title_text = await page.text_content('#wpSummaryTitle')
        assert '孔致镔' in title_text, f"Expected '孔致镔' in summary dialog title, got: {title_text}"
        await page.screenshot(path=str(audit_dir / '03_summary_dialog_kong.png'))
        print(f"PASS: Summary dialog opened with member title: {title_text.strip()}")
        await page.evaluate("() => document.getElementById('wpSummaryDialog').close()")

        # 7. 点击“我的计划”一键返回管理员自己的周计划
        await page.click('#wpViewMyPlanBtn')
        await page.wait_for_timeout(200)

        my_target = await page.evaluate("() => getWeeklyTargetUserId()")
        assert my_target == 1, f"Expected targetUserId 1, got {my_target}"
        my_select_val = await page.input_value('#wpTargetUserSelect')
        assert my_select_val == '1', f"Expected select value '1', got {my_select_val}"

        # 验证管理员自己的周计划卡片 102 出现
        admin_card = await page.wait_for_selector('.wp-day-task-card[data-memo-id="102"]')
        assert admin_card is not None, "Expected admin memo 102"
        await page.screenshot(path=str(audit_dir / '04_admin_own_plan.png'))
        # 8. 打开系统设置面板 -> 提醒设置
        await page.evaluate("() => openFunctionsModal('reminderSettings')")
        await page.wait_for_selector('#reminderSettingsTab', state='visible')
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(audit_dir / '05_reminder_settings_modal.png'))
        print("PASS: Reminder settings modal opened and screenshotted")

        await context.close()
        await browser.close()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), QuietFiles)
    port = server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        asyncio.run(run(f'http://127.0.0.1:{port}/index.html'))
        print("\nALL VERIFICATIONS PASSED!")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
