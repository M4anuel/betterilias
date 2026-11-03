import React from 'react';
import { RefreshCw } from 'lucide-react';
import { t } from '../lib/i18n';

/** One visible owner per page; placeholders and refresh controls stay static. */
export function SyncIndicator({ label = false, large = false }: { label?: boolean; large?: boolean }) {
  return <span data-ilias-sync-indicator role="status" aria-label={label ? undefined : t('Synchronisiere...')}
    className="inline-flex shrink-0 items-center gap-1.5">
    <RefreshCw aria-hidden="true" className={`${large ? 'h-7 w-7' : 'h-4 w-4'} motion-safe:animate-spin`} />
    {label && <span>{t('Synchronisiere...')}</span>}
  </span>;
}
