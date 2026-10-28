import { t, useLanguage } from '../lib/i18n';
import React, { useState } from 'react';
import { Menu, CheckCircle2, AlertCircle } from 'lucide-react';
import { AuthStatus } from '../types';
import { SettingsGear } from './SettingsGear';
import { SettingsDropdown } from './SettingsDropdown';

interface HeaderProps {
  authStatus: AuthStatus | null;
  onHomeClick: () => void;
  onToggleSidebar: () => void;
  isSidebarCollapsed: boolean;
  onLogout?: () => void;
  onOpenExtensionInfo: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  authStatus,
  onHomeClick,
  onToggleSidebar,
  isSidebarCollapsed,
  onLogout,
  onOpenExtensionInfo,
}) => {
  useLanguage();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [gearRotation, setGearRotation] = useState(0);
  const toggleSettings = () => {
    setGearRotation(angle => angle + 180);
    setIsSettingsOpen(open => !open);
  };

  return (
    <header className="sticky top-0 z-40 flex min-h-16 shrink-0 w-full items-center justify-between border-b border-slate-200 bg-white/90 px-2 sm:px-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 transition-colors">
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={onToggleSidebar}
          aria-label={t("Sidebar umschalten")}
          aria-expanded={!isSidebarCollapsed}
          aria-controls="course-navigation"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
          title={t("Sidebar umschalten")}
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Custom Logo + Home button */}
        <button
          onClick={onHomeClick}
          className="group flex items-center gap-2.5 text-left transition cursor-pointer"
        >
          <img
            src="/logo.png"
            alt={t("BetterIlias Logo")}
            className="hidden min-[360px]:block h-9 w-9 object-contain shrink-0 rounded-lg drop-shadow-2xs"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-black tracking-tight leading-none">
                <span style={{ color: 'var(--brand-better, #033683)' }}>{t("Better")}</span>
                <span style={{ color: 'var(--brand-ilias, #0AACA5)' }}>{t("Ilias")}</span>
              </span>
            </div>
            <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 leading-none mt-1">
              {t("Fast & Modern Learning Portal")}
            </p>
          </div>
        </button>
      </div>

      {/* Right status & settings area */}
      <div className="relative flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Auth Status Badge */}
        {authStatus?.authenticated ? (
          <div role="status" aria-label={t("ILIAS-Sitzung aktiv")} title={authStatus.user_name || t("Verbunden")} className="flex items-center gap-2 rounded-full bg-emerald-50 px-2 sm:px-3 py-1 text-xs font-medium text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60">
            <span className="relative hidden sm:flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="hidden sm:inline truncate max-w-[150px]">{authStatus.user_name || t("Verbunden")}</span>
          </div>
        ) : (
          <div role="status" aria-label={t("ILIAS-Sitzung inaktiv")} title={authStatus === null ? t("Prüfe Status...") : t("Nicht angemeldet")} className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2 sm:px-3 py-1 text-xs font-medium text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <span className="hidden sm:inline">{authStatus === null ? t("Prüfe Status...") : t("Nicht angemeldet")}</span>
          </div>
        )}

        {/* Settings Menu Button */}
        <button
          onClick={toggleSettings}
          data-settings-trigger
          aria-label={t("Design & Einstellungen")}
          aria-expanded={isSettingsOpen}
          className={`rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer border ${
            isSettingsOpen
              ? 'border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800'
              : 'border-transparent'
          }`}
          title={t("Design & Einstellungen")}
        >
          <SettingsGear rotation={gearRotation} />
        </button>

        {/* Settings Dropdown Panel */}
        <SettingsDropdown
          isOpen={isSettingsOpen}
          gearRotation={gearRotation}
          onGearClick={toggleSettings}
          onClose={() => setIsSettingsOpen(false)}
          onLogout={onLogout}
          isAuthenticated={Boolean(authStatus?.authenticated)}
          userName={authStatus?.user_name}
          onOpenExtensionInfo={onOpenExtensionInfo}
        />
      </div>
    </header>
  );
};
