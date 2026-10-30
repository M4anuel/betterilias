"""Intrinsic sizing in a real Chromium action popup, not an ordinary tab."""
import base64
import json
import os
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in installed extension checks')


@pytest.mark.parametrize('language,scheme', [('de','dark'), ('en','light')])
@pytest.mark.parametrize('scale', [1, 2])
def test_actual_action_popup_keeps_readable_width(tmp_path, language, scheme, scale):
    pw=pytest.importorskip('playwright.sync_api')
    # Firefox uses the exact same markup/styles; native Firefox toolbar sizing
    # still needs manual verification. Chromium cannot load its Gecko manifest.
    assert (ROOT/'extension/popup.html').read_bytes()==(ROOT/'extension-firefox/popup.html').read_bytes()
    with pw.sync_playwright() as p:
        context=p.chromium.launch_persistent_context(str(tmp_path/'profile'),channel='chromium',headless=True,
            color_scheme=scheme,args=[f'--disable-extensions-except={ROOT/"extension"}',f'--load-extension={ROOT/"extension"}'])
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            worker.evaluate('(language)=>chrome.storage.local.set({language})',language)
            worker.evaluate('chrome.action.openPopup()')
            driver=context.pages[0]
            cdp=context.new_cdp_session(driver)
            targets=cdp.send('Target.getTargets')['targetInfos']
            target=next(target for target in targets if target['url'].endswith('/popup.html'))
            session=cdp.send('Target.attachToTarget',dict(targetId=target['targetId'],flatten=False))['sessionId']
            replies={}
            def receive(event):
                message=json.loads(event['message'])
                if event['sessionId']==session and 'id' in message:replies[message['id']]=message
            cdp.on('Target.receivedMessageFromTarget',receive)
            sequence=0
            def send(method,params=None):
                nonlocal sequence
                sequence+=1
                identifier=sequence
                cdp.send('Target.sendMessageToTarget',dict(sessionId=session,message=json.dumps(dict(id=identifier,method=method,params=params or {}))))
                deadline=time.monotonic()+10
                while identifier not in replies and time.monotonic()<deadline:
                    driver.wait_for_timeout(10)
                assert identifier in replies, f'Popup CDP command timed out: {method}'
                reply=replies.pop(identifier)
                assert 'error' not in reply, reply
                return reply['result']
            def evaluate(expression):
                result=send('Runtime.evaluate',dict(expression=expression,awaitPromise=True,returnByValue=True))
                assert 'exceptionDetails' not in result, result
                return result['result'].get('value')
            # CSS magnification exercises Chromium's actual intrinsic popup
            # resizing. It is distinct from a browser-tab zoom simulation.
            evaluate(f'document.documentElement.style.zoom={scale}')
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                metrics=evaluate('''(()=>{
                  const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
                  return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,
                    body:box('body'),header:box('h1'),badge:box('#ilias-status-badge'),login:box('#login-btn'),
                    status:document.querySelector('#ilias-status-badge').className,
                    headerLine:parseFloat(getComputedStyle(document.querySelector('h1')).lineHeight),
                    badgeLine:parseFloat(getComputedStyle(document.querySelector('#ilias-status-badge')).fontSize)};
                })()''')
                if metrics['status'].endswith('badge-danger') and metrics['width']>=380*scale-1:break
                driver.wait_for_timeout(20)
            assert 380*scale-1<=metrics['body']['width']<=380*scale+1
            assert metrics['scroll']<=metrics['width']+1
            assert metrics['header']['height']<=metrics['headerLine']*scale+1
            assert metrics['badge']['height']<25*scale
            assert metrics['login']['width']>=340*scale and metrics['login']['height']>=48*scale
            # Even in the vertically constrained magnified window, login is reachable.
            evaluate("document.querySelector('#login-btn').scrollIntoView({block:'nearest'})")
            shot=send('Page.captureScreenshot')
            (ROOT/f'.pytest_cache/native-popup-{language}-{scheme}-{scale}x.png').write_bytes(base64.b64decode(shot['data']))
        finally:
            context.close()
