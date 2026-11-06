import { t, useLanguage } from '../lib/i18n';
import React, { useState, useMemo } from 'react';
import {
  Zap,
  Palette,
  Calendar,
  FileCheck,
  PlayCircle,
  FolderTree,
  Puzzle,
  ArrowRight,
  Sun,
  Moon,
  Sparkles,
  Smartphone,
  ExternalLink,
  X,
  Layers,
  ZoomIn,
  ShieldCheck,
  Sliders,
  CheckCircle2,
  Clock,
  PlusCircle,
  AlertTriangle,
  Download,
  LogIn,
  RefreshCw,
  Rocket,
} from 'lucide-react';

interface LandingViewProps {
  onOpenApp: () => void;
  onOpenExtensionInfo: () => void;
  isAuthenticated?: boolean;
  onOpenLegal?: (tab: 'imprint' | 'privacy') => void;
}

export const LandingView: React.FC<LandingViewProps> = ({
  onOpenApp,
  onOpenExtensionInfo,
  isAuthenticated = false,
  onOpenLegal,
}) => {
  useLanguage();
  const [imageThemeOverride, setImageThemeOverride] = useState<'auto' | 'light' | 'dark'>('auto');
  const [zoomedImage, setZoomedImage] = useState<{ src: string; title: string } | null>(null);

  // Determine current image theme: 'dark' or 'light'
  const isDarkActive = useMemo(() => {
    if (imageThemeOverride === 'dark') return true;
    if (imageThemeOverride === 'light') return false;
    return document.documentElement.classList.contains('dark');
  }, [imageThemeOverride]);

  const getImageSrc = (baseName: string) => {
    // If it's the calendar (which only has calendar.jpg)
    if (baseName === 'calendar') return '/calendar.jpg';
    return isDarkActive ? `/${baseName}_dark.jpg` : `/${baseName}_light.jpg`;
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 transition-colors">
      {/* Top Banner for active users */}
      {isAuthenticated && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800/60 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{t("landing.active_session_notice")}</span>
          </div>
          <button
            type="button"
            onClick={onOpenApp}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-2xs transition cursor-pointer shrink-0"
          >
            <span>{t("landing.go_to_app")}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-10 pb-16 sm:pt-16 sm:pb-24 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-b from-white via-slate-50 to-slate-100/60 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            {/* Pill Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-xs font-bold tracking-wide uppercase shadow-2xs mb-6">
              <Sparkles className="h-3.5 w-3.5 text-[#0AACA5]" />
              <span>{t("landing.hero_badge")}</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 dark:text-white leading-[1.1]">
              <span style={{ color: 'var(--brand-better, #033683)' }}>Better</span>
              <span style={{ color: 'var(--brand-ilias, #0AACA5)' }}>Ilias</span>
              <br />
              <span className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-slate-800 dark:text-slate-200 mt-2 block">
                {t("landing.hero_tagline")}
              </span>
            </h1>

            {/* Description */}
            <p className="mt-5 text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto">
              {t("landing.hero_description")}
            </p>

            {/* CTA Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3.5">
              <button
                type="button"
                onClick={onOpenApp}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-[#0AACA5] hover:bg-[#088b85] text-white font-bold text-sm shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 transition-all cursor-pointer transform hover:-translate-y-0.5"
              >
                <span>{t("landing.cta_open_betterilias")}</span>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onOpenExtensionInfo}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-bold text-sm shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                <Puzzle className="h-4 w-4 text-[#0AACA5]" />
                <span>{t("landing.cta_extension")}</span>
              </button>
            </div>

            {/* Theme switcher for screenshots */}
            <div className="mt-6 inline-flex items-center gap-2 p-1 rounded-xl bg-slate-200/60 dark:bg-slate-800 text-xs font-semibold">
              <span className="text-slate-500 dark:text-slate-400 px-2">{t("landing.screenshot_mode")}:</span>
              <button
                type="button"
                onClick={() => setImageThemeOverride('auto')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  imageThemeOverride === 'auto'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {t("landing.theme_auto")}
              </button>
              <button
                type="button"
                onClick={() => setImageThemeOverride('light')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  imageThemeOverride === 'light'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Sun className="h-3.5 w-3.5 text-amber-500" />
                <span>{t("landing.theme_light")}</span>
              </button>
              <button
                type="button"
                onClick={() => setImageThemeOverride('dark')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  imageThemeOverride === 'dark'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Moon className="h-3.5 w-3.5 text-indigo-400" />
                <span>{t("landing.theme_dark")}</span>
              </button>
            </div>
          </div>

          {/* Hero Screenshot Frame */}
          <div className="mt-12 max-w-5xl mx-auto rounded-3xl p-2 sm:p-3 bg-gradient-to-b from-slate-200/80 to-slate-300/40 dark:from-slate-700/50 dark:to-slate-800/20 border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="relative rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 group">
              <img
                src={getImageSrc('semesteroverview')}
                alt={t("landing.preview_semesteroverview")}
                className="w-full h-auto object-cover transition duration-300"
              />
              <div className="absolute inset-0 bg-slate-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <button
                  type="button"
                  onClick={() => setZoomedImage({ src: getImageSrc('semesteroverview'), title: t("landing.preview_semesteroverview") })}
                  className="pointer-events-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/95 dark:bg-slate-900/95 text-slate-900 dark:text-white text-xs font-bold shadow-lg backdrop-blur-xs hover:scale-105 transition cursor-pointer"
                >
                  <ZoomIn className="h-4 w-4" />
                  <span>{t("landing.zoom_image")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Highlights Section */}
      <section className="py-16 sm:py-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-24">
        {/* Section Heading */}
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
            {t("landing.highlights_title")}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-500 dark:text-slate-400">
            {t("landing.highlights_subtitle")}
          </p>
        </div>

        {/* Highlight 1: 0ms Instant Cache & Offline Resilience */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-5 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs font-bold">
              <Zap className="h-4 w-4 text-amber-500" />
              <span>{t("landing.feature_cache_badge")}</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t("landing.feature_cache_title")}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
              {t("landing.feature_cache_desc")}
            </p>
            <ul className="space-y-2.5 pt-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_cache_point1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_cache_point2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_cache_point3")}</span>
              </li>
            </ul>
          </div>
          <div className="lg:col-span-7">
            <div
              onClick={() => setZoomedImage({ src: getImageSrc('semesteroverview'), title: t("landing.feature_cache_title") })}
              className="group relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl cursor-pointer hover:shadow-2xl transition"
            >
              <img
                src={getImageSrc('semesteroverview')}
                alt={t("landing.feature_cache_title")}
                className="w-full h-auto object-cover group-hover:scale-[1.01] transition duration-200"
              />
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 text-white text-xs font-semibold backdrop-blur-xs">
                  <ZoomIn className="h-3.5 w-3.5" />
                  <span>{t("landing.zoom")}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Highlight 2: Full Customizability & Personalisierung */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 order-2 lg:order-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div
                onClick={() => setZoomedImage({ src: getImageSrc('customizable_sidenav_result'), title: t("landing.feature_custom_title") })}
                className="group relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg cursor-pointer hover:shadow-xl transition"
              >
                <img
                  src={getImageSrc('customizable_sidenav_result')}
                  alt={t("landing.feature_custom_title")}
                  className="w-full h-auto object-cover"
                />
                <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1 rounded-lg bg-slate-900/70 text-white text-[11px] font-semibold backdrop-blur-xs">
                  {t("landing.custom_sidebar_result")}
                </div>
              </div>
              <div
                onClick={() => setZoomedImage({ src: getImageSrc('customizable_settings'), title: t("landing.feature_custom_title") })}
                className="group relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg cursor-pointer hover:shadow-xl transition"
              >
                <img
                  src={getImageSrc('customizable_settings')}
                  alt={t("landing.feature_custom_title")}
                  className="w-full h-auto object-cover"
                />
                <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1 rounded-lg bg-slate-900/70 text-white text-[11px] font-semibold backdrop-blur-xs">
                  {t("landing.custom_settings_palette")}
                </div>
              </div>
            </div>
          </div>
          <div className="lg:col-span-5 space-y-4 order-1 lg:order-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs font-bold">
              <Palette className="h-4 w-4 text-purple-500" />
              <span>{t("landing.feature_custom_badge")}</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t("landing.feature_custom_title")}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
              {t("landing.feature_custom_desc")}
            </p>
            <ul className="space-y-2.5 pt-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_custom_point1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_custom_point2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_custom_point3")}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Highlight 3: Timetable & Calendar with Custom Hours */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-5 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
              <Calendar className="h-4 w-4 text-indigo-500" />
              <span>{t("landing.feature_calendar_badge")}</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t("landing.feature_calendar_title")}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
              {t("landing.feature_calendar_desc")}
            </p>
            <ul className="space-y-2.5 pt-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_calendar_point1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <PlusCircle className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_calendar_point2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_calendar_point3")}</span>
              </li>
            </ul>
          </div>
          <div className="lg:col-span-7">
            <div
              onClick={() => setZoomedImage({ src: getImageSrc('calendar'), title: t("landing.feature_calendar_title") })}
              className="group relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl cursor-pointer hover:shadow-2xl transition"
            >
              <img
                src={getImageSrc('calendar')}
                alt={t("landing.feature_calendar_title")}
                className="w-full h-auto object-cover group-hover:scale-[1.01] transition duration-200"
              />
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 text-white text-xs font-semibold backdrop-blur-xs">
                  <ZoomIn className="h-3.5 w-3.5" />
                  <span>{t("landing.zoom")}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Highlight 4: Mobile-Friendly Showcase */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 order-2 lg:order-1">
            <div className="flex items-center justify-center gap-4 sm:gap-6">
              <div
                onClick={() => setZoomedImage({ src: getImageSrc('mobile_overview'), title: t("landing.mobile_overview_preview") })}
                className="group relative w-44 sm:w-56 rounded-3xl overflow-hidden border-4 border-slate-800 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl cursor-pointer hover:scale-105 transition"
              >
                <img
                  src={getImageSrc('mobile_overview')}
                  alt={t("landing.mobile_overview_preview")}
                  className="w-full h-auto object-cover"
                />
                <div className="p-2 text-center bg-slate-900/90 text-white text-[11px] font-bold">
                  {t("landing.mobile_overview_preview")}
                </div>
              </div>
              <div
                onClick={() => setZoomedImage({ src: getImageSrc('mobile_lecture_mms'), title: t("landing.mobile_lecture_preview") })}
                className="group relative w-44 sm:w-56 rounded-3xl overflow-hidden border-4 border-slate-800 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl cursor-pointer hover:scale-105 transition"
              >
                <img
                  src={getImageSrc('mobile_lecture_mms')}
                  alt={t("landing.mobile_lecture_preview")}
                  className="w-full h-auto object-cover"
                />
                <div className="p-2 text-center bg-slate-900/90 text-white text-[11px] font-bold">
                  {t("landing.mobile_lecture_preview")}
                </div>
              </div>
            </div>
          </div>
          <div className="lg:col-span-5 space-y-4 order-1 lg:order-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
              <Smartphone className="h-4 w-4 text-emerald-500" />
              <span>{t("landing.feature_mobile_badge")}</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t("landing.feature_mobile_title")}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
              {t("landing.feature_mobile_desc")}
            </p>
            <ul className="space-y-2.5 pt-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_mobile_point1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_mobile_point2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_mobile_point3")}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Highlight 5: Exercises, Submissions & TA Grading */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-5 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-xs font-bold">
              <FileCheck className="h-4 w-4 text-[#0AACA5]" />
              <span>{t("landing.feature_exercises_badge")}</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t("landing.feature_exercises_title")}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
              {t("landing.feature_exercises_desc")}
            </p>
            <ul className="space-y-2.5 pt-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_exercises_point1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_exercises_point2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_exercises_point3")}</span>
              </li>
            </ul>
          </div>
          <div className="lg:col-span-7">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div
                onClick={() => setZoomedImage({ src: getImageSrc('assignments_details'), title: t("landing.feature_exercises_title") })}
                className="group relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg cursor-pointer hover:shadow-xl transition"
              >
                <img
                  src={getImageSrc('assignments_details')}
                  alt={t("landing.feature_exercises_title")}
                  className="w-full h-auto object-cover"
                />
                <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1 rounded-lg bg-slate-900/70 text-white text-[11px] font-semibold backdrop-blur-xs">
                  {t("landing.student_submissions")}
                </div>
              </div>
              <div
                onClick={() => setZoomedImage({ src: getImageSrc('assignments_correction'), title: t("landing.feature_exercises_title") })}
                className="group relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg cursor-pointer hover:shadow-xl transition"
              >
                <img
                  src={getImageSrc('assignments_correction')}
                  alt={t("landing.feature_exercises_title")}
                  className="w-full h-auto object-cover"
                />
                <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1 rounded-lg bg-slate-900/70 text-white text-[11px] font-semibold backdrop-blur-xs">
                  {t("landing.ta_grading_toolbar")}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Highlight 6: Podcasts & Video Player */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 order-2 lg:order-1">
            <div
              onClick={() => setZoomedImage({ src: getImageSrc('podcast_streaming_videoplayer'), title: t("landing.feature_video_title") })}
              className="group relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl cursor-pointer hover:shadow-2xl transition"
            >
              <img
                src={getImageSrc('podcast_streaming_videoplayer')}
                alt={t("landing.feature_video_title")}
                className="w-full h-auto object-cover group-hover:scale-[1.01] transition duration-200"
              />
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 text-white text-xs font-semibold backdrop-blur-xs">
                  <ZoomIn className="h-3.5 w-3.5" />
                  <span>{t("landing.zoom")}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="lg:col-span-5 space-y-4 order-1 lg:order-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-xs font-bold">
              <PlayCircle className="h-4 w-4 text-sky-500" />
              <span>{t("landing.feature_video_badge")}</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t("landing.feature_video_title")}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
              {t("landing.feature_video_desc")}
            </p>
            <ul className="space-y-2.5 pt-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_video_point1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_video_point2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_video_point3")}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Highlight 7: ILIAS Structures & Project Status Notice */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-5 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold">
              <FolderTree className="h-4 w-4 text-rose-500" />
              <span>{t("landing.feature_structures_badge")}</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t("landing.feature_structures_title")}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
              {t("landing.feature_structures_desc")}
            </p>
            <ul className="space-y-2.5 pt-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_structures_point1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_structures_point2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{t("landing.feature_structures_point3")}</span>
              </li>
            </ul>

            {/* Development note informing user */}
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <span>{t("landing.feature_structures_note")}</span>
            </div>
          </div>
          <div className="lg:col-span-7">
            <div
              onClick={() => setZoomedImage({ src: getImageSrc('support_for_ilias_structures'), title: t("landing.feature_structures_title") })}
              className="group relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl cursor-pointer hover:shadow-2xl transition"
            >
              <img
                src={getImageSrc('support_for_ilias_structures')}
                alt={t("landing.feature_structures_title")}
                className="w-full h-auto object-cover group-hover:scale-[1.01] transition duration-200"
              />
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 text-white text-xs font-semibold backdrop-blur-xs">
                  <ZoomIn className="h-3.5 w-3.5" />
                  <span>{t("landing.zoom")}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Highlight 8: Browser Companion Extension (with Single-Line GitHub Links) */}
        <div className="rounded-3xl p-6 sm:p-10 border border-teal-200/80 dark:border-teal-900/60 bg-gradient-to-br from-teal-50/50 via-white to-sky-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950/30 shadow-xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-teal-100/70 dark:bg-teal-900/60 text-[#0AACA5] dark:text-teal-300 text-xs font-bold">
                <Puzzle className="h-4 w-4" />
                <span>{t("landing.extension_badge")}</span>
              </div>
              <h3 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {t("landing.extension_title")}
              </h3>
              <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                {t("landing.extension_desc")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-medium">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>{t("landing.extension_point1")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-indigo-500 shrink-0" />
                  <span>{t("landing.extension_point2")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500 shrink-0" />
                  <span>{t("landing.extension_point3")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-purple-500 shrink-0" />
                  <span>{t("landing.extension_point4")}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onOpenExtensionInfo}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0AACA5] hover:bg-[#088b85] text-white text-xs font-bold shadow-md transition cursor-pointer shrink-0"
                >
                  <Puzzle className="h-4 w-4" />
                  <span>{t("landing.extension_cta")}</span>
                </button>
              </div>
            </div>

            {/* Extension GitHub Links Box (Single line, handsome cards) */}
            <div className="lg:col-span-5 flex flex-col p-6 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-3">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {t("landing.extension_box_title")}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("landing.extension_store_note")}
              </p>

              <div className="space-y-2 pt-1">
                {/* Google Chrome Link */}
                <a
                  href="https://github.com/M4anuel/betterilias/tree/main/extensions/chrome"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold transition shadow-2xs group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-400 font-extrabold text-[11px]">
                      Cr
                    </span>
                    <span className="whitespace-nowrap">{t("landing.extension_github_chrome")}</span>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition shrink-0" />
                </a>

                {/* Mozilla Firefox Link */}
                <a
                  href="https://github.com/M4anuel/betterilias/tree/main/extensions/firefox"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold transition shadow-2xs group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-950/70 text-orange-700 dark:text-orange-400 font-extrabold text-[11px]">
                      Fx
                    </span>
                    <span className="whitespace-nowrap">{t("landing.extension_github_firefox")}</span>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition shrink-0" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Comparison Table: BetterIlias vs Standard ILIAS */}
        <div className="space-y-6">
          <div className="text-center max-w-xl mx-auto">
            <h3 className="text-xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              {t("landing.comparison_title")}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              {t("landing.comparison_subtitle")}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900 shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-900 dark:text-white">
                    <th className="p-3.5 sm:p-4">{t("landing.comparison_col_feature")}</th>
                    <th className="p-3.5 sm:p-4 text-slate-400 dark:text-slate-500">{t("landing.comparison_col_standard")}</th>
                    <th className="p-3.5 sm:p-4 text-[#0AACA5] font-black">{t("BetterIlias")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <tr>
                    <td className="p-3.5 sm:p-4 font-semibold text-slate-800 dark:text-slate-200">{t("landing.comp_speed_title")}</td>
                    <td className="p-3.5 sm:p-4 text-slate-500 dark:text-slate-400">{t("landing.comp_speed_standard")}</td>
                    <td className="p-3.5 sm:p-4 font-bold text-teal-600 dark:text-teal-400">{t("landing.comp_speed_better")}</td>
                  </tr>
                  <tr>
                    <td className="p-3.5 sm:p-4 font-semibold text-slate-800 dark:text-slate-200">{t("landing.comp_theme_title")}</td>
                    <td className="p-3.5 sm:p-4 text-slate-500 dark:text-slate-400">{t("landing.comp_theme_standard")}</td>
                    <td className="p-3.5 sm:p-4 font-bold text-teal-600 dark:text-teal-400">{t("landing.comp_theme_better")}</td>
                  </tr>
                  <tr>
                    <td className="p-3.5 sm:p-4 font-semibold text-slate-800 dark:text-slate-200">{t("landing.comp_calendar_title")}</td>
                    <td className="p-3.5 sm:p-4 text-slate-500 dark:text-slate-400">{t("landing.comp_calendar_standard")}</td>
                    <td className="p-3.5 sm:p-4 font-bold text-teal-600 dark:text-teal-400">{t("landing.comp_calendar_better")}</td>
                  </tr>
                  <tr>
                    <td className="p-3.5 sm:p-4 font-semibold text-slate-800 dark:text-slate-200">{t("landing.comp_video_title")}</td>
                    <td className="p-3.5 sm:p-4 text-slate-500 dark:text-slate-400">{t("landing.comp_video_standard")}</td>
                    <td className="p-3.5 sm:p-4 font-bold text-teal-600 dark:text-teal-400">{t("landing.comp_video_better")}</td>
                  </tr>
                  <tr>
                    <td className="p-3.5 sm:p-4 font-semibold text-slate-800 dark:text-slate-200">{t("landing.comp_ta_title")}</td>
                    <td className="p-3.5 sm:p-4 text-slate-500 dark:text-slate-400">{t("landing.comp_ta_standard")}</td>
                    <td className="p-3.5 sm:p-4 font-bold text-teal-600 dark:text-teal-400">{t("landing.comp_ta_better")}</td>
                  </tr>
                  <tr>
                    <td className="p-3.5 sm:p-4 font-semibold text-slate-800 dark:text-slate-200">{t("landing.comp_mobile_title")}</td>
                    <td className="p-3.5 sm:p-4 text-slate-500 dark:text-slate-400">{t("landing.comp_mobile_standard")}</td>
                    <td className="p-3.5 sm:p-4 font-bold text-teal-600 dark:text-teal-400">{t("landing.comp_mobile_better")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Quickstart Guide (Schnellstart-Anleitung) */}
        <div className="rounded-3xl p-8 sm:p-12 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-bold uppercase tracking-wider">
              <Rocket className="h-3.5 w-3.5 text-indigo-500" />
              <span>{t("landing.quickstart_badge")}</span>
            </div>
            <h3 className="text-2xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
              {t("landing.quickstart_title")}
            </h3>
            <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400">
              {t("landing.quickstart_desc")}
            </p>
          </div>

          {/* 4 Steps Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Step 1 */}
            <div className="flex flex-col p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/70 text-[#0AACA5] font-black text-sm shadow-2xs">
                1
              </div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {t("landing.step1_title")}
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {t("landing.step1_desc")}
              </p>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 font-black text-sm shadow-2xs">
                2
              </div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {t("landing.step2_title")}
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {t("landing.step2_desc")}
              </p>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950/70 text-purple-600 dark:text-purple-400 font-black text-sm shadow-2xs">
                3
              </div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {t("landing.step3_title")}
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {t("landing.step3_desc")}
              </p>
            </div>

            {/* Step 4 */}
            <div className="flex flex-col p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 font-black text-sm shadow-2xs">
                4
              </div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {t("landing.step4_title")}
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {t("landing.step4_desc")}
              </p>
            </div>
          </div>

          {/* Action button inside quickstart */}
          <div className="text-center pt-4">
            <button
              type="button"
              onClick={onOpenApp}
              className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-gradient-to-r from-[#033683] to-[#0AACA5] hover:opacity-95 text-white font-extrabold text-sm shadow-xl hover:scale-105 transition cursor-pointer"
            >
              <span>{t("landing.cta_open_betterilias")}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Landing Page Legal & Info Footer */}
      <footer className="w-full border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 py-8 px-4 sm:px-8 mt-12 transition-colors">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="space-y-1 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <span className="font-extrabold text-[#033683] dark:text-white">Better</span>
              <span className="font-extrabold text-[#0AACA5]">Ilias</span>
              <span className="text-[10px] text-slate-400">· Open Source</span>
            </div>
            <p className="max-w-md text-[11px] leading-relaxed">
              {t("landing.footer_disclaimer")}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-xs">
            {onOpenLegal && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenLegal('imprint')}
                  className="font-medium hover:text-[#0AACA5] transition cursor-pointer underline underline-offset-2"
                >
                  {t("Impressum")}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenLegal('privacy')}
                  className="font-medium hover:text-[#0AACA5] transition cursor-pointer underline underline-offset-2"
                >
                  {t("Datenschutz")}
                </button>
              </>
            )}
            <a
              href="https://github.com/M4anuel/betterilias"
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:text-[#0AACA5] transition underline underline-offset-2"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>

      {/* Lightbox / Zoomed image modal */}
      {zoomedImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={zoomedImage.title}
          onClick={() => setZoomedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-5xl max-h-[90vh] bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-700 flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 bg-slate-800/90 border-b border-slate-700 text-white">
              <span className="text-xs font-bold truncate">{zoomedImage.title}</span>
              <button
                type="button"
                onClick={() => setZoomedImage(null)}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                aria-label={t("Schliessen")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto p-2">
              <img
                src={zoomedImage.src}
                alt={zoomedImage.title}
                className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
