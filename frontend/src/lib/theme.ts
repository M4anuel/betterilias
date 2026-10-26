import { t } from './i18n';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface AccentPreset {
  id: string;
  name: string;
  color: string;
  hover: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'teal', get name() { return t("Türkis (Standard)"); }, color: '#0AACA5', hover: '#088b85' },
  { id: 'navy', get name() { return t("Navy Blau"); }, color: '#033683', hover: '#022863' },
  { id: 'sky', get name() { return t("Himmelblau"); }, color: '#0284c7', hover: '#0369a1' },
  { id: 'indigo', get name() { return t("Indigo"); }, color: '#6366f1', hover: '#4f46e5' },
  { id: 'emerald', get name() { return t("Smaragdgrün"); }, color: '#10b981', hover: '#059669' },
  { id: 'purple', get name() { return t("Violett"); }, color: '#8b5cf6', hover: '#7c3aed' },
  { id: 'rose', get name() { return t("Rosé"); }, color: '#f43f5e', hover: '#e11d48' },
  { id: 'amber', get name() { return t("Bernstein"); }, color: '#f59e0b', hover: '#d97706' },
];

const THEME_MODE_KEY = 'betterilias_theme_mode';
const ACCENT_COLOR_KEY = 'betterilias_accent_color';

export const DEFAULT_ACCENT = '#0AACA5';
export const BRAND_BETTER = '#033683';
export const BRAND_ILIAS = '#0AACA5';

// Helper to convert hex to rgb
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  }
  return null;
}

export const theme = {
  getThemeMode(): ThemeMode {
    try {
      const saved = localStorage.getItem(THEME_MODE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch {}
    return 'system';
  },

  setThemeMode(mode: ThemeMode) {
    try {
      localStorage.setItem(THEME_MODE_KEY, mode);
    } catch {}
    this.applyTheme();
  },

  getAccentColor(): string {
    try {
      const saved = localStorage.getItem(ACCENT_COLOR_KEY);
      if (saved && saved.startsWith('#')) {
        return saved;
      }
    } catch {}
    return DEFAULT_ACCENT;
  },

  setAccentColor(color: string) {
    try {
      localStorage.setItem(ACCENT_COLOR_KEY, color);
    } catch {}
    this.applyTheme();
  },

  isDarkEffective(): boolean {
    const mode = this.getThemeMode();
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  },

  applyTheme() {
    const isDark = this.isDarkEffective();
    const root = document.documentElement;

    // Toggle dark class on <html>
    if (isDark) {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }

    // Apply accent colors to CSS variables
    const accent = this.getAccentColor();
    const preset = ACCENT_PRESETS.find((p) => p.color.toLowerCase() === accent.toLowerCase());
    const hoverColor = preset ? preset.hover : accent;

    const rgb = hexToRgb(accent) || { r: 10, g: 172, b: 165 };

    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-hover', hoverColor);
    root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.style.setProperty('--accent-light', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.15 : 0.08})`);
    root.style.setProperty('--accent-border', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.35 : 0.25})`);
    root.style.setProperty('--accent-text', isDark ? `rgb(${Math.min(255, rgb.r + 70)}, ${Math.min(255, rgb.g + 70)}, ${Math.min(255, rgb.b + 70)})` : accent);

    // Brand colors for the logo text
    root.style.setProperty('--brand-better', isDark ? '#4d8bf5' : BRAND_BETTER);
    root.style.setProperty('--brand-ilias', isDark ? '#26d6cf' : BRAND_ILIAS);

    // Notify listeners
    window.dispatchEvent(
      new CustomEvent('betterilias-theme-changed', {
        detail: { mode: this.getThemeMode(), isDark, accent },
      })
    );
  },

  initTheme() {
    this.applyTheme();

    // Listen for OS scheme changes if mode is 'system'
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', () => {
        if (this.getThemeMode() === 'system') {
          this.applyTheme();
        }
      });
    }
  },
};

