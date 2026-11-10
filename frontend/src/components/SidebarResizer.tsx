import { useRef, useState } from 'react';
import { t } from '../lib/i18n';

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_COLLAPSE_WIDTH = 180;

export function SidebarResizer({ width, collapsed, maximum, onResize }: {
  width: number; collapsed: boolean; maximum: number; onResize: (width: number, save: boolean) => void;
}) {
  const dragging = useRef(false);
  const [active, setActive] = useState(false);
  const finish = () => { dragging.current = false; setActive(false); };
  return <div role="separator" aria-orientation="vertical" aria-label={t('sidebar.resize')}
    aria-valuemin={64} aria-valuemax={maximum} aria-valuenow={collapsed ? 64 : width}
    title={t('sidebar.resize_hint')} tabIndex={0}
    className={`sidebar-resizer absolute inset-y-0 -right-2 z-20 w-4 cursor-col-resize touch-none select-none ${active ? 'is-resizing' : ''}`}
    onPointerDown={event => {
      if (event.button !== 0) return;
      dragging.current = true; setActive(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }}
    onPointerMove={event => { if (dragging.current) onResize(event.clientX, false); }}
    onPointerUp={event => {
      if (!dragging.current) return;
      onResize(event.clientX, true);
      finish();
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => onResize(256, true)}
    onKeyDown={event => {
      let next: number;
      if (event.key === 'ArrowLeft') next = collapsed ? 64 : width <= SIDEBAR_MIN_WIDTH ? SIDEBAR_COLLAPSE_WIDTH - 1 : width - 16;
      else if (event.key === 'ArrowRight') next = collapsed ? SIDEBAR_MIN_WIDTH : width + 16;
      else if (event.key === 'Home') next = 64;
      else if (event.key === 'End') next = maximum;
      else return;
      event.preventDefault(); onResize(next, true);
    }} />;
}
