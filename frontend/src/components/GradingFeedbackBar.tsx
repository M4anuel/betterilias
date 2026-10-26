import { t, useLanguage } from '../lib/i18n';
import React from 'react';
import {
  CheckCircle2,
  X,
  Eye,
  Filter,
  Award,
  Users,
} from 'lucide-react';

export interface GradeSavedFeedback {
  id: string;
  memberId: string;
  studentName: string;
  teamId?: string | null;
  status: string; // 'passed' | 'failed' | 'not_graded'
  mark?: string;
  wasFilteredOut: boolean;
}

interface GradingFeedbackBarProps {
  feedback: GradeSavedFeedback | null;
  onDismiss: () => void;
  onViewSubmission?: (memberId: string) => void;
  onResetFilter?: () => void;
}

export const GradingFeedbackBar: React.FC<GradingFeedbackBarProps> = ({
  feedback,
  onDismiss,
  onViewSubmission,
  onResetFilter,
}) => {
  useLanguage();
  if (!feedback) return null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'passed':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-200/80 dark:bg-emerald-900/80 px-2 py-0.5 text-[11px] font-bold text-emerald-900 dark:text-emerald-200 border border-emerald-300/80 dark:border-emerald-700/80">
            {t("Bestanden")}
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-200/80 dark:bg-rose-950/80 px-2 py-0.5 text-[11px] font-bold text-rose-900 dark:text-rose-200 border border-rose-300/80 dark:border-rose-800/80">
            {t("Nicht bestanden")}
          </span>
        );
      case 'not_graded':
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
            {t("Nicht bewertet")}
          </span>
        );
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-emerald-300 dark:border-emerald-700/80 bg-emerald-50/90 dark:bg-emerald-950/40 p-3 sm:p-3.5 text-emerald-900 dark:text-emerald-100 shadow-2xs backdrop-blur-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150"
    >
      <div className="flex items-center gap-3 min-w-0 flex-wrap">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300 shrink-0">
          <CheckCircle2 className="h-4 w-4" />
        </div>

        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs font-bold text-emerald-950 dark:text-emerald-100">
            {t("Bewertung gespeichert:")}
          </span>
          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
            {feedback.studentName}
          </span>

          {feedback.teamId && (
            <span className="inline-flex items-center gap-1 rounded bg-indigo-100/80 dark:bg-indigo-950/80 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              <Users className="h-2.5 w-2.5" />
              <span>#{feedback.teamId}</span>
            </span>
          )}

          {getStatusBadge(feedback.status)}

          {feedback.mark && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100/80 dark:bg-amber-950/80 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
              <Award className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              <span>{feedback.mark}</span>
            </span>
          )}

          {feedback.wasFilteredOut && (
            <span className="text-xs text-emerald-700 dark:text-emerald-300 hidden md:inline">
              • {t("Aus «Zu korrigieren» entfernt, da jetzt bewertet.")}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
        {onViewSubmission && (
          <button
            type="button"
            onClick={() => onViewSubmission(feedback.memberId)}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 hover:bg-emerald-200/80 dark:bg-emerald-900/60 dark:hover:bg-emerald-900 border border-emerald-300/80 dark:border-emerald-700 px-2.5 py-1 text-xs font-semibold text-emerald-900 dark:text-emerald-200 transition cursor-pointer"
          >
            <Eye className="h-3 w-3" />
            <span>{t("Einreichung ansehen")}</span>
          </button>
        )}

        {feedback.wasFilteredOut && onResetFilter && (
          <button
            type="button"
            onClick={onResetFilter}
            className="inline-flex items-center gap-1 rounded-lg bg-white/80 hover:bg-white dark:bg-slate-800 dark:hover:bg-slate-700 border border-emerald-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 transition cursor-pointer shadow-2xs"
          >
            <Filter className="h-3 w-3" />
            <span>{t("Filter aufheben")}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg p-1 text-emerald-700 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-white hover:bg-emerald-200/60 dark:hover:bg-emerald-900/60 transition cursor-pointer ml-1"
          title={t("Schließen")}
          aria-label={t("Schließen")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
