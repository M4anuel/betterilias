import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, X, ArrowDownToLine, FileText } from 'lucide-react';
import { useDownloads, downloadManager, formatBytes } from '../lib/downloadManager';
import { t } from '../lib/i18n';

export const DownloadProgressBar: React.FC = () => {
  const downloads = useDownloads();

  if (downloads.length === 0) {
    return null;
  }

  return (
    <div
      className="download-progress-bar-container fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 w-[calc(100%-2rem)] sm:w-96 max-w-full pointer-events-none"
      aria-live="polite"
      aria-label={t("Downloads")}
    >
      {downloads.map((item) => {
        const isPreparing = item.state === 'preparing';
        const isDownloading = item.state === 'downloading';
        const isSaving = item.state === 'saving';
        const isCompleted = item.state === 'completed';
        const isError = item.state === 'error';

        return (
          <div
            key={item.id}
            className="pointer-events-auto flex flex-col gap-2 rounded-2xl bg-white/95 dark:bg-slate-900/95 text-slate-900 dark:text-slate-100 shadow-2xl border border-slate-200/90 dark:border-slate-800 backdrop-blur-md p-3.5 sm:p-4 transition-all animate-in slide-in-from-bottom-4 duration-200"
          >
            {/* Top Row: Icon, Filename & Cancel/Close Action */}
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                    isCompleted
                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                      : isError
                      ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
                      : 'bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400'
                  }`}
                >
                  {isPreparing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isDownloading && <ArrowDownToLine className="h-4 w-4 animate-pulse" />}
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isCompleted && <CheckCircle2 className="h-4 w-4" />}
                  {isError && <AlertCircle className="h-4 w-4" />}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate" title={item.filename}>
                    {item.filename}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isPreparing && (
                      <span className="flex items-center gap-1.5 text-teal-600 dark:text-teal-400">
                        {t("Backend bereitet Datei vor...")}
                      </span>
                    )}
                    {isDownloading && (
                      <span>
                        {item.totalBytes && item.totalBytes > 0 ? (
                          <>
                            <span className="font-semibold text-teal-700 dark:text-teal-300">
                              {item.percent !== null ? `${item.percent}%` : ''}
                            </span>
                            <span className="text-slate-400 dark:text-slate-500 mx-1">•</span>
                            <span>{formatBytes(item.loadedBytes)}</span>
                            <span className="text-slate-400 dark:text-slate-500"> / </span>
                            <span>{formatBytes(item.totalBytes)}</span>
                          </>
                        ) : (
                          <>
                            <span>{formatBytes(item.loadedBytes)}</span>
                            <span className="text-slate-400 dark:text-slate-500"> {t("empfangen...")}</span>
                          </>
                        )}
                      </span>
                    )}
                    {isSaving && (
                      <span className="text-teal-600 dark:text-teal-400 font-medium">
                        {t("Wird im Browser gespeichert...")}
                      </span>
                    )}
                    {isCompleted && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {t("Download abgeschlossen ({p0})", { p0: formatBytes(item.loadedBytes) })}
                      </span>
                    )}
                    {isError && (
                      <span className="text-rose-600 dark:text-rose-400 font-medium">
                        {item.errorMessage || t("Download fehlgeschlagen")}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Close / Cancel Button */}
              <button
                type="button"
                onClick={() => downloadManager.cancel(item.id)}
                className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-xl sm:rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0 cursor-pointer"
                title={isCompleted || isError ? t("Schliessen") : t("Abbrechen")}
                aria-label={isCompleted || isError ? t("Schliessen") : t("Abbrechen")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Progress Bar Track */}
            <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden relative">
              {isPreparing && (
                <div className="h-full bg-teal-500 dark:bg-teal-400 rounded-full w-1/3 animate-[pulse_1s_ease-in-out_infinite]" />
              )}
              {isDownloading && (
                <div
                  className={`h-full bg-teal-600 dark:bg-teal-500 rounded-full transition-all duration-150 ${
                    item.percent === null ? 'w-2/5 animate-[pulse_1s_ease-in-out_infinite]' : ''
                  }`}
                  style={item.percent !== null ? { width: `${item.percent}%` } : undefined}
                />
              )}
              {isSaving && (
                <div className="h-full bg-teal-500 dark:bg-teal-400 rounded-full w-full animate-pulse" />
              )}
              {isCompleted && (
                <div className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full w-full" />
              )}
              {isError && (
                <div className="h-full bg-rose-500 dark:bg-rose-400 rounded-full w-full" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

