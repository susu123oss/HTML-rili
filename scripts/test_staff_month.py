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

    page.goto("http://45.205.25.3:8090", wait_until="networkidle")
    # Login as 孔致镔
    page.fill("#serverLoginUser", "孔致镔")
    page.fill("#serverLoginPass", "0000")
    page.click("#serverLoginButton")
    page.wait_for_selector("#multiMonthCalendar", timeout=10000)
    page.wait_for_timeout(2000)

    period = page.inner_text("#currentPeriod")
    memos_count = len(page.query_selector_all(".day-memo-item"))
    print(f"Staff (孔致镔) Initial period: {period}, visible memos count: {memos_count}")
    page.screenshot(path=os.path.join(output_dir, "staff_01_october.png"))

    # Switch to September
    page.click("#prevMonth")
    page.wait_for_timeout(2000)
    period = page.inner_text("#currentPeriod")
    memos_count = len(page.query_selector_all(".day-memo-item"))
    print(f"Staff (孔致镔) Prev month (Sep): {period}, visible memos count: {memos_count}")
    page.screenshot(path=os.path.join(output_dir, "staff_02_september.png"))

    # Switch back to October
    page.click("#nextMonth")
    page.wait_for_timeout(2000)
    period = page.inner_text("#currentPeriod")
    memos_count = len(page.query_selector_all(".day-memo-item"))
    print(f"Staff (孔致镔) Next month (Oct): {period}, visible memos count: {memos_count}")
    page.screenshot(path=os.path.join(output_dir, "staff_03_october.png"))

    browser.close()
    print("Staff test complete!")
