import asyncio
import logging
import sys
import time
from typing import Dict, Optional, Tuple

from playwright.async_api import async_playwright

from backend.auth.session import session_manager
from backend.config import settings

logger = logging.getLogger("ilias.login")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


async def run_browser_login(
    headless: Optional[bool] = None,
    timeout_seconds: Optional[int] = None,
    progress_callback: Optional[callable] = None,
) -> Tuple[bool, Dict[str, str], str]:
    """
    Launch a browser using Playwright, navigate to Uni Bern ILIAS,
    wait for user to complete SWITCH edu-ID login, and capture session cookies.
    
    Returns:
        (success, cookies_dict, status_message)
    """
    is_headless = settings.playwright_headless if headless is None else headless
    timeout = settings.playwright_timeout_seconds if timeout_seconds is None else timeout_seconds
    start_time = time.time()

    def update_status(msg: str):
        logger.info(msg)
        if progress_callback:
            progress_callback(msg)

    update_status("Starting Playwright browser for Uni Bern ILIAS authentication...")

    try:
        async with async_playwright() as p:
            try:
                browser = await p.chromium.launch(
                    headless=is_headless,
                    args=["--disable-blink-features=AutomationControlled"]
                )
            except Exception as launch_err:
                msg = (
                    f"Failed to launch Chromium browser: {launch_err}. "
                    "Make sure browser binaries are installed with: playwright install chromium"
                )
                logger.error(msg)
                return False, {}, msg

            context = await browser.new_context(
                user_agent=settings.user_agent,
                viewport={"width": 1280, "height": 800}
            )
            page = await context.new_page()

            update_status(f"Navigating to ILIAS: {settings.ilias_base_url} ...")
            await page.goto(settings.ilias_base_url, wait_until="domcontentloaded")

            update_status(
                "Waiting for SWITCH edu-ID login to complete. "
                "Please log in via the opened browser window..."
            )

            # Loop and check URL and cookies until timeout
            captured_cookies: Dict[str, str] = {}
            authenticated = False

            while time.time() - start_time < timeout:
                current_url = page.url.lower()

                # Check if current URL is on ILIAS domain and not a login/switch page
                is_ilias_domain = "ilias.unibe.ch" in current_url
                is_auth_redirect = any(
                    token in current_url
                    for token in ["login.php", "wayf", "eduid", "aai", "idp", "shibboleth"]
                )
                is_desktop = (
                    "baseclass=ilpersonaldesktopgui" in current_url
                    or "ilias.php" in current_url
                )

                if is_ilias_domain and not is_auth_redirect and is_desktop:
                    # Check cookies in context
                    cookies_list = await context.cookies()
                    cookies_dict = {c["name"]: c["value"] for c in cookies_list}

                    if "PHPSESSID" in cookies_dict:
                        captured_cookies = cookies_dict
                        # Set default ilClientId if missing
                        if "ilClientId" not in captured_cookies:
                            captured_cookies["ilClientId"] = settings.ilias_client_id

                        authenticated = True
                        break

                await asyncio.sleep(1.0)

            await browser.close()

            if not authenticated:
                return (
                    False,
                    {},
                    f"Authentication timed out after {timeout} seconds without completing login."
                )

            # Save session cookies
            session_manager.save_cookies(
                captured_cookies,
                metadata={
                    "source": "playwright_browser_login",
                    "final_url": page.url,
                    "cookies_count": len(captured_cookies),
                }
            )

            update_status("Login successful! Session cookies captured and saved.")
            return True, captured_cookies, "Login successful! Session cookies saved."

    except Exception as e:
        err_msg = f"Browser login failed with error: {str(e)}"
        logger.error(err_msg, exc_info=True)
        return False, {}, err_msg


def main():
    """CLI Entry point for python -m backend.auth.playwright_login"""
    print("\n" + "=" * 60)
    print("Uni Bern ILIAS - Playwright Login Assistant")
    print("=" * 60)
    print("A browser window will open shortly.")
    print("Please select 'Universität Bern' and log in with your SWITCH edu-ID.")
    print("=" * 60 + "\n")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        success, cookies, message = loop.run_until_complete(
            run_browser_login(headless=False)
        )
        if success:
            print("\n SUCCESS: " + message)
            print(f"Captured {len(cookies)} cookies (PHPSESSID: {cookies.get('PHPSESSID')[:8]}...)")
            sys.exit(0)
        else:
            print("\n FAILED: " + message)
            sys.exit(1)
    finally:
        loop.close()


if __name__ == "__main__":
    main()

