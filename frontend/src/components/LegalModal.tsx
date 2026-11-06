import { t, useLanguage } from '../lib/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { X, ShieldCheck, Scale, ExternalLink, Mail, Server, Database, Lock, Info } from 'lucide-react';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'imprint' | 'privacy';
}

export const LegalModal: React.FC<LegalModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'imprint',
}) => {
  useLanguage();
  const [activeTab, setActiveTab] = useState<'imprint' | 'privacy'>(initialTab);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      const element = dialog.current;
      const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element?.showModal();
      return () => {
        element?.close();
        if (previousFocus?.isConnected) previousFocus.focus();
      };
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="legal-modal-title"
      onCancel={onClose}
      className="app-overlay fixed inset-0 m-0 h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-slate-900/60 p-4 backdrop-blur-xs open:flex"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden dark:bg-slate-900 dark:border-slate-800">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-[#0AACA5] dark:bg-teal-950/60 shadow-2xs">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h2 id="legal-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                {activeTab === 'imprint' ? t("legal.imprint_title") : t("legal.privacy_title")}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("legal.modal_subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
            aria-label={t("Schliessen")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-100 px-6 pt-3 bg-white dark:bg-slate-900 dark:border-slate-800">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('imprint')}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-bold transition cursor-pointer ${
                activeTab === 'imprint'
                  ? 'border-[#0AACA5] text-[#0AACA5]'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Info className="h-3.5 w-3.5" />
              <span>{t("Impressum")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('privacy')}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-bold transition cursor-pointer ${
                activeTab === 'privacy'
                  ? 'border-[#0AACA5] text-[#0AACA5]'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{t("Datenschutz")}</span>
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {activeTab === 'imprint' ? (
            <div className="space-y-5">
              {/* Operator */}
              <div className="space-y-1.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4 border border-slate-100 dark:border-slate-700/80">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t("legal.operator_heading")}
                </h3>
                <p className="font-semibold text-slate-900 dark:text-white">
                  BetterIlias Project
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  {t("legal.operator_desc")}
                </p>
                <div className="pt-2 flex flex-wrap gap-4 text-slate-700 dark:text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-[#0AACA5]" />
                    <span>manuel@betterilias.ch</span>
                  </div>
                  <a
                    href="https://github.com/M4anuel/betterilias"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-teal-600 dark:text-teal-400 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>GitHub: M4anuel/betterilias</span>
                  </a>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5 text-amber-500" />
                  <span>{t("legal.disclaimer_heading")}</span>
                </h3>
                <p className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3.5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  {t("legal.disclaimer_desc")}
                </p>
              </div>

              {/* Liability for links and contents */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  {t("legal.liability_heading")}
                </h3>
                <p>{t("legal.liability_desc")}</p>
              </div>

              {/* Copyright */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  {t("legal.license_heading")}
                </h3>
                <p>{t("legal.license_desc")}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Privacy Overview Card */}
              <div className="rounded-2xl bg-teal-50/60 dark:bg-teal-950/30 p-4 border border-teal-100 dark:border-teal-900/60 space-y-2">
                <div className="flex items-center gap-2 text-teal-800 dark:text-teal-300 font-bold text-xs">
                  <ShieldCheck className="h-4 w-4 text-[#0AACA5]" />
                  <span>{t("legal.privacy_overview_badge")}</span>
                </div>
                <p className="text-teal-900 dark:text-teal-200 text-xs">
                  {t("legal.privacy_overview_desc")}
                </p>
              </div>

              {/* 1. Controller */}
              <div className="space-y-1.5">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 text-[#0AACA5]" />
                  <span>{t("legal.privacy_controller_heading")}</span>
                </h3>
                <p>{t("legal.privacy_controller_desc")}</p>
              </div>

              {/* 2. Processed Data */}
              <div className="space-y-1.5">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-[#0AACA5]" />
                  <span>{t("legal.privacy_data_heading")}</span>
                </h3>
                <p>{t("legal.privacy_data_desc")}</p>
                <ul className="list-disc list-inside space-y-1 pl-1 text-slate-600 dark:text-slate-400">
                  <li>{t("legal.privacy_data_point1")}</li>
                  <li>{t("legal.privacy_data_point2")}</li>
                  <li>{t("legal.privacy_data_point3")}</li>
                  <li>{t("legal.privacy_data_point4")}</li>
                  <li>{t("legal.privacy_data_point5")}</li>
                </ul>
              </div>

              {/* 3. Cookies & Local Storage */}
              <div className="space-y-1.5">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-[#0AACA5]" />
                  <span>{t("legal.privacy_cookies_heading")}</span>
                </h3>
                <p>{t("legal.privacy_cookies_desc")}</p>
              </div>

              {/* 4. Server Location & Security */}
              <div className="space-y-1.5">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-[#0AACA5]" />
                  <span>{t("legal.privacy_security_heading")}</span>
                </h3>
                <p>{t("legal.privacy_security_desc")}</p>
              </div>

              {/* 5. User Rights */}
              <div className="space-y-1.5">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5 text-[#0AACA5]" />
                  <span>{t("legal.privacy_rights_heading")}</span>
                </h3>
                <p>{t("legal.privacy_rights_desc")}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-slate-50/60 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-800/40 text-[11px] text-slate-500">
          <span>{t("legal.jurisdiction_notice")}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold hover:bg-slate-300 dark:hover:bg-slate-600 transition cursor-pointer"
          >
            {t("Schliessen")}
          </button>
        </div>
      </div>
    </dialog>
  );
};

