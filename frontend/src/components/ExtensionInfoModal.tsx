import React, { useState } from 'react';
import { X, Puzzle, ExternalLink, Check, Copy, Key } from 'lucide-react';
import { api } from '../lib/api';

interface ExtensionInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessSync?: () => void;
}

export const ExtensionInfoModal: React.FC<ExtensionInfoModalProps> = ({
  isOpen,
  onClose,
  onSuccessSync,
}) => {
  const [copied, setCopied] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [phpsessid, setPhpsessid] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  if (!isOpen) return null;

  const extensionPath = 'c:\\Users\\manue\\OneDrive\\Dokumente\\_Uni\\IliasAlternative\\extension';

  const handleCopyPath = () => {
    navigator.clipboard.writeText(extensionPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phpsessid.trim()) return;

    setIsSubmitting(true);
    setManualError(null);
    try {
      const res = await api.setManualCookies(phpsessid.trim());
      if (res.success) {
        if (onSuccessSync) onSuccessSync();
        onClose();
      } else {
        setManualError('Konnte Cookies nicht speichern.');
      }
    } catch (err: any) {
      setManualError(err.message || 'Fehler beim Speichern der Cookies');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="flex w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden dark:bg-slate-900 dark:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-[#0AACA5] dark:bg-teal-950/60">
              <Puzzle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">BetterIlias Companion</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Browser-Erweiterung für 1-Klick-Login</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Da wir die Anmeldung direkt im Browser abwickeln (ohne Server-Passwortweitergabe), verbindet die kleine Browser-Erweiterung deine bestehende ILIAS-Sitzung sicher mit BetterIlias:
          </p>

          {/* Steps */}
          <div className="space-y-2.5">
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0AACA5] font-bold text-white text-[11px]">
                1
              </span>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Erweiterungsverwaltung öffnen</p>
                <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                  Öffne in Chrome <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[10px] dark:bg-slate-700">chrome://extensions</code> und aktiviere oben rechts den <strong>Entwicklermodus</strong>.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0AACA5] font-bold text-white text-[11px]">
                2
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 dark:text-white">„Entpackte Erweiterung laden“</p>
                <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5 mb-1.5">
                  Klicke auf den Button und wähle den Ordner <code className="font-mono text-[10px]">extension/</code> aus:
                </p>
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-mono text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <span className="truncate flex-1">{extensionPath}</span>
                  <button
                    type="button"
                    onClick={handleCopyPath}
                    className="flex items-center gap-1 text-[10px] font-sans font-bold text-[#0AACA5] hover:underline shrink-0 cursor-pointer"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copied ? 'Kopiert!' : 'Kopieren'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0AACA5] font-bold text-white text-[11px]">
                3
              </span>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Bei ILIAS einloggen & synchronisieren</p>
                <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                  Logge dich auf <a href="https://ilias.unibe.ch" target="_blank" rel="noreferrer" className="text-[#0AACA5] underline">ilias.unibe.ch</a> ein und klicke im Browser auf das BetterIlias-Icon &gt; <em>Sitzung synchronisieren</em>.
                </p>
              </div>
            </div>
          </div>

          {/* Collapsible Manual Cookie Input */}
          <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowManual(!showManual)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1.5 cursor-pointer"
            >
              <Key className="h-3.5 w-3.5" />
              <span>{showManual ? 'Manuelle Eingabe verbergen' : 'Alternativ: PHPSESSID manuell eintragen'}</span>
            </button>

            {showManual && (
              <form onSubmit={handleManualSubmit} className="mt-3 space-y-2">
                <input
                  type="text"
                  value={phpsessid}
                  onChange={(e) => setPhpsessid(e.target.value)}
                  placeholder="PHPSESSID Cookie aus DevTools..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 placeholder-slate-400 focus:border-[#0AACA5] focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
                {manualError && (
                  <p className="text-[11px] text-red-600 dark:text-red-400">{manualError}</p>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting || !phpsessid.trim()}
                  className="rounded-xl bg-[#0AACA5] px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
                >
                  {isSubmitting ? 'Speichere...' : 'Cookie speichern'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-3 dark:border-slate-800 dark:bg-slate-850">
          <a
            href="https://ilias.unibe.ch"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <span>ILIAS Login öffnen</span>
            <ExternalLink className="h-3 w-3" />
          </a>
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-200 px-4 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600 transition cursor-pointer"
          >
            Schliessen
          </button>
        </div>
      </div>
    </div>
  );
};

