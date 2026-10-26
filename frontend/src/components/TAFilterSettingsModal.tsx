import { t, useLanguage } from '../lib/i18n';
import React, { useState, useEffect } from 'react';
import {
  X,
  SlidersHorizontal,
  Clock,
  User,
  CheckCircle2,
  Award,
  Trash2,
  Plus,
  FileText,
  Mail,
  Upload,
  ArrowUp,
  ArrowDown,
  Check,
  Tag,
  Palette,
} from 'lucide-react';
import { TAQuickFilter } from '../types';

interface TAFilterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseRefId: string;
  showMarksInOverview: boolean;
  onToggleShowMarksInOverview: () => void;
  evalModeInOverview: 'statement' | 'file' | 'email';
  onSetEvalMode: (mode: 'statement' | 'file' | 'email') => void;
  sortField: 'time' | 'name' | 'status' | 'mark' | 'ilias';
  onSetSortField: (field: 'time' | 'name' | 'status' | 'mark' | 'ilias') => void;
  sortOrder: 'asc' | 'desc';
  onSetSortOrder: (order: 'asc' | 'desc') => void;
  quickFilters: TAQuickFilter[];
  onAddQuickFilter: (filter: Omit<TAQuickFilter, 'id'>) => void;
  onDeleteQuickFilter: (id: string) => void;
}

const COLOR_OPTIONS: Array<{ key: TAQuickFilter['color']; label: string; bg: string; border: string; text: string }> = [
  { key: 'indigo', get label() { return t("Indigo"); }, bg: 'bg-indigo-500', border: 'border-indigo-500', text: 'text-indigo-600' },
  { key: 'emerald', get label() { return t("Smaragd"); }, bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-600' },
  { key: 'amber', get label() { return t("Bernstein"); }, bg: 'bg-amber-500', border: 'border-amber-500', text: 'text-amber-600' },
  { key: 'rose', get label() { return t("Rose"); }, bg: 'bg-rose-500', border: 'border-rose-500', text: 'text-rose-600' },
  { key: 'purple', get label() { return t("Lila"); }, bg: 'bg-purple-500', border: 'border-purple-500', text: 'text-purple-600' },
  { key: 'sky', get label() { return t("Himmelblau"); }, bg: 'bg-sky-500', border: 'border-sky-500', text: 'text-sky-600' },
  { key: 'slate', get label() { return t("Schiefer"); }, bg: 'bg-slate-600', border: 'border-slate-600', text: 'text-slate-700' },
];

export const TAFilterSettingsModal: React.FC<TAFilterSettingsModalProps> = ({
  isOpen,
  onClose,
  showMarksInOverview,
  onToggleShowMarksInOverview,
  evalModeInOverview,
  onSetEvalMode,
  sortField,
  onSetSortField,
  sortOrder,
  onSetSortOrder,
  quickFilters,
  onAddQuickFilter,
  onDeleteQuickFilter,
}) => {
  useLanguage();
  // New QuickFilter Form State
  const [newFilterName, setNewFilterName] = useState('');
  const [newFilterColor, setNewFilterColor] = useState<TAQuickFilter['color']>('indigo');
  const [newFilterSub, setNewFilterSub] = useState<'all' | 'submitted' | 'not_submitted'>('submitted');
  const [newFilterGrades, setNewFilterGrades] = useState<string[]>(['not_graded']);
  const [isAddingFilter, setIsAddingFilter] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleGradeSelection = (val: string) => {
    setNewFilterGrades((prev) =>
      prev.includes(val) ? prev.filter((g) => g !== val) : [...prev, val]
    );
  };

  const handleCreateFilter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilterName.trim()) return;

    onAddQuickFilter({
      label: newFilterName.trim(),
      color: newFilterColor,
      submissionStatus: newFilterSub,
      gradeStatus: newFilterGrades,
    });

    setNewFilterName('');
    setIsAddingFilter(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col animate-in zoom-in-95 duration-150 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4.5 bg-slate-50/50 dark:bg-slate-800/60">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shadow-2xs">
              <SlidersHorizontal className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{t("Filter- & Anzeige-Einstellungen")}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("Konfiguration für Sortierung, Schnellfilter & Kursansicht")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          {/* Section 1: Sortierung */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("Sortierung der Abgaben")}</h3>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">{t("Reihenfolge & Kriterium")}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                title={t('Nachname des Empfängers unter „Korrektur per Datei“')}
                onClick={() => onSetSortField('ilias')}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-xs font-semibold transition cursor-pointer ${
                  sortField === 'ilias'
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-900 ring-2 ring-indigo-500/20 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200'
                    : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <User className={`h-4 w-4 ${sortField === 'ilias' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                <span>{t('ILIAS-Standardsortierung')}</span>
              </button>

              <button
                type="button"
                onClick={() => onSetSortField('time')}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-xs font-semibold transition cursor-pointer ${
                  sortField === 'time'
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-900 ring-2 ring-indigo-500/20 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200'
                    : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <Clock className={`h-4 w-4 ${sortField === 'time' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                <span>{t("Abgabezeit")}</span>
              </button>

              <button
                type="button"
                onClick={() => onSetSortField('name')}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-xs font-semibold transition cursor-pointer ${
                  sortField === 'name'
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-900 ring-2 ring-indigo-500/20 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200'
                    : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <User className={`h-4 w-4 ${sortField === 'name' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                <span>{t("Name")}</span>
              </button>

              <button
                type="button"
                onClick={() => onSetSortField('status')}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-xs font-semibold transition cursor-pointer ${
                  sortField === 'status'
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-900 ring-2 ring-indigo-500/20 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200'
                    : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <CheckCircle2 className={`h-4 w-4 ${sortField === 'status' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                <span>{t("Status")}</span>
              </button>

              <button
                type="button"
                onClick={() => onSetSortField('mark')}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-xs font-semibold transition cursor-pointer ${
                  sortField === 'mark'
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-900 ring-2 ring-indigo-500/20 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200'
                    : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <Award className={`h-4 w-4 ${sortField === 'mark' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                <span>{t("Note / Punkte")}</span>
              </button>
            </div>

            {/* Sort Direction Toggle */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">{t("Richtung:")}</span>
              <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => onSetSortOrder('asc')}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold transition cursor-pointer ${
                    sortOrder === 'asc'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  <span>{t("Aufsteigend (A-Z, älteste)")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSetSortOrder('desc')}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold transition cursor-pointer ${
                    sortOrder === 'desc'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  <span>{t("Absteigend (Z-A, neueste)")}</span>
                </button>
              </div>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* Section 2: Kurs-Präferenzen (Noten & Korrektur-Modus) */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("Korrekturansicht im Kurs")}</h3>

            {/* Noten / Punkte Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{t("Noten- / Punktefeld im Überblick anzeigen")}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t("Ermöglicht das direkte Eintragen von Noten in der Abgabenliste, statt erst das Detailfenster zu öffnen.")}
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleShowMarksInOverview}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  showMarksInOverview ? 'bg-amber-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    showMarksInOverview ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Standard-Korrektur-Art */}
            <div className="space-y-2 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{t("Standard-Korrekturart im Überblick")}</span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t("Wählen Sie, welches Rückmelde-Element direkt in den Karten der Abgabenliste angezeigt werden soll.")}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onSetEvalMode('statement')}
                  className={`flex items-center justify-center gap-1.5 p-2 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                    evalModeInOverview === 'statement'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-bold dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>{t("Kommentar")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onSetEvalMode('file')}
                  className={`flex items-center justify-center gap-1.5 p-2 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                    evalModeInOverview === 'file'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-bold dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <Upload className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>{t("Datei")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onSetEvalMode('email')}
                  className={`flex items-center justify-center gap-1.5 p-2 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                    evalModeInOverview === 'email'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-bold dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <Mail className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>{t("E-Mail")}</span>
                </button>
              </div>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* Section 3: Quick-Filter verwalten */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("Quick-Filter verwalten")}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("Schnellzugriff auf häufig genutzte Filterkombinationen")}</p>
              </div>
              {!isAddingFilter && (
                <button
                  type="button"
                  onClick={() => setIsAddingFilter(true)}
                  className="flex items-center gap-1 rounded-xl bg-slate-900 dark:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-700 transition shadow-2xs cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t("Neu")}</span>
                </button>
              )}
            </div>

            {/* List of existing quick filters */}
            <div className="space-y-2">
              {quickFilters.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400 dark:text-slate-500">
                  {t("Keine Quickfilter definiert.")}
                </div>
              ) : (
                quickFilters.map((qf) => {
                  const colorDef = COLOR_OPTIONS.find((c) => c.key === qf.color) || COLOR_OPTIONS[0];
                  const subText =
                    qf.submissionStatus === 'submitted'
                      ? t("Eingereicht")
                      : qf.submissionStatus === 'not_submitted'
                      ? t("Nicht eingereicht")
                      : t("Beliebig");
                  const gradeText =
                    qf.gradeStatus.length === 0
                      ? t("Alle Noten")
                      : qf.gradeStatus
                          .map((g) => (g === 'not_graded' ? t("Offen") : g === 'passed' ? t("Bestanden") : t("Nicht bestanden")))
                          .join(', ');

                  return (
                    <div
                      key={qf.id}
                      className="flex items-center justify-between p-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 hover:bg-slate-50/50 dark:hover:bg-slate-800 transition shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`h-3 w-3 rounded-full ${colorDef.bg}`} />
                        <div>
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{qf.label}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                            {subText} • {gradeText}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onDeleteQuickFilter(qf.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600 dark:hover:text-rose-400 transition cursor-pointer"
                        title={t("Quickfilter entfernen")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add New QuickFilter Sub-Form */}
            {isAddingFilter && (
              <form onSubmit={handleCreateFilter} className="p-4 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-indigo-950/30 space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>{t("Neuen Quick-Filter anlegen")}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsAddingFilter(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs cursor-pointer"
                  >
                    {t("Abbrechen")}
                  </button>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">{t("Name des Filters:")}</label>
                  <input
                    type="text"
                    required
                    placeholder={t("z.B. Offen & Dringend")}
                    value={newFilterName}
                    onChange={(e) => setNewFilterName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Color Palette */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">{t("Farbe:")}</label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setNewFilterColor(c.key)}
                        className={`h-6 w-6 rounded-full ${c.bg} flex items-center justify-center transition cursor-pointer ${
                          newFilterColor === c.key ? 'ring-2 ring-offset-2 ring-slate-800 dark:ring-offset-slate-900 dark:ring-slate-300' : 'opacity-80 hover:opacity-100'
                        }`}
                        title={c.label}
                      >
                        {newFilterColor === c.key && <Check className="h-3 w-3 text-white" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Submission Target */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">{t("Abgabe-Status:")}</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setNewFilterSub('all')}
                      className={`p-1.5 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                        newFilterSub === 'all'
                          ? 'border-indigo-600 bg-white dark:bg-slate-800 text-indigo-900 dark:text-indigo-200 font-bold'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {t("Alle")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewFilterSub('submitted')}
                      className={`p-1.5 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                        newFilterSub === 'submitted'
                          ? 'border-indigo-600 bg-white dark:bg-slate-800 text-indigo-900 dark:text-indigo-200 font-bold'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {t("Eingereicht")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewFilterSub('not_submitted')}
                      className={`p-1.5 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                        newFilterSub === 'not_submitted'
                          ? 'border-indigo-600 bg-white dark:bg-slate-800 text-indigo-900 dark:text-indigo-200 font-bold'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {t("Nicht eingereicht")}
                    </button>
                  </div>
                </div>

                {/* Grade Status Target */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">{t("Bewertungs-Status:")}</label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      { key: 'not_graded', get label() { return t("Offen"); } },
                      { key: 'passed', get label() { return t("Bestanden"); } },
                      { key: 'failed', get label() { return t("Nicht bestanden"); } },
                    ].map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => toggleGradeSelection(g.key)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                          newFilterGrades.includes(g.key)
                            ? 'border-indigo-600 bg-white dark:bg-slate-800 text-indigo-900 dark:text-indigo-200 font-bold'
                            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="rounded-xl bg-indigo-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-indigo-700 transition shadow-2xs cursor-pointer"
                  >
                    {t("Quick-Filter speichern")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-100 dark:border-slate-800 px-6 py-4 bg-slate-50 dark:bg-slate-800/60 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 dark:bg-slate-800 text-white px-4 py-2 text-xs font-bold hover:bg-slate-800 dark:hover:bg-slate-700 transition shadow-2xs cursor-pointer"
          >
            {t("Fertig")}
          </button>
        </div>
      </div>
    </div>
  );
};

