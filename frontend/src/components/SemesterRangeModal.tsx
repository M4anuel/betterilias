import React, { useState } from 'react';
import { t, useLanguage } from '../lib/i18n';
import { X, Calendar, Check, RotateCcw } from 'lucide-react';
import {
  getDefaultStartSemester,
  getAvailableStartSemesters,
  SemesterOption,
} from '../lib/semesterUtils';

interface SemesterRangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSemester: string;
  customStartSemester: string | null;
  onSaveStartSemester: (startSem: string | null) => void;
}

export const SemesterRangeModal: React.FC<SemesterRangeModalProps> = ({
  isOpen,
  onClose,
  currentSemester,
  customStartSemester,
  onSaveStartSemester,
}) => {
  useLanguage();

  const defaultStart = getDefaultStartSemester();
  const [selectedSem, setSelectedSem] = useState<string>(
    customStartSemester || defaultStart
  );
  if (!isOpen) return null;

  const availableChoices = getAvailableStartSemesters(currentSemester);

  const handleSave = () => {
    if (selectedSem === defaultStart) {
      onSaveStartSemester(null);
    } else {
      onSaveStartSemester(selectedSem);
    }
    onClose();
  };

  const handleReset = () => {
    setSelectedSem(defaultStart);
    onSaveStartSemester(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-xs"
              style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
            >
              <Calendar className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t('semester.set_start')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('semester.start_hint')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('Schließen')}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Start Semester Dropdown */}
        <div className="space-y-2">
          <label htmlFor="semester-start" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {t('semester.show_from')}
          </label>
          <select
            id="semester-start"
            value={selectedSem}
            onChange={(e) => setSelectedSem(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white py-2 px-3 text-xs font-semibold text-slate-800 shadow-xs hover:border-slate-300 focus:outline-hidden transition dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 cursor-pointer"
          >
            {availableChoices.map((c: SemesterOption) => (
              <option key={c.id} value={c.id}>
                {c.short} – {c.full} {c.id === defaultStart ? '(Standard: 5 Jahre)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>{t('semester.default_range')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              {t('Abbrechen')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
              className="flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:opacity-90 transition cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{t('Speichern')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
