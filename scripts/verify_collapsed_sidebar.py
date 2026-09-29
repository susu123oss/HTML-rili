# -*- coding: utf-8 -*-
import asyncio
import os
import json
from playwright.async_api import async_playwright

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE_URL = "http://45.205.25.3:8090"
OUTPUT_DIR = r"C:\Users\Administrator\.gemini\antigravity\brain\fed13eda-d57c-4b1d-9343-8c8bbee6b416\audit_collapsed_sidebar"

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
        ctx = await b.new_context(viewport={'width': 1280, 'height': 850})
        page = await ctx.new_page()

        print("Logging in to server...")
        await login(page, 'admin', '0000')

        # Check collapsed status, ensure it is collapsed
        is_collapsed = await page.evaluate("() => document.getElementById('appSidebar')?.classList.contains('collapsed')")
        if not is_collapsed:
            print("Collapsing sidebar via #sidebarToggle...")
            await page.click("#sidebarToggle")
            await asyncio.sleep(0.8)

        # 1. Measure alignment
        metrics = await page.evaluate("""() => {
            const sidebar = document.getElementById('appSidebar');
            const sidebarRect = sidebar.getBoundingClientRect();
            
            const logoIcon = document.querySelector('.logo-icon')?.getBoundingClientRect();
            const navItems = Array.from(document.querySelectorAll('.app-sidebar.collapsed .nav-item')).map((el, i) => {
                const r = el.getBoundingClientRect();
                const icon = el.querySelector('i')?.getBoundingClientRect();
                return {
                    index: i,
                    active: el.classList.contains('active'),
                    itemBox: { left: Math.round(r.left - sidebarRect.left), width: Math.round(r.width), centerX: ((r.left - sidebarRect.left) + r.width / 2).toFixed(1) },
                    iconBox: icon ? { left: Math.round(icon.left - sidebarRect.left), width: Math.round(icon.width), centerX: ((icon.left - sidebarRect.left) + icon.width / 2).toFixed(1) } : null
                };
            });
            const divider = document.querySelector('.sidebar-divider')?.getBoundingClientRect();
            const userAvatar = document.querySelector('.user-avatar')?.getBoundingClientRect();

            return {
                sidebarWidth: Math.round(sidebarRect.width),
                logoCenterX: logoIcon ? ((logoIcon.left - sidebarRect.left) + logoIcon.width / 2).toFixed(1) : null,
                navItems,
                dividerCenterX: divider ? ((divider.left - sidebarRect.left) + divider.width / 2).toFixed(1) : null,
                userAvatarCenterX: userAvatar ? ((userAvatar.left - sidebarRect.left) + userAvatar.width / 2).toFixed(1) : null,
            };
        }""")

        print("Geometric measurements (target center: 34.0px):")
        print(json.dumps(metrics, indent=2, ensure_ascii=False))

        # 2. Light mode screenshot
        light_path = os.path.join(OUTPUT_DIR, "desktop_collapsed_sidebar_light.png")
        await page.screenshot(path=light_path, full_page=False)
        print(f"Saved light screenshot: {light_path}")

        # Crop sidebar only
        sidebar_elem = page.locator("#appSidebar")
        light_sidebar_path = os.path.join(OUTPUT_DIR, "sidebar_only_light.png")
        await sidebar_elem.screenshot(path=light_sidebar_path)

        # 3. Dark mode screenshot
        print("Switching to dark mode...")
        await page.evaluate("() => { if (typeof applyTheme === 'function') applyTheme('dark'); else { document.documentElement.setAttribute('data-theme', 'dark'); document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); } }")
        await asyncio.sleep(0.8)

        dark_path = os.path.join(OUTPUT_DIR, "desktop_collapsed_sidebar_dark.png")
        await page.screenshot(path=dark_path, full_page=False)
        print(f"Saved dark screenshot: {dark_path}")

        dark_sidebar_path = os.path.join(OUTPUT_DIR, "sidebar_only_dark.png")
        await sidebar_elem.screenshot(path=dark_sidebar_path)

        await b.close()
        print("All screenshots and checks completed!")

if __name__ == "__main__":
    asyncio.run(run())
