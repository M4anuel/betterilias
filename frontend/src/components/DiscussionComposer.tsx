import type { ReactNode, Ref } from 'react';
import { X } from 'lucide-react';
import { t } from '../lib/i18n';

/** Shared forum/community reply shell; the caller owns fields and draft state. */
export function DiscussionComposer({ title, children, actions, onCancel, disabled, cancelDisabled = disabled, containerRef }: {
  title: ReactNode; children: ReactNode; actions: ReactNode; onCancel: () => void;
  disabled?: boolean; cancelDisabled?: boolean; containerRef?: Ref<HTMLDivElement>;
}) {
  return <div ref={containerRef} className="forum-composer flex min-h-0 flex-col overflow-hidden border-t border-teal-300 dark:border-teal-800">
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
      <h3 className="min-w-0 flex-1 break-words text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
      <button type="button" disabled={cancelDisabled} onClick={onCancel} aria-label={t('forum.cancel_draft')} className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl hover:bg-slate-100 focus-visible:outline-2 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
    </div>
    <fieldset disabled={disabled} className="forum-reply-fields min-h-0 min-w-0 flex-1 overflow-y-auto p-3 disabled:opacity-70">
      <legend className="sr-only">{title}</legend>{children}
    </fieldset>
    <div className="forum-compose-actions flex shrink-0 justify-end border-t border-slate-200 px-3 py-2 dark:border-slate-700">{actions}</div>
  </div>;
}
