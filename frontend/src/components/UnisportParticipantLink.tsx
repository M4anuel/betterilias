import { ExternalLink } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';
import { unisportParticipantsUrl } from '../lib/unisportOffers';

/** The official page owns its browser login and registration/access checks. */
export function UnisportParticipantLink({ offerUrl, showHint = true }: { offerUrl?: string | null; showHint?: boolean }) {
  useLanguage();
  const href = unisportParticipantsUrl(offerUrl);
  if (!href) return null;
  return <div className="min-w-0 space-y-1">
    <a href={href} target="_blank" rel="noopener noreferrer" className="relative inline-flex min-h-12 items-center gap-2 rounded-lg text-sm font-semibold text-teal-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 dark:text-teal-300">
      {t('unisport.participants')}<ExternalLink size={16} aria-hidden="true" /><span className="sr-only">{t('unisport.new_tab')}</span>
    </a>
    {showHint && <p className="text-xs text-slate-600 dark:text-slate-400">{t('unisport.participants_hint')}</p>}
  </div>;
}
