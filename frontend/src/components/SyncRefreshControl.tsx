import React from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { t } from '../lib/i18n';

export interface SyncRefreshControlProps {
  isSyncing: boolean;
  onRefresh?: () => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  title?: string;
  className?: string;
}

/**
 * An integrated state and reload control with morphing pill animation.
 *
 * Idle state:
 *   - Pill on the left with green checkmark and "Lokal bereitgestellt" text.
 *   - Separate circular reload button with subtle border slightly to the right.
 *
 * Syncing state:
 *   - The icon in that exact spot starts spinning immediately.
 *   - The pill transforms into a blue pill with the same text and smoothly
 *     expands to the right to enclose the circling reload button.
 *   - The button's separate boundary dissolves as it is now inside the blue pill.
 *
 * Finished state:
 *   - Smoothly transitions back to the initial idle state.
 */
export const SyncRefreshControl: React.FC<SyncRefreshControlProps> = ({
  isSyncing,
  onRefresh,
  disabled = false,
  label,
  ariaLabel,
  title,
  className = '',
}) => {
  const displayLabel = label || t('Lokal bereitgestellt');
  const buttonTitle = title || ariaLabel || t('Neu von ILIAS abrufen');
  const buttonAriaLabel = ariaLabel || title || t('Neu von ILIAS abrufen');

  return (
    <div
      className={`relative inline-flex items-center select-none ${className}`}
      role="status"
      aria-live="polite"
    >
      {/* Morphing Expanding Capsule Background */}
      <div
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 rounded-full transition-all duration-300 ease-out pointer-events-none motion-reduce:transition-none ${
          isSyncing
            ? 'w-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/80 shadow-2xs'
            : 'w-[calc(100%-2.375rem)] bg-slate-100 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80'
        }`}
      />

      {/* Pill Content (Left) */}
      <div
        className={`relative z-10 flex h-8 items-center gap-1.5 pl-3 pr-2 text-[11px] font-semibold transition-colors duration-300 motion-reduce:transition-none ${
          isSyncing
            ? 'text-blue-700 dark:text-blue-300'
            : 'text-slate-600 dark:text-slate-300'
        }`}
      >
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <Check
            className={`h-3.5 w-3.5 stroke-[2.5] transition-colors duration-300 motion-reduce:transition-none ${
              isSyncing ? 'text-blue-500 dark:text-blue-400' : 'text-emerald-500'
            }`}
          />
        </span>
        <span className="whitespace-nowrap">{displayLabel}</span>
      </div>

      {/* Spacing & Reload Button (Right) */}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled || isSyncing}
          aria-label={isSyncing ? t('Synchronisiere...') : buttonAriaLabel}
          title={isSyncing ? t('Synchronisiere...') : buttonTitle}
          className={`relative z-10 ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-teal-500 ${
            isSyncing
              ? 'border border-transparent bg-transparent text-blue-600 dark:text-blue-400 shadow-none cursor-default'
              : 'border border-slate-200/90 dark:border-slate-700/90 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/70 shadow-2xs cursor-pointer disabled:opacity-50'
          }`}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 transition-transform duration-300 motion-reduce:transition-none ${
              isSyncing ? 'motion-safe:animate-spin' : ''
            }`}
          />
        </button>
      )}
    </div>
  );
};
