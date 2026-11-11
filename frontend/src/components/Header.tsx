import { retryConnection, useConnectionIssue } from '../lib/connection';
import { t, useLanguage } from '../lib/i18n';
import React, { useRef, useState } from 'react';
import { Menu, AlertCircle } from 'lucide-react';
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
  onOpenLanding?: () => void;
  onOpenLegal?: (tab?: 'imprint' | 'privacy') => void;
}

export const Header: React.FC<HeaderProps> = ({
  authStatus,
  onHomeClick,
  onToggleSidebar,
  isSidebarCollapsed,
  onLogout,
  onOpenExtensionInfo,
  onOpenLanding,
  onOpenLegal,
}) => {
  useLanguage();
  const connectionIssue = useConnectionIssue();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [gearRotation, setGearRotation] = useState(0);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
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
        {authStatus?.authenticated && !connectionIssue ? (
          <div
            role="status"
            aria-label={t("ILIAS-Sitzung aktiv")}
          >
            <button
              type="button"
              aria-label={t("Verbunden")}
              title={authStatus.user_name || t("Verbunden")}
              onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.blur(); }}
              className="session-status flex min-h-11 min-w-11 items-center justify-center rounded-full border border-transparent bg-transparent px-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 cursor-default"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping motion-reduce:animate-none rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              </span>
              <span className="session-status-label overflow-hidden whitespace-nowrap truncate">
                {t("Verbunden")}
              </span>
            </button>
          </div>
        ) : (
          <button type="button" onClick={connectionIssue ? () => { void retryConnection(); } : onOpenExtensionInfo}
            aria-label={t(connectionIssue ? `connection.${connectionIssue}.title` : authStatus === null ? 'Prüfe Status...' : 'connection.connect')}
            className="flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-slate-200 dark:hover:bg-slate-800">
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{t(connectionIssue ? `connection.${connectionIssue}.title` : authStatus === null ? 'Prüfe Status...' : 'connection.connect')}</span>
          </button>
        )}

        {/* Settings Menu Button */}
        <button
          onClick={toggleSettings}
          data-settings-trigger
          ref={settingsTrigger}
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
          anchorRef={settingsTrigger}
          isOpen={isSettingsOpen}
          gearRotation={gearRotation}
          onGearClick={toggleSettings}
          onClose={() => setIsSettingsOpen(false)}
          onLogout={onLogout}
          isAuthenticated={Boolean(authStatus?.authenticated)}
          userName={authStatus?.user_name}
          onOpenExtensionInfo={onOpenExtensionInfo}
          onOpenLanding={onOpenLanding}
          onOpenLegal={onOpenLegal}
        />
      </div>
    </header>
  );
};
