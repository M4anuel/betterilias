import type { ComponentPropsWithRef } from 'react';
import { LoaderCircle } from 'lucide-react';

const variants = {
  outline: 'border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800',
  ghost: 'border border-transparent hover:bg-slate-100 dark:hover:bg-slate-800',
  primary: 'border border-teal-800 bg-teal-800 text-white hover:bg-teal-900 dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950 dark:hover:bg-teal-300',
  danger: 'border border-rose-700 bg-rose-700 text-white hover:bg-rose-800 dark:border-rose-400 dark:bg-rose-400 dark:text-slate-950 dark:hover:bg-rose-300',
};

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: keyof typeof variants;
  size?: 'default' | 'icon';
  loading?: boolean;
};

/** Native semantics, shared touch/focus sizing; callers retain action ownership. */
export function Button({ variant = 'outline', size = 'default', loading = false, disabled, type = 'button', className = '', children, ...props }: ButtonProps) {
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading ? true : props['aria-busy']}
    className={`ui-button inline-flex max-w-full min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 disabled:cursor-wait disabled:opacity-60 ${size === 'icon' ? 'w-11 p-0' : 'px-3'} ${variants[variant]} ${className}`}>
    {loading && <LoaderCircle size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}{children}
  </button>;
}

export function IconButton({ label, children, ...props }: Omit<ButtonProps, 'size' | 'aria-label'> & { label: string }) {
  return <Button {...props} size="icon" aria-label={label}>{children}</Button>;
}
