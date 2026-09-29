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

        # 1. Kanban View - Light Mode
        print("Capturing 1: Kanban Light...")
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "01_kanban_light.png"), full_page=False)

        # 2. Gantt & Timeline View - Light Mode
        print("Capturing 2: Gantt & Timeline...")
        await page.click('button[data-view="gantt"]')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "02_gantt_timeline_light.png"), full_page=False)

        # 3. Table View - Light Mode
        print("Capturing 3: Table View...")
        await page.click('button[data-view="table"]')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "03_table_list_light.png"), full_page=False)

        # 4. Insights / Dashboard - Light Mode
        print("Capturing 4: Insights & Dashboard...")
        await page.click('button[data-view="insights"]')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "04_insights_dashboard_light.png"), full_page=False)

        # 5. Task Detail Drawer (Slide-Over)
        print("Capturing 5: Task Detail Slide-Over Drawer...")
        await page.click('button[data-view="kanban"]')
        await asyncio.sleep(0.5)
        await page.click('div[data-id="PRJ-105"]')
        await asyncio.sleep(0.6)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "05_task_detail_drawer.png"), full_page=False)

        # Close drawer
        await page.click('#drawerBackdrop')
        await asyncio.sleep(0.5)

        # 6. Dark Mode Kanban
        print("Capturing 6: Dark Mode...")
        await page.click('#themeToggleBtn')
        await asyncio.sleep(0.6)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "06_kanban_dark.png"), full_page=False)

        # 7. Dark Mode Gantt
        print("Capturing 7: Dark Mode Gantt...")
        await page.click('button[data-view="gantt"]')
        await asyncio.sleep(0.5)
        await page.screenshot(path=os.path.join(OUTPUT_DIR, "07_gantt_dark.png"), full_page=False)

        await b.close()
        print("All PM preview screenshots captured successfully!")

if __name__ == "__main__":
    asyncio.run(run())
