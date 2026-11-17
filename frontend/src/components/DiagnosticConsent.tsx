import { useState } from 'react';
import { DialogShell } from './ui/DialogShell';
import { FeedbackBanner } from './ui/FeedbackBanner';
import { Button } from './ui/Button';
import { t, useLanguage } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';
import { clearDiagnosticNotice, decideDiagnostic, dismissDiagnostic, useDiagnosticConsent } from '../lib/diagnosticReports';

export function DiagnosticConsent() {
  useLanguage();
  const state = useDiagnosticConsent();
  const [shareUpstream, setShareUpstream] = useState(true);

  if (!state.capture) {
    return state.saved ? (
      <FeedbackBanner
        message={t('reports.saved')}
        onDismiss={clearDiagnosticNotice}
        className="fixed bottom-5 left-1/2 z-[70] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 shadow-lg"
      />
    ) : null;
  }

  const isSelfHosted = Boolean(state.capture.disclosure.self_hosted);
  const canShareUpstream = Boolean(state.capture.disclosure.can_share_upstream);
  const appVersion = state.capture.disclosure.app_version || '1.0.0';

  return (
    <DialogShell
      titleId="diagnostic-consent-title"
      title={t('reports.prompt_title')}
      aria-describedby="diagnostic-consent-description"
      closeDisabled={state.busy}
      onRequestClose={dismissDiagnostic}
      size="small"
      footer={
        <>
          {state.error && (
            <p role="alert" className="mb-3 text-sm text-amber-700 dark:text-amber-300">
              {t(state.error as TranslationKey)}
            </p>
          )}
          {state.busy && <p role="status" className="mb-3 text-sm">{t('reports.sending')}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button autoFocus disabled={state.busy} onClick={dismissDiagnostic}>
              {t('reports.no')}
            </Button>
            <Button disabled={state.busy} onClick={() => void decideDiagnostic('once', canShareUpstream && shareUpstream)}>
              {t('reports.once')}
            </Button>
            <Button
              disabled={state.busy}
              className="col-span-2 sm:col-span-1"
              onClick={() => void decideDiagnostic('always', canShareUpstream && shareUpstream)}
            >
              {t('reports.always')}
            </Button>
          </div>
        </>
      }
    >
      <div tabIndex={0} role="region" aria-label={t('reports.details')} className="min-h-0">
        {isSelfHosted && (
          <div className="mt-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800">
              {t('reports.self_hosted_badge')} · v{appVersion}
            </span>
          </div>
        )}

        <p id="diagnostic-consent-description" className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {t('reports.prompt_intro')}
        </p>
        <p className="mt-3 text-sm leading-relaxed">
          {t('reports.operator', { name: state.capture.disclosure.operator_name || t('reports.local_operator') })}
        </p>

        {canShareUpstream && (
          <label className="mt-3.5 flex items-start gap-2.5 rounded-lg border border-teal-200/80 dark:border-teal-900/80 bg-teal-50/60 dark:bg-teal-950/30 p-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={shareUpstream}
              onChange={(e) => setShareUpstream(e.target.checked)}
              disabled={state.busy}
              className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
            />
            <span className="text-slate-700 dark:text-slate-300 leading-snug">
              <strong className="block font-semibold text-teal-900 dark:text-teal-200">
                {t('reports.share_with_betterilias')}
              </strong>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                {t('reports.share_with_betterilias_hint', { version: appVersion })}
              </span>
            </span>
          </label>
        )}

        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {t('reports.pending_hint')}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <li>{t('reports.included')}</li>
          <li>{t('reports.excluded')}</li>
          <li>{t('reports.retention')}</li>
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {t('reports.preference_hint')}
        </p>
        {state.capture.disclosure.privacy_url && (
          <a
            href={state.capture.disclosure.privacy_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-teal-700 underline dark:text-teal-300"
          >
            {t('reports.privacy_notice')}
          </a>
        )}
        <p className="mt-3 break-all font-mono text-xs text-slate-500 dark:text-slate-400">
          {t('reports.code', { code: state.capture.code })}
        </p>
      </div>
    </DialogShell>
  );
}
