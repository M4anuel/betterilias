import { t, useLanguage } from '../lib/i18n';
import React, { useEffect, useState } from 'react';
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

interface GradingSavedToastProps {
  feedback: GradeSavedFeedback | null;
  onDismiss: () => void;
  onViewSubmission?: (memberId: string) => void;
  onResetFilter?: () => void;
  autoDismissMs?: number;
}

export const GradingSavedToast: React.FC<GradingSavedToastProps> = ({
  feedback,
  onDismiss,
  onViewSubmission,
  onResetFilter,
  autoDismissMs = 6000,
}) => {
  useLanguage();
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (!feedback) return;
    setProgress(100);

    const intervalTime = 50;
    const decrement = (intervalTime / autoDismissMs) * 100;

    const timer = setInterval(() => {
      if (!isPaused) {
        setProgress((prev) => {
          if (prev <= 0) {
            clearInterval(timer);
            onDismiss();
            return 0;
          }
          return prev - decrement;
        });
      }
    }, intervalTime);

    return () => clearInterval(timer);
  }, [feedback, onDismiss, autoDismissMs, isPaused]);

  if (!feedback) return null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'passed':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950/80 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
            {t("Bestanden")}
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 dark:bg-rose-950/80 px-2 py-0.5 text-[11px] font-bold text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
            {t("Nicht bestanden")}
          </span>
        );
      case 'not_graded':
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            {t("Nicht bewertet")}
          </span>
        );
    }
  };

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="fixed bottom-6 right-6 z-50 w-88 sm:w-96 rounded-2xl bg-white/95 dark:bg-slate-900/95 text-slate-900 dark:text-white shadow-2xl border border-emerald-500/30 dark:border-emerald-500/40 backdrop-blur-md overflow-hidden animate-in slide-in-from-bottom-5 duration-200 ring-1 ring-emerald-500/10"
      role="status"
      aria-live="polite"
    >
      {/* Top Countdown Progress Bar */}
      <div className="h-1 w-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full bg-emerald-500 transition-all duration-75 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 shrink-0 mt-0.5">
              <CheckCircle2 className="h-5 w-5" />
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {t("Bewertung gespeichert")}
                </h4>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[160px]">
                  {feedback.studentName}
                </span>

                {feedback.teamId && (
                  <span className="inline-flex items-center gap-1 rounded bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.2 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    <Users className="h-2.5 w-2.5" />
                    <span>#{feedback.teamId}</span>
                  </span>
                )}

                {getStatusBadge(feedback.status)}

                {feedback.mark && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                    <Award className="h-3 w-3 text-amber-500" />
                    <span>{feedback.mark}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
            title={t("Schließen")}
            aria-label={t("Schließen")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Note if filtered out of "Zu korrigieren" */}
        {feedback.wasFilteredOut && (
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-2.5 py-1.5 border border-slate-100 dark:border-slate-800">
            {t("Aus «Zu korrigieren» entfernt, da jetzt bewertet.")}
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-0.5">
          {onViewSubmission && (
            <button
              type="button"
              onClick={() => {
                onViewSubmission(feedback.memberId);
                onDismiss();
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800/80 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300 transition cursor-pointer"
            >
              <Eye className="h-3 w-3" />
              <span>{t("Einreichung ansehen")}</span>
            </button>
          )}

          {feedback.wasFilteredOut && onResetFilter && (
            <button
              type="button"
              onClick={() => {
                onResetFilter();
                onDismiss();
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 transition cursor-pointer"
            >
              <Filter className="h-3 w-3" />
              <span>{t("Filter aufheben")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
