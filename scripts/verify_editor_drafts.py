"""Exercise the actual frontend in Edge; all business API writes stay in memory."""
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
OUTPUT = ROOT / 'scratch' / 'editor-drafts'
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
PREFIX = 'calendarEditorDraftV1:'
USERS = [
    dict(id=1, username='draft-test-admin', displayName='草稿测试', role='admin', departmentName='研发部'),
    dict(id=2, username='draft-test-staff', displayName='另一账号', role='staff', departmentName='研发部'),
]


class QuietFiles(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'frontend'), **kwargs)

    def log_message(self, *_):
        pass


async def run(base_url):
    actor = 0
    today = dt.date.today().isoformat()
    memos = [dict(id=101, ownerId=1, ownerName='草稿测试', date=today, title='原事项',
                  content='服务器正文', contentPreview='服务器正文', color='#4361ee',
                  dueTime=f'{today}T18:00:00+08:00', completed=False, planKind='memo',
                  actualDeliverable='日常事务（无需交付物）', deliveryStatus='in_progress')]
    summaries = []
    failure = None
    race = None
    version = 1
    hold = False
    started, release = asyncio.Event(), asyncio.Event()
    delay_weekly_read = False
    read_started, read_release = asyncio.Event(), asyncio.Event()
    delay_memo_read = False
    memo_read_started, memo_read_release = asyncio.Event(), asyncio.Event()
    writes = []

    async def api(route):
        nonlocal failure, hold, race, version, delay_weekly_read, delay_memo_read
        req = route.request
        path = urlparse(req.url).path.removeprefix('/api')
        method = req.method
        result = dict(memos=[], summaries=[], users=USERS, notifications=[])
        status = 200
        if method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            payload = req.post_data_json or {}
            writes.append((path, copy.deepcopy(payload)))
            if hold:
                started.set()
                await release.wait()
                hold = False
            if failure:
                failure = None
                await route.fulfill(status=500, json={'error': '测试保存失败'})
                return
            if race == 'memo' and method == 'PATCH':
                memos[0].update(content='数据库写入前的并发新正文', revision='race-memo')
                race = None
            if race == 'weekly' and method == 'PUT':
                summaries[0].update(goals='数据库写入前的并发新目标', revision='race-weekly')
                race = None
            if 'expectedRevision' in payload:
                current = (next((m for m in memos if str(m['id']) == path.split('/')[-1]), None)
                           if method == 'PATCH' else next((s for s in summaries if
                           s['ownerId'] == payload['ownerId'] and s['weekStart'] == path.split('/')[-1]), None))
                if payload['expectedRevision'] != (current.get('revision', 'initial') if current else 'new'):
                    await route.fulfill(status=409, json={'code': 'EDITOR_VERSION_CONFLICT', 'message': '并发更新，草稿已保留'})
                    return
            version += 1
            if path == '/memos' or (path.startswith('/memos/') and method == 'PATCH'):
                old = next((m for m in memos if str(m['id']) == path.split('/')[-1]), None)
                memo = dict(old or dict(id=200 + len(memos), ownerName='草稿测试'), **payload)
                memo['revision'] = str(version)
                memo['contentPreview'] = memo.get('content', '')[:320]
                if old:
                    old.update(memo)
                else:
                    memos.append(memo)
                result = dict(memo=memo)
            elif path.startswith('/memos/weekly-summaries/'):
                summary = dict(payload, weekStart=path.split('/')[-1], revision=str(version))
                summaries[:] = [s for s in summaries if
                                 (s['ownerId'], s['weekStart']) != (summary['ownerId'], summary['weekStart'])]
                summaries.append(summary)
                result = dict(summary=summary)
            elif method == 'DELETE':
                memos[:] = [m for m in memos if str(m['id']) != path.split('/')[-1]]
        elif path == '/auth/me':
            result = dict(user=USERS[actor])
        elif path == '/memos':
            result = dict(memos=memos)
        elif path == '/memos/weekly-summaries':
            if delay_weekly_read and 'weeks=1' in req.url:
                delay_weekly_read = False
                read_started.set()
                await read_release.wait()
            result = dict(summaries=summaries)
        elif path.startswith('/memos/') and path.split('/')[-1].isdigit():
            if delay_memo_read:
                delay_memo_read = False
                memo_read_started.set()
                await memo_read_release.wait()
            memo = next(m for m in memos if str(m['id']) == path.split('/')[-1])
            memo.setdefault('revision', 'initial')
            result = dict(memo=memo)
        await route.fulfill(status=status, json=result)

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE, headless=True)
        context = await browser.new_context(viewport=dict(width=1440, height=1000))
        await context.add_init_script("localStorage.setItem('calendarToken', 'draft-test-token')")
        await context.route('**/api/**', api)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: asyncio.create_task(
            dialog.accept() if dialog.type == 'confirm' else dialog.dismiss()))

        async def ready(reload=False):
            if reload:
                await page.reload()
            else:
                await page.goto(base_url)
            await page.wait_for_function('state.initialLoadSessionVersion === state.sessionVersion && state.user !== null')
            await expect(page.locator('#serverSessionOverlay')).not_to_be_visible()

        async def new_memo():
            await page.evaluate('openMemoModal()')
            await expect(page.locator('#memoModal.active')).to_be_visible()

        async def existing():
            await page.evaluate("openMemoModal('101')")
            await expect(page.locator('#memoModal.active')).to_be_visible()

        async def snapshot():
            return await page.evaluate("({title: $('memoTitle').value, content: $('memoContent').value, date: $('memoDate').value, dueTime: $('memoDueTime').value, color: document.querySelector('#colorOptions .selected').dataset.color, completed: $('memoCompleted').checked, weeklyPlan: $('memoWeeklyPlan').checked, actual: $('memoActualDeliverable').value})")

        async def draft_count(kind):
            return await page.evaluate('([prefix, kind]) => Object.keys(localStorage).filter(k => k.startsWith(prefix) && k.includes(":" + kind + ":")).length', [PREFIX, kind])

        async def weekly():
            if page.viewport_size['width'] <= 768:
                await page.evaluate('openWeeklyPlanPage()')
            else:
                await page.locator('#navWeeklyPlan').click()
            await page.wait_for_function('state.weeklyDataRangeKey === weeklyDataRequest().key')
            await page.evaluate('openWeeklySummaryDialog()')
            await expect(page.locator('#wpSummaryDialog')).to_be_visible()

        await ready()
        await new_memo()
        await page.locator('#memoTitle').fill('  长备忘录草稿  ')
        await page.locator('#memoContent').fill('## 正文\n第一行\n\n  保留空格与换行  ')
        await page.locator('[data-preset="tomorrow-end"]').click()
        await page.locator('#colorOptions [data-color="#f44336"]').click()
        await page.locator('#memoWeeklyPlan').check()
        await page.locator('#customDeliveryBtn').click()
        await page.locator('#customDeliveryList [data-value="日常事务（无需交付物）"]').click()
        expected = await snapshot()
        assert not writes, 'local drafts must not send business writes'
        await page.screenshot(path=str(OUTPUT / 'desktop-memo.png'))
        await ready(reload=True)  # Reload immediately, without first closing the editor.
        await new_memo()
        assert await snapshot() == expected
        await expect(page.locator('#memoDraftStatus')).to_contain_text('已恢复')
        await page.locator('#closeMemoModal').click()
        await new_memo()
        assert await snapshot() == expected
        failure = 'memo'
        await page.locator('#saveMemo').click()
        await expect(page.locator('#memoSaveFeedback')).to_contain_text('保存失败')
        assert await draft_count('memo') == 1
        await ready(reload=True)
        await new_memo()
        assert await snapshot() == expected
        await page.locator('#saveMemo').click()
        await expect(page.locator('#memoModal.active')).not_to_be_visible()
        assert await draft_count('memo') == 0
        print('PASS: new memo full fields, immediate reload, close/reopen, save failure/success')

        await existing()
        await page.locator('#memoContent').fill('事项101的未保存正文')
        await page.locator('#cancelMemo').click()
        await ready(reload=True)
        await existing()
        await expect(page.locator('#memoContent')).to_have_value('事项101的未保存正文')
        await page.locator('#memoDraftStatus [data-draft-discard]').click()
        await expect(page.locator('#memoContent')).to_have_value('服务器正文')
        assert await draft_count('memo') == 0
        await page.locator('#memoContent').fill('事项101旧草稿')
        await page.keyboard.press('Escape')
        memos[0]['content'] = memos[0]['contentPreview'] = '别人更新后的正文'
        await ready(reload=True)
        await existing()
        await expect(page.locator('#memoContent')).to_have_value('别人更新后的正文')
        await expect(page.locator('#memoDraftStatus [data-draft-restore]')).to_be_visible()
        await page.locator('#memoContent').fill('以最新正文为基础继续写')
        await ready(reload=True)
        await existing()
        await expect(page.locator('#memoContent')).to_have_value('以最新正文为基础继续写')
        await page.locator('#memoDraftStatus [data-draft-restore]').click()
        await expect(page.locator('#memoContent')).to_have_value('事项101旧草稿')
        await page.locator('#saveMemo').click()
        await expect(page.locator('#memoModal.active')).not_to_be_visible()
        assert await draft_count('memo') == 0
        print('PASS: existing item draft, discard, updated server data, both old/new drafts retained')

        await existing()
        await page.locator('#memoContent').fill('编辑过程中写的草稿')
        memos[0]['content'] = memos[0]['contentPreview'] = '编辑期间另一人更新正文'
        write_count = len(writes)
        await page.locator('#saveMemo').click()
        await expect(page.locator('#memoDraftStatus')).to_contain_text('服务器内容已有更新')
        await expect(page.locator('#memoContent')).to_have_value('编辑期间另一人更新正文')
        assert len(writes) == write_count, 'changed source must not be overwritten'
        await page.locator('#memoDraftStatus [data-draft-restore]').click()
        await expect(page.locator('#memoContent')).to_have_value('编辑过程中写的草稿')
        await page.locator('#saveMemo').click()
        await expect(page.locator('#memoModal.active')).not_to_be_visible()
        assert await draft_count('memo') == 0
        print('PASS: memo source changed while editor was open is checked before saving')

        await existing()
        await page.locator('#memoContent').fill('选择交付方式后仍能保存正文')
        await page.locator('#customDeliveryBtn').click()
        await page.locator('#customDeliveryList [data-value="已经邮件交付审核"]').click()
        await page.wait_for_function("state.memos.find(m => String(m.id) === '101').deliveryStatus === 'confirmed'")
        await page.locator('#saveMemo').click()
        await expect(page.locator('#memoModal.active')).not_to_be_visible()
        assert memos[0]['content'] == '选择交付方式后仍能保存正文'
        assert await draft_count('memo') == 0
        print('PASS: existing delivery auto-save is compatible with draft source checks')

        await existing()
        await page.locator('#memoContent').fill('并发前的本机文字')
        race = 'memo'
        await page.locator('#saveMemo').click()
        await expect(page.locator('#memoDraftStatus')).to_contain_text('服务器内容已有更新')
        await expect(page.locator('#memoContent')).to_have_value('数据库写入前的并发新正文')
        await expect(page.locator('#saveMemo')).to_be_enabled()
        await page.locator('#memoDraftStatus [data-draft-restore]').click()
        await expect(page.locator('#memoContent')).to_have_value('并发前的本机文字')
        await page.locator('#saveMemo').click()
        await expect(page.locator('#memoModal.active')).not_to_be_visible()
        assert await draft_count('memo') == 0
        print('PASS: atomic memo conflict restores the local draft after a rejected PATCH')

        await new_memo()
        await page.locator('#memoTitle').fill('保存中继续编辑')
        await page.locator('#memoContent').fill('提交时正文')
        await page.locator('#customDeliveryBtn').click()
        await page.locator('#customDeliveryList [data-value="日常事务（无需交付物）"]').click()
        hold = True
        started.clear()
        release.clear()
        await page.locator('#saveMemo').click()
        await started.wait()
        await page.locator('#memoContent').fill('请求发出后又写了内容')
        release.set()
        await expect(page.locator('#memoSaveFeedback')).to_contain_text('后续修改')
        await expect(page.locator('#memoContent')).to_have_value('请求发出后又写了内容')
        assert await draft_count('memo') == 1
        saved_id = memos[-1]['id']
        total_memos = len(memos)
        await page.locator('#saveMemo').click()
        await expect(page.locator('#memoModal.active')).not_to_be_visible()
        assert len(memos) == total_memos and memos[-1]['id'] == saved_id
        assert memos[-1]['content'] == '请求发出后又写了内容'
        assert await draft_count('memo') == 0
        print('PASS: typing during a save is retained')

        await weekly()
        fields = ['Goals', 'Deliverables', 'Actual', 'Risks']
        for field in fields:
            await page.locator('#wpField' + field).fill(f'  {field} 草稿\n第二行  ')
        await page.keyboard.press('Escape')
        await ready(reload=True)
        await weekly()
        for field in fields:
            await expect(page.locator('#wpField' + field)).to_have_value(f'  {field} 草稿\n第二行  ')
        failure = 'weekly'
        await page.locator('#wpSaveSummaryBtn').click()
        await expect(page.locator('#wpSaveSummaryBtn')).to_be_enabled()
        assert await draft_count('weekly') == 1
        await page.locator('#wpSaveSummaryBtn').click()
        await expect(page.locator('#wpSummaryDialog')).not_to_be_visible()
        assert await draft_count('weekly') == 0
        await page.evaluate('openWeeklySummaryDialog()')
        await page.locator('#wpFieldGoals').fill('周目标旧草稿')
        await page.keyboard.press('Escape')
        summaries[0]['goals'] = '本页缓存之后别人修改了目标'
        await page.evaluate('openWeeklySummaryDialog()')  # No page reload or weekly refresh.
        await expect(page.locator('#wpFieldGoals')).to_have_value('本页缓存之后别人修改了目标')
        await expect(page.locator('#weeklyDraftStatus [data-draft-restore]')).to_be_visible()
        await page.locator('#weeklyDraftStatus [data-draft-restore]').click()
        await expect(page.locator('#wpFieldGoals')).to_have_value('周目标旧草稿')
        summaries[0]['goals'] = '编辑期间另一人再次修改目标'
        write_count = len(writes)
        await page.locator('#wpSaveSummaryBtn').click()
        await expect(page.locator('#weeklyDraftStatus')).to_contain_text('服务器内容已有更新')
        await expect(page.locator('#wpFieldGoals')).to_have_value('编辑期间另一人再次修改目标')
        assert len(writes) == write_count
        await page.locator('#weeklyDraftStatus [data-draft-restore]').click()
        await page.locator('#wpSaveSummaryBtn').click()
        await expect(page.locator('#wpSummaryDialog')).not_to_be_visible()
        assert await draft_count('weekly') == 0
        print('PASS: stale weekly cache and changes during editing never trigger an unchecked PUT')

        await page.evaluate('openWeeklySummaryDialog()')
        await page.locator('#wpFieldGoals').fill('并发前的周目标草稿')
        race = 'weekly'
        await page.locator('#wpSaveSummaryBtn').click()
        await expect(page.locator('#weeklyDraftStatus')).to_contain_text('服务器内容已有更新')
        await expect(page.locator('#wpFieldGoals')).to_have_value('数据库写入前的并发新目标')
        await page.locator('#weeklyDraftStatus [data-draft-restore]').click()
        await expect(page.locator('#wpFieldGoals')).to_have_value('并发前的周目标草稿')
        await page.locator('#wpSaveSummaryBtn').click()
        await expect(page.locator('#wpSummaryDialog')).not_to_be_visible()
        assert await draft_count('weekly') == 0
        print('PASS: atomic weekly conflict preserves the local draft after a rejected PUT')

        await page.evaluate('openWeeklySummaryDialog()')
        await page.locator('#wpFieldGoals').fill('保存本周的目标')
        hold = True
        started.clear()
        release.clear()
        await page.locator('#wpSaveSummaryBtn').click()
        await started.wait()
        await page.keyboard.press('Escape')
        await page.locator('#wpPagePrevWeek').click()
        await page.wait_for_function('state.weeklyDataRangeKey === weeklyDataRequest().key')
        await page.evaluate('openWeeklySummaryDialog()')
        await page.locator('#wpFieldGoals').fill('上一周正在编辑的新草稿')
        release.set()
        await expect(page.locator('#wpSaveSummaryBtn')).to_be_enabled()
        await expect(page.locator('#wpSummaryDialog')).to_be_visible()
        await expect(page.locator('#wpFieldGoals')).to_have_value('上一周正在编辑的新草稿')
        await page.locator('#weeklyDraftStatus [data-draft-discard]').click()
        await page.keyboard.press('Escape')
        await page.locator('#wpPageNextWeek').click()
        await page.wait_for_function('state.weeklyDataRangeKey === weeklyDataRequest().key')
        print('PASS: saving a previous editor cannot close or overwrite a newly opened week')
        await page.evaluate('openWeeklySummaryDialog()')
        await page.locator('#wpFieldGoals').fill('本周独立草稿')
        await page.keyboard.press('Escape')
        await page.locator('#wpPagePrevWeek').click()
        await page.wait_for_function('state.weeklyDataRangeKey === weeklyDataRequest().key')
        await page.evaluate('openWeeklySummaryDialog()')
        await expect(page.locator('#wpFieldGoals')).not_to_have_value('本周独立草稿')
        await page.keyboard.press('Escape')
        await page.locator('#wpPageNextWeek').click()
        await page.wait_for_function('state.weeklyDataRangeKey === weeklyDataRequest().key')
        await page.evaluate('copyWeeklyReportMarkdown()')
        await page.locator('#wpReportPreview').fill('手工整理后的周报\n不丢失这段复盘')
        await page.keyboard.press('Escape')
        await ready(reload=True)
        await page.locator('#navWeeklyPlan').click()
        await page.wait_for_function('state.weeklyDataRangeKey === weeklyDataRequest().key')
        await page.evaluate('copyWeeklyReportMarkdown()')
        await expect(page.locator('#wpReportPreview')).to_have_value('手工整理后的周报\n不丢失这段复盘')
        await page.keyboard.press('Escape')
        print('PASS: weekly four fields, failure/success, week isolation, edited report preview')

        await new_memo()
        await page.locator('#memoTitle').fill('账号1的新草稿')
        await page.evaluate('logout()')
        actor = 1
        await ready(reload=True)
        await new_memo()
        await expect(page.locator('#memoTitle')).to_have_value('')
        await page.locator('#cancelMemo').click()
        await existing()
        assert await page.locator('#memoContent').evaluate('(el) => el.readOnly')
        await expect(page.locator('#memoDraftStatus')).not_to_be_visible()
        await page.locator('#cancelMemo').click()
        await weekly()
        await expect(page.locator('#wpFieldGoals')).to_have_value('')
        await page.keyboard.press('Escape')
        actor = 0
        await ready(reload=True)
        await new_memo()
        await expect(page.locator('#memoTitle')).to_have_value('账号1的新草稿')
        await page.locator('#memoDraftStatus [data-draft-discard]').click()
        await page.evaluate("() => { Storage.prototype.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if (String(k).startsWith('calendarEditorDraftV1:')) throw new DOMException('full', 'QuotaExceededError'); return this.originalSetItem(k,v); }; }")
        await page.locator('#memoContent').fill('本机空间不足时明确提示')
        await expect(page.locator('#memoDraftStatus')).to_contain_text('无法保存草稿')
        await page.evaluate('() => { Storage.prototype.setItem = Storage.prototype.originalSetItem; }')
        await page.locator('#memoContent').fill('恢复存储后继续保留')
        await expect(page.locator('#memoDraftStatus')).to_contain_text('自动保留')
        print('PASS: logout/account isolation, read-only permissions, storage failure/recovery')

        await page.set_viewport_size(dict(width=393, height=852))
        await page.screenshot(path=str(OUTPUT / 'mobile-memo.png'))
        bounds = await page.locator('#memoContent').bounding_box()
        assert bounds['height'] >= 150, bounds
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        await page.evaluate('applyTheme("dark")')
        await page.screenshot(path=str(OUTPUT / 'mobile-dark.png'))
        await page.locator('#cancelMemo').click()
        await weekly()
        await page.screenshot(path=str(OUTPUT / 'mobile-weekly.png'))
        assert await page.locator('#wpSaveSummaryBtn').is_visible()
        await page.keyboard.press('Escape')
        delay_weekly_read = True
        await page.evaluate('void openWeeklySummaryDialog()')
        await read_started.wait()
        await page.evaluate('closeWeeklyPlanPage()')
        read_release.set()
        await page.wait_for_timeout(150)
        await expect(page.locator('#wpSummaryDialog')).not_to_be_visible()
        await existing()
        await page.locator('#memoContent').fill('详情读取期间切走页面的草稿')
        await page.locator('#cancelMemo').click()
        delay_memo_read = True
        await page.evaluate("void openMemoModal('101')")
        await memo_read_started.wait()
        await page.evaluate('openWeeklyPlanPage()')
        memo_read_release.set()
        await page.wait_for_timeout(150)
        await expect(page.locator('#memoModal.active')).not_to_be_visible()
        assert not errors, errors
        print('PASS: mobile/light/dark layout, leaving a page during memo/weekly reads cannot reopen its dialog, no browser errors')
        await browser.close()


async def verify_live(url):
    # Login uses the existing deploy configuration; never print credentials or tokens.
    import deploy
    original_argv = sys.argv
    try:
        sys.argv = [original_argv[0]]
        settings = deploy.parse_args()
    finally:
        sys.argv = original_argv
    result = deploy.request_json(url.rstrip('/') + '/api/auth/login', dict(
        username=settings.verify_username, password=settings.verify_password))
    token = result.get('token')
    assert token, 'live login did not return a session'
    violations, errors = [], []

    async def read_only_api(route):
        if route.request.method not in ('GET', 'HEAD', 'OPTIONS'):
            violations.append(urlparse(route.request.url).path)
            await route.fulfill(status=403, json={'message': 'Read-only verification'})
        else:
            await route.continue_()

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=EDGE, headless=True)
        context = await browser.new_context(viewport=dict(width=1440, height=1000))
        await context.add_init_script('localStorage.setItem("calendarToken", ' + json.dumps(token) + ')')
        await context.route('**/api/**', read_only_api)
        page = await context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))

        async def ready(reload=False):
            if reload:
                await page.reload()
            else:
                await page.goto(url)
            await page.wait_for_function('state.user !== null && state.initialLoadSessionVersion === state.sessionVersion')
            await expect(page.locator('#serverSessionOverlay')).not_to_be_visible()

        async def open_weekly():
            await page.evaluate('openWeeklyPlanPage()')
            await page.wait_for_function('state.weeklyDataRangeKey === weeklyDataRequest().key')
            await page.evaluate('openWeeklySummaryDialog()')

        await ready()
        assert '20261008_editor_drafts_v67' in await page.locator('script[src*="app.js?"]').get_attribute('src')
        await page.evaluate('openMemoModal()')
        await page.locator('#memoTitle').fill('草稿恢复在线验证')
        await page.locator('#memoContent').fill('关闭或刷新后继续编辑。\n这里只生成本机草稿。')
        await ready(reload=True)
        await page.evaluate('openMemoModal()')
        await expect(page.locator('#memoTitle')).to_have_value('草稿恢复在线验证')
        await expect(page.locator('#memoContent')).to_have_value('关闭或刷新后继续编辑。\n这里只生成本机草稿。')
        await page.screenshot(path=str(OUTPUT / 'live-desktop.png'))
        await page.set_viewport_size(dict(width=393, height=852))
        await page.screenshot(path=str(OUTPUT / 'live-mobile.png'))
        await page.locator('#cancelMemo').click()
        await open_weekly()
        await page.locator('#wpFieldActual').fill('在线周复盘草稿，未提交服务器')
        await ready(reload=True)
        await open_weekly()
        await expect(page.locator('#wpFieldActual')).to_have_value('在线周复盘草稿，未提交服务器')
        await page.keyboard.press('Escape')
        await page.evaluate('copyWeeklyReportMarkdown()')
        await page.locator('#wpReportPreview').fill('在线周报预览草稿\n手工编辑继续保留')
        await ready(reload=True)
        await page.evaluate('openWeeklyPlanPage()')
        await page.wait_for_function('state.weeklyDataRangeKey === weeklyDataRequest().key')
        await page.evaluate('copyWeeklyReportMarkdown()')
        await expect(page.locator('#wpReportPreview')).to_have_value('在线周报预览草稿\n手工编辑继续保留')
        await page.screenshot(path=str(OUTPUT / 'live-report-mobile.png'))
        assert not violations, violations
        assert not errors, errors
        print('PASS: live HTTPS v67, memo/weekly/report reload recovery, mobile layout, no business writes/errors')
        await browser.close()


if __name__ == '__main__':
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) == 3 and sys.argv[1] == '--live':
        asyncio.run(verify_live(sys.argv[2]))
        raise SystemExit(0)
    server = ThreadingHTTPServer(('127.0.0.1', 0), QuietFiles)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        asyncio.run(run(f'http://127.0.0.1:{server.server_port}'))
    finally:
        server.shutdown()
