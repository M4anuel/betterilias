import { Pin, PinOff } from 'lucide-react';
import { useState } from 'react';
import { t } from '../lib/i18n';
import { SidebarPin, useSidebarPins } from '../lib/sidebarPins';

export function SidebarPinButton({ pin }: { pin: SidebarPin | null }) {
  const { pins, toggle, available } = useSidebarPins();
  const [failed, setFailed] = useState(false);
  if (!pin || !available) return null;
  const pinned = pins.some(p => p.id === pin.id);
  const label = t(pinned ? 'sidebar.unpin' : 'sidebar.pin', { title: pin.title });
  return <span className="relative inline-flex shrink-0"><button type="button" title={label} aria-label={label} aria-pressed={pinned}
    onClick={event => {
      event.stopPropagation();
      const saved = toggle(pin);
      setFailed(!saved);
      if (saved) {
        const menu = event.currentTarget.closest('details');
        menu?.removeAttribute('open');
        menu?.querySelector('summary')?.focus();
      }
    }}
    className="sidebar-pin-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-teal-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-teal-300 aria-pressed:text-teal-700 dark:aria-pressed:text-teal-300">
    {pinned ? <PinOff size={16} /> : <Pin size={16} />}
  </button>{failed && <span role="alert" className="absolute right-0 top-full z-30 w-52 rounded-lg border border-rose-300 bg-white p-2 text-xs text-rose-800 shadow-lg dark:border-rose-800 dark:bg-slate-900 dark:text-rose-200">{t('sidebar.save_error')}</span>}</span>;
}
