import { DialogShell } from './ui/DialogShell';
import { FeedbackBanner } from './ui/FeedbackBanner';
import { Button } from './ui/Button';
import { t, useLanguage } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';
import { clearDiagnosticNotice, decideDiagnostic, dismissDiagnostic, useDiagnosticConsent } from '../lib/diagnosticReports';

export function DiagnosticConsent() {
  useLanguage();
  const state = useDiagnosticConsent();
  if (!state.capture) return state.saved ? <FeedbackBanner message={t('reports.saved')} onDismiss={clearDiagnosticNotice}
    className="fixed bottom-5 left-1/2 z-[70] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 shadow-lg" /> : null;
  return <DialogShell titleId="diagnostic-consent-title" title={t('reports.prompt_title')} aria-describedby="diagnostic-consent-description"
    closeDisabled={state.busy} onRequestClose={dismissDiagnostic} size="small"
    footer={<>
      {state.error && <p role="alert" className="mb-3 text-sm text-amber-700 dark:text-amber-300">{t(state.error as TranslationKey)}</p>}
      {state.busy && <p role="status" className="mb-3 text-sm">{t('reports.sending')}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Button autoFocus disabled={state.busy} onClick={dismissDiagnostic}>{t('reports.no')}</Button>
        <Button disabled={state.busy} onClick={() => void decideDiagnostic('once')}>{t('reports.once')}</Button>
        <Button disabled={state.busy} className="col-span-2 sm:col-span-1" onClick={() => void decideDiagnostic('always')}>{t('reports.always')}</Button>
      </div>
    </>}>
    <div tabIndex={0} role="region" aria-label={t('reports.details')} className="min-h-0">
    <p id="diagnostic-consent-description" className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('reports.prompt_intro')}</p>
    <p className="mt-3 text-sm leading-relaxed">{t('reports.operator', { name: state.capture.disclosure.operator_name || t('reports.local_operator') })}</p>
    <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('reports.pending_hint')}</p>
    <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300"><li>{t('reports.included')}</li><li>{t('reports.excluded')}</li><li>{t('reports.retention')}</li></ul>
    <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('reports.preference_hint')}</p>
    {state.capture.disclosure.privacy_url && <a href={state.capture.disclosure.privacy_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-teal-700 underline dark:text-teal-300">{t('reports.privacy_notice')}</a>}
    <p className="mt-3 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{t('reports.code', { code: state.capture.code })}</p>
    </div>
  </DialogShell>;
}
