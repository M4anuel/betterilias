import { COMPANION_STORES } from '../lib/companionStores';
import { t, useLanguage } from '../lib/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { X, Puzzle, ExternalLink } from 'lucide-react';

interface ExtensionInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessSync?: () => void;
}

export const ExtensionInfoModal: React.FC<ExtensionInfoModalProps> = ({
  isOpen,
  onClose,
}) => {
  useLanguage();
  const isFirefoxDetected = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
  const [selectedBrowser, setSelectedBrowser] = useState<'chrome' | 'firefox'>(
    isFirefoxDetected ? 'firefox' : 'chrome'
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (isOpen) {
      const element = dialog.current;
      const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element?.showModal();
      return () => {
        element?.close();
        if (previousFocus?.isConnected) previousFocus.focus();
      };
    }
  }, [isOpen]);
  if (!isOpen) return null;

  return (
    <dialog ref={dialog} aria-labelledby="extension-info-title" onCancel={onClose} className="app-overlay fixed inset-0 m-0 h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-slate-900/60 p-4 backdrop-blur-xs open:flex">
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden dark:bg-slate-900 dark:border-slate-800">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-[#0AACA5] dark:bg-teal-950/60">
              <Puzzle className="h-5 w-5" />
            </div>
            <div>
              <h2 id="extension-info-title" className="text-sm font-bold text-slate-900 dark:text-white">{t("BetterIlias Companion")}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("Browser-Erweiterung für 1-Klick-Login")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("Schliessen")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 overflow-y-auto p-6 space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {t("Da wir die Anmeldung direkt im Browser abwickeln (ohne Server-Passwortweitergabe), verbindet die kleine Browser-Erweiterung deine bestehende ILIAS-Sitzung sicher mit BetterIlias. Wähle deinen Browser:")}
          </p>

          <p className="rounded-xl bg-teal-50 p-3 text-xs leading-relaxed text-teal-900 md:hidden dark:bg-teal-950 dark:text-teal-200">{t('connection.phone_hint')}</p>
          {/* Browser Selector Tabs */}
          <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setSelectedBrowser('chrome')}
              className={`min-h-11 flex-1 rounded-lg px-1 py-1.5 text-xs font-semibold transition cursor-pointer ${
                selectedBrowser === 'chrome'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {t("Chrome / Edge / Brave")}
            </button>
            <button
              type="button"
              onClick={() => setSelectedBrowser('firefox')}
              className={`min-h-11 flex-1 rounded-lg px-1 py-1.5 text-xs font-semibold transition cursor-pointer ${
                selectedBrowser === 'firefox'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {t("Mozilla Firefox")}
            </button>
          </div>

          {/* Steps */}
          <div className="space-y-2.5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800/40">
              <p className="font-semibold">{t('extension.store.title')}</p>
              <p className="mt-1 text-slate-600 dark:text-slate-300">{t(selectedBrowser === 'firefox' ? 'extension.store.firefox_hint' : 'extension.store.hint')}</p>
              <a href={COMPANION_STORES[selectedBrowser]} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500">
                {t(selectedBrowser === 'firefox' ? 'extension.store.firefox_open' : 'extension.store.open')}<ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
              </a>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0AACA5] font-bold text-white text-[11px]">
                2
              </span>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{t("Bei ILIAS einloggen & synchronisieren")}</p>
                <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                  {t("Logge dich auf")} <a href="https://ilias.unibe.ch" target="_blank" rel="noreferrer" className="text-[#0AACA5] underline">{t("ilias.unibe.ch")}</a> {t("ein und klicke im Browser auf das BetterIlias-Icon >")} <em>{t("Sitzung synchronisieren")}</em>.
                </p>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-800/80 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href="https://ilias.unibe.ch"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
            >
              <span>{t("ILIAS Login")}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <button
            onClick={onClose}
            className="min-h-11 rounded-xl bg-slate-200 px-4 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600 transition cursor-pointer"
          >
            {t("Schliessen")}
          </button>
        </div>
      </div>
    </dialog>
  );
};

export default ExtensionInfoModal;
