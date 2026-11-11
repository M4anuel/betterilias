import { t, useLanguage } from '../lib/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { X, Puzzle, ExternalLink, Check, Copy } from 'lucide-react';

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
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (isOpen) {
      setCopied(null);
      setCopyFailed(false);
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

  const chromeGithubUrl = 'https://chromewebstore.google.com/detail/betterilias-companion/jpofcbijmjcndakhbbcnmedcdcfefiea';
  const firefoxGithubUrl = 'https://github.com/M4anuel/betterilias/tree/main/extensions/firefox';
  const currentGithubUrl = selectedBrowser === 'firefox' ? firefoxGithubUrl : chromeGithubUrl;

  const copyUrl = async (url: string) => {
    setCopied(null);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      setCopyFailed(true);
    }
  };
  const handleCopyUrl = () => { void copyUrl(currentGithubUrl); };
  const browserAddress = (url: string) => (
    <button type="button" onClick={() => { void copyUrl(url); }}
      aria-label={t("extension.setup.copy_address", { address: url })}
      className="my-1 inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 text-left text-[#033683] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 dark:border-slate-600 dark:bg-slate-800 dark:text-teal-300">
      <code className="select-text break-all text-[11px]">{url}</code>
      {copied === url ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : <Copy aria-hidden="true" className="h-4 w-4 shrink-0" />}
    </button>
  );

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

          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{selectedBrowser === 'firefox' && t('extension.setup.internal_pages')}</p>
          <p role="status" aria-live="polite" className="break-words text-xs text-slate-600 dark:text-slate-300">
            {copyFailed ? t("extension.setup.copy_failed") : copied ? t("Kopiert!") : ''}
          </p>
          {/* Steps */}
          <div className="space-y-2.5">
            {selectedBrowser === 'chrome' ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800/40">
                <p className="font-semibold">{t('extension.store.title')}</p>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{t('extension.store.hint')}</p>
                <a href={chromeGithubUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500">
                  {t('extension.store.open')}<ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
                </a>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0AACA5] font-bold text-white text-[11px]">
                    1
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 dark:text-white">{t("Firefox Add-on-Debugging öffnen")}</p>
                    <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                      {t("Öffne in Firefox")} {browserAddress("about:debugging#/runtime/this-firefox")} {t("in der Adressleiste (oder Menü ☰ > Weitere Werkzeuge > Entwickler-Werkzeuge > Dieses Firefox).")}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0AACA5] font-bold text-white text-[11px]">
                    2
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white">{t("Firefox-Erweiterung von GitHub laden")}</p>
                    <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5 mb-2">
                      {t("Lade den Ordner")} <code className="font-mono text-[10px] rounded bg-slate-200 px-1 py-0.5 dark:bg-slate-700">{t("extensions/firefox/")}</code> {t("von GitHub herunter oder clone das Repository:")}
                    </p>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                      <a
                        href={firefoxGithubUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-11 items-center gap-1.5 text-xs font-semibold text-[#0AACA5] hover:underline truncate"
                        title={t("Firefox-Erweiterung auf GitHub öffnen")}
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{t("github.com/M4anuel/betterilias/.../extensions/firefox")}</span>
                      </a>
                      <button
                        type="button"
                        onClick={handleCopyUrl}
                        className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition shrink-0 cursor-pointer"
                      >
                        {copied === currentGithubUrl ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-slate-400" />}
                        <span>{copied === currentGithubUrl ? t("Kopiert!") : t("Link kopieren")}</span>
                      </button>
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-2">
                      {t("Klicke in Firefox auf")} <strong>{t("„Temporäres Add-on laden...“")}</strong> {t("und wähle die Datei")} <code className="font-mono text-[10px]">{t("extensions/firefox/manifest.json")}</code> {t("aus.")}
                    </p>
                  </div>
                </div>
              </>
            )}

            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0AACA5] font-bold text-white text-[11px]">
                {selectedBrowser === 'chrome' ? 2 : 3}
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
            {selectedBrowser === 'firefox' && (<a
              href={currentGithubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
            >
              <span>{t('GitHub')}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>)}
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
