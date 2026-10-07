import os
from playwright.sync_api import sync_playwright

output_dir = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\month_switch_audit"
os.makedirs(output_dir, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        headless=True
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})

    # Capture console messages and errors
    page.on("console", lambda msg: print(f"CONSOLE [{msg.type}]: {msg.text}"))
    page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

    # 1. Login as admin
    print("Navigating to login page...")
    page.goto("http://45.205.25.3:8090", wait_until="networkidle")
    page.fill("#serverLoginUser", "admin")
    page.fill("#serverLoginPass", "0000")
    page.click("#serverLoginButton")
    page.wait_for_selector("#multiMonthCalendar", timeout=10000)
    page.wait_for_timeout(2000)

    # Screenshot initial state
    period = page.inner_text("#currentPeriod")
    memos_count = len(page.query_selector_all(".day-memo-item"))
    print(f"Admin Initial period: {period}, visible memos count: {memos_count}")
    page.screenshot(path=os.path.join(output_dir, "01_admin_october.png"))

    # Click prevMonth
    print("Clicking prevMonth...")
    page.click("#prevMonth")
    page.wait_for_timeout(2000)
    period = page.inner_text("#currentPeriod")
    memos_count = len(page.query_selector_all(".day-memo-item"))
    print(f"Admin Prev month period: {period}, visible memos count: {memos_count}")
    page.screenshot(path=os.path.join(output_dir, "02_admin_september.png"))

    # Click nextMonth back to October
    print("Clicking nextMonth (back to Oct)...")
    page.click("#nextMonth")
    page.wait_for_timeout(2000)
    period = page.inner_text("#currentPeriod")
    memos_count = len(page.query_selector_all(".day-memo-item"))
    print(f"Admin Next month period: {period}, visible memos count: {memos_count}")
    page.screenshot(path=os.path.join(output_dir, "03_admin_back_to_october.png"))

    # Click nextMonth again to November
    print("Clicking nextMonth (to Nov)...")
    page.click("#nextMonth")
    page.wait_for_timeout(2000)
    period = page.inner_text("#currentPeriod")
    memos_count = len(page.query_selector_all(".day-memo-item"))
    print(f"Admin Next month period: {period}, visible memos count: {memos_count}")
    page.screenshot(path=os.path.join(output_dir, "04_admin_november.png"))

    # Now let's test member filter
    print("Switching back to Sep...")
    page.click("#prevMonth")
    page.wait_for_timeout(1000)
    page.click("#prevMonth")
    page.wait_for_timeout(2000)
    period = page.inner_text("#currentPeriod")
    print(f"Current period: {period}")

    # Now filter by status "completed"
    completed_btn = page.query_selector(".stat-item.completed")
    if completed_btn:
        print("Clicking completed filter in September...")
        completed_btn.click()
        page.wait_for_timeout(1000)
        memos_count = len(page.query_selector_all(".day-memo-item"))
        print(f"September completed memos: {memos_count}")
        page.screenshot(path=os.path.join(output_dir, "05_sep_completed_filter.png"))

        # Now switch to October while completed filter is active!
        print("Switching to October with completed filter ACTIVE...")
        page.click("#nextMonth")
        page.wait_for_timeout(2000)
        period = page.inner_text("#currentPeriod")
        memos_count = len(page.query_selector_all(".day-memo-item"))
        print(f"October memos with completed filter: {memos_count} (period: {period})")
        page.screenshot(path=os.path.join(output_dir, "06_oct_with_completed_filter.png"))

    browser.close()
    print("Done!")
