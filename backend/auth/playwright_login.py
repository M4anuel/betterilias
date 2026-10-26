from backend.i18n import t
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


async def _async_login_impl(
    headless: bool,
    timeout: int,
    progress_callback: Optional[callable] = None,
) -> Tuple[bool, Dict[str, str], str]:
    """
    Internal async implementation of the Playwright login flow.
    Runs inside a ProactorEventLoop on Windows.
    """
    start_time = time.time()

    def update_status(msg: str):
        logger.info(msg)
        if progress_callback:
            progress_callback(msg)

    update_status("Starting browser for Uni Bern ILIAS authentication...")

    try:
        settings.browser_profile_path.mkdir(parents=True, exist_ok=True)

        async with async_playwright() as p:
            context = None
            last_err = None
            channels_to_try = ["chrome", "msedge", None]

            for channel in channels_to_try:
                try:
                    kwargs = {
                        "user_data_dir": str(settings.browser_profile_path),
                        "headless": headless,
                        "user_agent": settings.user_agent,
                        "viewport": {"width": 1280, "height": 850},
                        "args": ["--disable-blink-features=AutomationControlled"],
                    }
                    if channel:
                        kwargs["channel"] = channel
                    context = await p.chromium.launch_persistent_context(**kwargs)
                    logger.info(f"Launched browser context using channel: {channel or 'bundled chromium'}")
                    break
                except Exception as err:
                    last_err = err
                    logger.debug(f"Channel {channel} unavailable: {err}")
                    continue

            if context is None:
                msg = (
                    t('Failed to launch browser: {p0}. Make sure Google Chrome or Microsoft Edge is installed, or run: playwright install chromium', p0=last_err)
                )
                logger.error(msg)
                return False, {}, msg

            page = context.pages[0] if context.pages else await context.new_page()

            update_status(f"Navigating to ILIAS: {settings.ilias_base_url} ...")
            try:
                await page.goto(settings.ilias_base_url, wait_until="domcontentloaded")
            except Exception as nav_err:
                logger.warning(f"Initial navigation notice: {nav_err}")

            update_status(
                "Waiting for SWITCH edu-ID login to complete. "
                "Please log in via the opened browser window..."
            )

            captured_cookies: Dict[str, str] = {}
            authenticated = False

            while time.time() - start_time < timeout:
                active_pages = [p for p in context.pages if not p.is_closed()]
                if not active_pages:
                    await context.close()
                    return False, {}, t('Das Browser-Fenster wurde vor Abschluss des Logins geschlossen.')

                # Retrieve all cookies in context
                try:
                    cookies_list = await context.cookies()
                    cookies_dict = {c["name"]: c["value"] for c in cookies_list}
                except Exception:
                    await asyncio.sleep(0.5)
                    continue

                for p in active_pages:
                    try:
                        current_url = p.url.lower()
                    except Exception:
                        continue

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
                        if "PHPSESSID" in cookies_dict:
                            captured_cookies = cookies_dict
                            if "ilClientId" not in captured_cookies:
                                captured_cookies["ilClientId"] = settings.ilias_client_id

                            authenticated = True
                            break

                if authenticated:
                    break

                await asyncio.sleep(0.8)

            try:
                await context.close()
            except Exception:
                pass

            if not authenticated:
                return (
                    False,
                    {},
                    t('Authentication timed out after {p0} seconds without completing login.', p0=timeout)
                )

            # Save session cookies
            session_manager.save_cookies(
                captured_cookies,
                metadata={
                    "source": "playwright_browser_login",
                    "cookies_count": len(captured_cookies),
                }
            )

            update_status("Login successful! Session cookies captured and saved.")
            return True, captured_cookies, t('Login successful! Session cookies saved.')

    except Exception as e:
        err_msg = t('Browser login failed with error: {p0}', p0=str(e))
        logger.error(err_msg, exc_info=True)
        return False, {}, err_msg


def _sync_worker(
    headless: bool,
    timeout: int,
    progress_callback: Optional[callable] = None,
) -> Tuple[bool, Dict[str, str], str]:
    """
    Dedicated worker thread executor.
    Guarantees a ProactorEventLoop on Windows so asyncio.create_subprocess_exec works,
    even when uvicorn is running a SelectorEventLoop.
    """
    if sys.platform == "win32":
        loop = asyncio.ProactorEventLoop()
    else:
        loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(
            _async_login_impl(headless, timeout, progress_callback)
        )
    finally:
        loop.close()


async def run_browser_login(
    headless: Optional[bool] = None,
    timeout_seconds: Optional[int] = None,
    progress_callback: Optional[callable] = None,
) -> Tuple[bool, Dict[str, str], str]:
    """
    Launch a browser using Playwright, navigate to Uni Bern ILIAS,
    wait for user to complete SWITCH edu-ID login, and capture session cookies.
    
    Delegates to a worker thread with ProactorEventLoop to prevent NotImplementedError
    when running under uvicorn's WindowsSelectorEventLoop.
    
    Returns:
        (success, cookies_dict, status_message)
    """
    is_headless = settings.playwright_headless if headless is None else headless
    timeout = settings.playwright_timeout_seconds if timeout_seconds is None else timeout_seconds

    return await asyncio.to_thread(_sync_worker, is_headless, timeout, progress_callback)


def main():
    """CLI Entry point for python -m backend.auth.playwright_login or login.py"""
    print("\n" + "=" * 60)
    print("Uni Bern ILIAS - Browser Login Assistant")
    print("=" * 60)
    print("A browser window will open shortly.")
    print("Please select 'Universitaet Bern' and log in with your SWITCH edu-ID.")
    print("=" * 60 + "\n")

    success, cookies, message = _sync_worker(
        headless=False,
        timeout=settings.playwright_timeout_seconds
    )
    if success:
        print("\n SUCCESS: " + message)
        print(f"Captured {len(cookies)} cookies (PHPSESSID: {cookies.get('PHPSESSID', '')[:8]}...)")
        sys.exit(0)
    else:
        print("\n FAILED: " + message)
        sys.exit(1)


if __name__ == "__main__":
    main()
