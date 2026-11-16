import type { ComponentPropsWithRef, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { t, useLanguage } from '../../lib/i18n';
import { IconButton } from './Button';

const tones = {
  success: { icon: CheckCircle2, style: 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100' },
  warning: { icon: TriangleAlert, style: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100' },
  error: { icon: AlertCircle, style: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200' },
  info: { icon: Info, style: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100' },
};

type Props = Omit<ComponentPropsWithRef<'div'>, 'title' | 'children'> & {
  tone?: keyof typeof tones; title?: ReactNode; message: ReactNode;
  actions?: ReactNode; onDismiss?: () => void;
};

/** Presentation only: no authentication, automatic retries, timers or write replay. */
export function FeedbackBanner({ tone = 'success', title, message, actions, onDismiss, className = '', role, ...props }: Props) {
  useLanguage();
  const { icon: Icon, style } = tones[tone];
  return <div {...props} data-feedback-banner={tone} role={role || (tone === 'error' ? 'alert' : 'status')}
    className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${style} ${className}`}>
    <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
    <div className="min-w-0 flex-1 break-words">{title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{message}</div>
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
    {onDismiss && <IconButton label={t('Schliessen')} variant="ghost" onClick={onDismiss}><X size={18} aria-hidden="true" /></IconButton>}
  </div>;
}
