import type { ComponentPropsWithoutRef } from 'react';
import type { LucideIcon } from 'lucide-react';

const tones = {
  neutral: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  success: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-200',
  danger: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200',
};

export type BadgeTone = keyof typeof tones;

/** Static metadata, deliberately outside the live-region/notification system. */
export function Badge({ tone = 'neutral', icon: Icon, className = '', children, ...props }: ComponentPropsWithoutRef<'span'> & { tone?: BadgeTone; icon?: LucideIcon }) {
  return <span {...props} className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-5 ${tones[tone]} ${className}`}>
    {Icon && <Icon size={15} className="shrink-0" aria-hidden="true" />}<span className="min-w-0 break-words">{children}</span>
  </span>;
}
