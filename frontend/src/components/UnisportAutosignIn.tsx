import { useId } from 'react';
import { t } from '../lib/i18n';
import { Button } from './ui/Button';

export function UnisportAutosignIn({ active, toggle }: { active: boolean; toggle: () => void }) {
  const description = useId();
  return <Button variant="ghost" aria-label={t('unisport.autosign_in')} aria-pressed={active} aria-describedby={description} onClick={toggle}
    className="relative w-full !gap-1 !rounded-none !px-1">
    <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
      {active && <svg className="unisport-autosign-success size-4" viewBox="0 0 26 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path className="unisport-autosign-ring" pathLength="1" d="M13.74 2.15 A10 10 0 1 0 21.86 10.26" />
        <path className="unisport-autosign-check" pathLength="1" d="M6.8 12.2 L10.6 16 L23.3 3.4" />
      </svg>}
    </span>
    <span className="min-w-0">
      {t('unisport.autosign_in')}
      <span className="block text-[11px] leading-tight text-slate-600 dark:text-slate-300"
        title={t('unisport.autosign_preview_hint')}>{t('unisport.autosign_preview')}</span>
      <span id={description} className="sr-only">{t('unisport.autosign_preview_hint')}</span>
    </span>
  </Button>;
}
