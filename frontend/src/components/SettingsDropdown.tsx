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
} from 'lucide-react';
import { theme, ThemeMode, ACCENT_PRESETS } from '../lib/theme';

interface SettingsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout?: () => void;
  isAuthenticated: boolean;
  userName?: string | null;
  onOpenExtensionInfo: () => void;
}

export const SettingsDropdown: React.FC<SettingsDropdownProps> = ({
  isOpen,
  onClose,
  onLogout,
  isAuthenticated,
  userName,
  onOpenExtensionInfo,
}) => {
  const [currentMode, setCurrentMode] = useState<ThemeMode>(() => theme.getThemeMode());
  const [currentAccent, setCurrentAccent] = useState<string>(() => theme.getAccentColor());
  const [customHex, setCustomHex] = useState<string>(() => theme.getAccentColor());
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-12 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl backdrop-blur-md transition-all dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
          <SettingsIcon className="h-4 w-4 text-[#0AACA5]" />
          <span>Einstellungen & Design</span>
        </div>
        {isAuthenticated && (
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
            {userName || 'Angemeldet'}
          </span>
        )}
      </div>

      <div className="space-y-4 pt-3">
        {/* 1. Theme Mode Switcher */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">
            Erscheinungsbild
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
              <span>Hell</span>
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
              <span>Dunkel</span>
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
              <span>System</span>
            </button>
          </div>
        </div>

        {/* 2. Accent Color Palette */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1">
              <Palette className="h-3 w-3" />
              <span>Akzentfarbe</span>
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
              title="Eigene Farbe wählen"
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
              <span>ILIAS öffnen</span>
            </div>
            <span className="text-[10px] text-slate-400">Login</span>
          </a>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenExtensionInfo();
            }}
            className="w-full flex items-center justify-between rounded-xl p-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Puzzle className="h-3.5 w-3.5 text-[#0AACA5]" />
              <span>Browser-Erweiterung</span>
            </div>
            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0AACA5] dark:bg-teal-950/60">
              Sync
            </span>
          </button>
        </div>

        {/* 4. Logout Action */}
        {isAuthenticated && onLogout && (
          <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Abmelden</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
