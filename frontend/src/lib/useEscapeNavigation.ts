import { useEffect, useRef } from 'react';

export const ESCAPE_OVERVIEW_INTERVAL_MS = 700;

function visible(element: Element): boolean {
  if (element.closest('details:not([open]), dialog:not([open]), [hidden]')) return false;
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility()) return false;
  const style = getComputedStyle(element);
  return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function escapeBelongsToControl(event: KeyboardEvent): boolean {
  if (document.fullscreenElement || document.pointerLockElement) return true;
  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]')) return true;
  return Array.from(document.querySelectorAll(
    'dialog[open], [role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], .app-overlay, [data-escape-scope], [popover], [class*="fixed"][class*="inset-0"][class*="z-"]'
  )).some(visible);
}

export function useEscapeNavigation(onBack: () => Promise<boolean>, onOverview: () => Promise<boolean>) {
  const callbacks = useRef({ onBack, onOverview });
  callbacks.current = { onBack, onOverview };
  useEffect(() => {
    let lastEscape = -Infinity;
    let pending = Promise.resolve(true);
    let disposed = false;
    const timers = new Set<number>();
    const bubbled = new WeakSet<KeyboardEvent>();
    const recordBubbling = (event: KeyboardEvent) => { bubbled.add(event); };
    const resetSequence = () => { lastEscape = -Infinity; };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') { resetSequence(); return; }
      // Snapshot before a dialog's own listener removes its DOM or exits fullscreen.
      if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
          || event.defaultPrevented || escapeBelongsToControl(event)) {
        lastEscape = -Infinity;
        return;
      }
      const timestamp = performance.now();
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        // Run after all event listeners; custom controls may consume Escape later.
        if (disposed || !bubbled.has(event) || event.defaultPrevented || escapeBelongsToControl(event)) { lastEscape = -Infinity; return; }
        const overview = timestamp - lastEscape <= ESCAPE_OVERVIEW_INTERVAL_MS;
        lastEscape = timestamp;
        pending = pending.then(async previousAllowed => {
          if (disposed || (overview && !previousAllowed)) return false;
          const allowed = await (overview ? callbacks.current.onOverview() : callbacks.current.onBack());
          if (!allowed) lastEscape = -Infinity;
          return allowed;
        }).catch(error => { lastEscape = -Infinity; console.error('Escape navigation failed', error); return false; });
      }, 0);
      timers.add(timer);
    };
    window.addEventListener('keydown', handleKey, true);
    window.addEventListener('keydown', recordBubbling);
    window.addEventListener('pointerdown', resetSequence, true);
    window.addEventListener('blur', resetSequence);
    document.addEventListener('fullscreenchange', resetSequence);
    document.addEventListener('pointerlockchange', resetSequence);
    return () => {
      disposed = true;
      timers.forEach(timer => window.clearTimeout(timer));
      window.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('keydown', recordBubbling);
      window.removeEventListener('pointerdown', resetSequence, true);
      window.removeEventListener('blur', resetSequence);
      document.removeEventListener('fullscreenchange', resetSequence);
      document.removeEventListener('pointerlockchange', resetSequence);
    };
  }, []);
}
