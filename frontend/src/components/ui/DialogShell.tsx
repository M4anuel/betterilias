import { useId, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { X } from 'lucide-react';
import { t, useLanguage } from '../../lib/i18n';
import { IconButton } from './Button';

type Props = Omit<ComponentPropsWithoutRef<'dialog'>, 'open' | 'title' | 'onCancel' | 'onClose'> & {
  open?: boolean; title: ReactNode; titleId?: string; description?: ReactNode;
  headerMeta?: ReactNode; dismissOnBackdrop?: boolean;
  onRequestClose: () => void; closeDisabled?: boolean; closeLabel?: string;
  footer?: ReactNode; size?: 'small' | 'medium' | 'large';
  bodyClassName?: string; ref?: Ref<HTMLDialogElement>;
};
const sizes = { small: 'max-w-lg', medium: 'max-w-2xl', large: 'max-w-4xl' };

/** Native modal lifecycle; the caller owns drafts, pending work and close guards. */
export function DialogShell({ open = true, title, titleId, description, headerMeta, dismissOnBackdrop = false,
  onRequestClose, closeDisabled = false, closeLabel, footer, size = 'medium', bodyClassName = '',
  className = '', children, ref, onPointerDown, onClick, ...props }: Props) {
  useLanguage();
  const generatedId = useId();
  const headingId = titleId || generatedId;
  const descriptionId = `${generatedId}-description`;
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  useImperativeHandle(ref, () => dialog.current!, []);
  useLayoutEffect(() => {
    const element = dialog.current!;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
    // Close before React removes the node so native focus restoration still runs.
    return () => { if (element.open) element.close(); };
  }, [open]);
  return <dialog {...props} ref={dialog} {...{ closedby: closeDisabled ? 'none' : 'closerequest' }} aria-labelledby={headingId}
    aria-describedby={props['aria-describedby'] || (description ? descriptionId : undefined)}
    onCancel={event => { event.preventDefault(); if (!closeDisabled) onRequestClose(); }}
    onPointerDown={event => {
      pressedBackdrop.current = false;
      onPointerDown?.(event);
      if (!dismissOnBackdrop || event.defaultPrevented || event.target !== event.currentTarget || event.button !== 0) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      pressedBackdrop.current = event.clientX < bounds.left || event.clientX >= bounds.right ||
        event.clientY < bounds.top || event.clientY >= bounds.bottom;
    }}
    onClick={event => {
      const startedOutside = pressedBackdrop.current;
      pressedBackdrop.current = false;
      onClick?.(event);
      if (!startedOutside || closeDisabled || event.defaultPrevented || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX >= bounds.right ||
          event.clientY < bounds.top || event.clientY >= bounds.bottom) onRequestClose();
    }}
    className={`ui-dialog m-auto w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/60 open:flex open:flex-col dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${sizes[size]} ${className}`}>
    <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 p-4 sm:p-5 dark:border-slate-700">
      <div className="min-w-0 flex-1"><h2 id={headingId} className="break-words text-lg font-bold">{title}</h2>
        {description && <p id={descriptionId} className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">{description}</p>}
        {headerMeta}
      </div>
      <IconButton variant="ghost" label={closeLabel || t('Schliessen')} disabled={closeDisabled} onClick={onRequestClose}><X size={20} aria-hidden="true" /></IconButton>
    </header>
    <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
    {footer && <footer className="shrink-0 border-t border-slate-200 p-4 dark:border-slate-700">{footer}</footer>}
  </dialog>;
}
