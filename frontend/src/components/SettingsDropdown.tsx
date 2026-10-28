import { t, useLanguage, languages, setLanguage } from '../lib/i18n';
import React, { useState, useEffect, useRef } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  Check,
  ExternalLink,
  Puzzle,
  LogOut,
  Palette,
  Settings as SettingsIcon,
  Info,
  Gauge,
} from 'lucide-react';
import { SettingsGear } from './SettingsGear';
import { ToggleSwitch } from './ToggleSwitch';
import { useMediaQuery } from '../lib/useMediaQuery';
import { cache } from '../lib/cache';
import { theme, ThemeMode, ACCENT_PRESETS } from '../lib/theme';
import { MobileSessionShare } from './MobileSessionShare';

interface SettingsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  gearRotation?: number;
  onGearClick?: () => void;
  onLogout?: () => void;
  isAuthenticated: boolean;
  userName?: string | null;
  onOpenExtensionInfo: () => void;
}

export const SettingsDropdown: React.FC<SettingsDropdownProps> = ({
  isOpen,
  onClose,
  gearRotation = 0,
  onGearClick = onClose,
  onLogout,
  isAuthenticated,
  userName,
  onOpenExtensionInfo,
}) => {
  const language = useLanguage();
  const [currentMode, setCurrentMode] = useState<ThemeMode>(() => theme.getThemeMode());
  const [currentAccent, setCurrentAccent] = useState<string>(() => theme.getAccentColor());
  const [customHex, setCustomHex] = useState<string>(() => theme.getAccentColor());
  const [saverEnabled, setSaverEnabled] = useState<boolean>(() => cache.getIliasSaverEnabled());
  const [saverTtl, setSaverTtl] = useState<number>(() => cache.getIliasSaverTtl());
  const [showSaverInfo, setShowSaverInfo] = useState<boolean>(false);
  const [customTtlInput, setCustomTtlInput] = useState<string>(() => String(cache.getIliasSaverTtl()));
  const dropdownRef = useRef<HTMLDialogElement>(null);
  const compact = useMediaQuery('(max-width: 767px)');
  const closePanel = () => {
    dropdownRef.current?.close();
    onClose();
  };
  useEffect(() => {
    const panel = dropdownRef.current;
    if (!panel || !isOpen) return;
    if (panel.open) panel.close();
    if (compact) panel.showModal(); else panel.show();
  }, [isOpen, compact]);

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        if (detail.mode) setCurrentMode(detail.mode);
        if (detail.accent) {
          setCurrentAccent(detail.accent);
          setCustomHex(detail.accent);
        }
      }
    };
    window.addEventListener('betterilias-theme-changed', handleThemeChange);
    return () => window.removeEventListener('betterilias-theme-changed', handleThemeChange);
  }, []);

  useEffect(() => {
    const handleSaverChange = () => {
      setSaverEnabled(cache.getIliasSaverEnabled());
      const ttl = cache.getIliasSaverTtl();
      setSaverTtl(ttl);
      setCustomTtlInput(String(ttl));
    };
    window.addEventListener('betterilias-saver-changed', handleSaverChange);
    return () => window.removeEventListener('betterilias-saver-changed', handleSaverChange);
  }, []);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-settings-trigger]')) {
        closePanel();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleModeSelect = (mode: ThemeMode) => {
    setCurrentMode(mode);
    theme.setThemeMode(mode);
  };

  const handleAccentSelect = (color: string) => {
    setCurrentAccent(color);
    setCustomHex(color);
    theme.setAccentColor(color);
  };

  const handleCustomHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomHex(val);
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      handleAccentSelect(val);
    }
  };

  const handleToggleSaver = () => {
    const next = !saverEnabled;
    setSaverEnabled(next);
    cache.setIliasSaverEnabled(next);
  };

  const handleTtlSelect = (val: string) => {
    if (val === 'custom') return;
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
      setSaverTtl(num);
      setCustomTtlInput(String(num));
      cache.setIliasSaverTtl(num);
    }
  };

  const handleCustomTtlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomTtlInput(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1 && num <= 1440) {
      setSaverTtl(num);
      cache.setIliasSaverTtl(num);
    }
  };

  return (
    <dialog
      ref={dropdownRef}
      aria-label={t("Einstellungen & Design")}
      onCancel={event => { event.preventDefault(); closePanel(); }}
      className="settings-panel text-slate-900 dark:text-slate-100 z-50 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl backdrop-blur-md transition-all dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 settings-sheet-heading dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
          <SettingsIcon className="h-4 w-4 text-[#0AACA5]" />
          <span>{t("Einstellungen & Design")}</span>
        </div>
        {isAuthenticated && (
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
            {userName || t("Angemeldet")}
          </span>
        )}
        <button type="button" className="settings-sheet-gear phone-only icon-button rounded-xl text-slate-500 dark:text-slate-300"
          aria-label={t("Design & Einstellungen")} aria-expanded={isOpen} onClick={() => { dropdownRef.current?.close(); onGearClick(); }}>
          <SettingsGear rotation={gearRotation} />
        </button>
      </div>

      <div className="space-y-4 pt-3">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          <label htmlFor="app-language">{t("Language")}</label>
          <select
            id="app-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {Object.entries(languages).map(([code, definition]) => (
              <option key={code} value={code}>
                {definition.name}{definition.support === 'partial' ? ` (${t("Partially translated")})` : ''}
              </option>
            ))}
          </select>
        </div>
        {/* 1. Theme Mode Switcher */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">
            {t("Erscheinungsbild")}
          </label>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => handleModeSelect('light')}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                currentMode === 'light'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              <span>{t("Hell")}</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeSelect('dark')}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                currentMode === 'dark'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              <span>{t("Dunkel")}</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeSelect('system')}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                currentMode === 'system'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              <span>{t("System")}</span>
            </button>
          </div>
        </div>

        {/* 2. Accent Color Palette */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1">
              <Palette className="h-3 w-3" />
              <span>{t("Akzentfarbe")}</span>
            </label>
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase">
              {currentAccent}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {ACCENT_PRESETS.map((preset) => {
              const isSelected = currentAccent.toLowerCase() === preset.color.toLowerCase();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleAccentSelect(preset.color)}
                  className={`group relative flex h-9 items-center justify-center rounded-xl transition cursor-pointer border ${
                    isSelected
                      ? 'border-slate-900 ring-2 ring-slate-400 dark:border-white dark:ring-slate-500'
                      : 'border-slate-200/80 hover:scale-105 dark:border-slate-700'
                  }`}
                  style={{ backgroundColor: preset.color }}
                  title={preset.name}
                >
                  {isSelected && <Check className="h-4 w-4 text-white drop-shadow-sm" />}
                </button>
              );
            })}
          </div>

          {/* Custom Hex Color Picker */}
          <div className="mt-2 flex items-center gap-2">
            <input
              type="color"
              value={customHex.startsWith('#') && customHex.length === 7 ? customHex : '#0AACA5'}
              onChange={(e) => handleAccentSelect(e.target.value)}
              className="h-7 w-7 rounded-lg border border-slate-200 p-0.5 cursor-pointer dark:border-slate-700"
              title={t("Eigene Farbe wählen")}
            />
            <input
              type="text"
              value={customHex}
              onChange={handleCustomHexChange}
              placeholder="#0AACA5"
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-mono text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
        </div>

        {/* 3. ILIAS Saver (Data & Server Load Protection) */}
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1">
                <Gauge className="h-3 w-3 text-[#0AACA5]" />
                <span>{t("settings.saver_title")}</span>
              </label>
              <button
                type="button"
                onClick={() => setShowSaverInfo((prev) => !prev)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer p-0.5 rounded"
                title={t("Informationen zu ILIAS Saver")}
                aria-label={t("Informationen zu ILIAS Saver")}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Toggle Switch */}
            <ToggleSwitch checked={saverEnabled} onChange={handleToggleSaver}
              label={saverEnabled ? t("ILIAS Saver deaktivieren") : t("ILIAS Saver aktivieren")} />
          </div>

          {/* Explanation Info Box */}
          {showSaverInfo && (
            <div className="mt-2 rounded-xl bg-teal-50/80 p-2.5 text-[11px] leading-relaxed text-teal-900 border border-teal-200/60 dark:bg-teal-950/40 dark:text-teal-200 dark:border-teal-900/60 animate-in fade-in duration-150">
              {t("settings.saver_description")}
            </div>
          )}

          {/* TTL controls when enabled */}
          {saverEnabled && (
            <div className="mt-2.5 space-y-1.5 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400 font-medium">
                  {t("settings.saver_ttl_label")}
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {saverTtl} {t("Min.")}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={[2, 5, 10, 15, 30, 60].includes(saverTtl) ? String(saverTtl) : 'custom'}
                  onChange={(e) => handleTtlSelect(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-[#0AACA5] focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  <option value="2">2 {t("Minuten")}</option>
                  <option value="5">5 {t("Minuten (Standard)")}</option>
                  <option value="10">10 {t("Minuten")}</option>
                  <option value="15">15 {t("Minuten")}</option>
                  <option value="30">30 {t("Minuten")}</option>
                  <option value="60">60 {t("Minuten (1 Std.)")}</option>
                  <option value="custom">{t("settings.saver_custom")}</option>
                </select>

                {(![2, 5, 10, 15, 30, 60].includes(saverTtl) || customTtlInput !== String(saverTtl)) && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={customTtlInput}
                      onChange={handleCustomTtlChange}
                      className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-[#0AACA5] focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      placeholder="Min"
                    />
                    <span className="text-[10px] text-slate-400">{t("Min.")}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <MobileSessionShare isAuthenticated={isAuthenticated} />

        {/* 3. Helpful Quick Links */}
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800 space-y-1">
          <a
            href="https://ilias.unibe.ch"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl p-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <div className="flex items-center gap-2">
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
              <span>{t("ILIAS öffnen")}</span>
            </div>
            <span className="text-[10px] text-slate-400">{t("Login")}</span>
          </a>

          <button
            type="button"
            onClick={() => {
              closePanel();
              onOpenExtensionInfo();
            }}
            className="w-full flex items-center justify-between rounded-xl p-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Puzzle className="h-3.5 w-3.5 text-[#0AACA5]" />
              <span>{t("Browser-Erweiterung")}</span>
            </div>
            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0AACA5] dark:bg-teal-950/60">
              {t("Sync")}
            </span>
          </button>
        </div>

        {/* 4. Logout Action */}
        {isAuthenticated && onLogout && (
          <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                closePanel();
                onLogout();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>{t("Abmelden")}</span>
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
};
