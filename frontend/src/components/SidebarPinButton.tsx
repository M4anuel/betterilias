import { Pin, PinOff } from 'lucide-react';
import { useState } from 'react';
import { t } from '../lib/i18n';
import { SidebarPin, useSidebarPins } from '../lib/sidebarPins';
import { confirmDialog } from '../lib/dialog';
import { cache } from '../lib/cache';

export function SidebarPinButton({ pin, sidebar = false }: { pin: SidebarPin | null; sidebar?: boolean }) {
  const { pins, toggle, remove, available } = useSidebarPins();
  const [failed, setFailed] = useState(false);
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  if (!pin || !available) return null;
  const pinned = pins.some(p => p.id === pin.id);
  const label = t(pinned ? 'sidebar.unpin' : 'sidebar.pin', { title: pin.title });
  const HoverIcon = pinned ? PinOff : Pin;
  return <span className="relative inline-flex shrink-0"><button type="button" title={label} aria-label={label} aria-pressed={pinned}
    data-pin-hover-suppressed={hoverSuppressed || undefined}
    onPointerLeave={() => setHoverSuppressed(false)} onBlur={() => setHoverSuppressed(false)}
    onClick={async event => {
      event.stopPropagation();
      const button = event.currentTarget;
      if (sidebar) {
        const account = cache.getSessionId();
        const confirmed = await confirmDialog({
          title: t('sidebar.remove_title'),
          message: t('sidebar.remove_message', { title: pin.title }),
          confirmLabel: t('sidebar.remove_confirm'),
          variant: 'warning',
        });
        if (!confirmed || account !== cache.getSessionId() || !button.isConnected) return;
      }
      const saved = sidebar ? remove(pin) : toggle(pin);
      setFailed(!saved);
      if (saved) {
        // After unpinning, show the saved grey state until the next hover/focus.
        setHoverSuppressed(pinned);
        if (sidebar) button.closest('[data-sidebar-course]')?.querySelector<HTMLButtonElement>('button')?.focus();
        const menu = button.closest('details');
        menu?.removeAttribute('open');
        menu?.querySelector('summary')?.focus();
      }
    }}
    className={`sidebar-pin-button inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${sidebar ? 'text-slate-500 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}>
    <Pin className="pin-icon-rest" size={sidebar ? 12 : 16} strokeWidth={sidebar ? 1.5 : 2} aria-hidden="true" />
    <HoverIcon className="pin-icon-hover" size={sidebar ? 12 : 16} strokeWidth={sidebar ? 1.5 : 2} aria-hidden="true" />
  </button>{failed && <span role="alert" className="absolute right-0 top-full z-30 w-52 rounded-lg border border-rose-300 bg-white p-2 text-xs text-rose-800 shadow-lg dark:border-rose-800 dark:bg-slate-900 dark:text-rose-200">{t('sidebar.save_error')}</span>}</span>;
}
