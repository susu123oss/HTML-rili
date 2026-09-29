# -*- coding: utf-8 -*-
import asyncio
import os
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
URL = "http://45.205.25.3:8090/pm_preview.html"
OUTPUT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_pm_preview"

async def run():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EDGE_PATH, headless=True)
        ctx = await b.new_context(viewport={'width': 1366, 'height': 820})
        page = await ctx.new_page()

        print(f"Navigating to {URL} ...")
        await page.goto(URL, wait_until='domcontentloaded')
        await asyncio.sleep(1.5)

        # 1. Switch to Employee Role
        print("Switching to Employee Role...")
        await page.click('#btnRoleEmployee')
        await asyncio.sleep(0.8)

        # Capture Employee Workspace (Light)
        emp_light_path = os.path.join(OUTPUT_DIR, "08_employee_workspace_light.png")
        await page.screenshot(path=emp_light_path, full_page=False)
        print(f"Saved: {emp_light_path}")

        # Trigger Blocker Modal
        print("Triggering Blocker Modal...")
        await page.click('.btn-call-blocker')
        await asyncio.sleep(0.6)
        blocker_modal_path = os.path.join(OUTPUT_DIR, "09_employee_blocker_modal.png")
        await page.screenshot(path=blocker_modal_path, full_page=False)
        print(f"Saved: {blocker_modal_path}")

        # Close modal
        await page.evaluate("() => closeBlockerModal()")
        await asyncio.sleep(0.4)

        # Switch to Dark Mode in Employee View
        print("Capturing Employee Dark Mode...")
        await page.click('#themeToggleBtn')
        await asyncio.sleep(0.6)
        emp_dark_path = os.path.join(OUTPUT_DIR, "10_employee_workspace_dark.png")
        await page.screenshot(path=emp_dark_path, full_page=False)
        print(f"Saved: {emp_dark_path}")

        await b.close()
        print("Employee view screenshots captured successfully!")

if __name__ == "__main__":
    asyncio.run(run())
