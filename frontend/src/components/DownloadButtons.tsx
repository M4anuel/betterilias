import React from 'react';
import { Download, Loader2, Check } from 'lucide-react';
import { api } from '../lib/api';
import { downloadManager, useDownloadItem } from '../lib/downloadManager';
import { t } from '../lib/i18n';

export interface TAExportZipButtonProps {
  exerciseRefId: string;
  assId: string;
  taId?: string;
  variant: 'compact' | 'toolbar';
}

export const TAExportZipButton: React.FC<TAExportZipButtonProps> = ({
  exerciseRefId,
  assId,
  taId,
  variant,
}) => {
  const zipUrl = api.getTAExportZipUrl(exerciseRefId, assId, taId !== 'all' ? taId : undefined);
  const downloadItem = useDownloadItem(zipUrl);

  const isPreparing = downloadItem?.state === 'preparing';
  const isDownloading = downloadItem?.state === 'downloading';
  const isCompleted = downloadItem?.state === 'completed';
  const percent = downloadItem?.percent ?? null;
  const inProgress = isPreparing || isDownloading;

  const title =
    taId === 'all'
      ? t("Abgaben als ZIP-Paket exportieren")
      : t("Abgaben für ausgewählten Tutor als ZIP-Paket exportieren");

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    downloadManager.startDownload(zipUrl, {
      fallbackFilename: `Submissions_${exerciseRefId}_{assId}${taId && taId !== 'all' ? `_${taId}` : '_all'}.zip`,
    });
  };

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={inProgress}
        className="flex items-center justify-center h-6 w-6 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-700 transition cursor-pointer shrink-0 ml-1 mr-0.5 disabled:cursor-wait"
        title={title}
        aria-label={title}
      >
        {inProgress ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-teal-600 dark:text-teal-400" />
        ) : isCompleted ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Download className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={inProgress}
      className="relative overflow-hidden flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold transition cursor-pointer shrink-0 whitespace-nowrap disabled:cursor-wait"
      title={title}
      aria-label={title}
    >
      {inProgress && (
        <div
          className="absolute inset-0 bg-teal-500/15 dark:bg-teal-500/25 pointer-events-none transition-all duration-150"
          style={{ width: `${percent !== null ? percent : 100}%` }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        {inProgress ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-teal-600 dark:text-teal-400" />
        ) : isCompleted ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Download className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="desktop-only">
          {isPreparing
            ? t("ZIP wird erstellt...")
            : isDownloading
            ? percent !== null
              ? `${percent}%`
              : t("Wird geladen...")
            : isCompleted
            ? t("Fertig")
            : t("ZIP-Paket")}
        </span>
      </span>
    </button>
  );
};

export interface SubmissionDownloadButtonProps {
  exerciseRefId: string;
  downloadUrl: string;
  fallbackFilename?: string;
  knownSize?: string;
  className?: string;
}

export const SubmissionDownloadButton: React.FC<SubmissionDownloadButtonProps> = ({
  exerciseRefId,
  downloadUrl,
  fallbackFilename,
  knownSize,
  className,
}) => {
  const fullUrl = api.getDownloadUrl(exerciseRefId, downloadUrl);
  const downloadItem = useDownloadItem(fullUrl);

  const isPreparing = downloadItem?.state === 'preparing';
  const isDownloading = downloadItem?.state === 'downloading';
  const isCompleted = downloadItem?.state === 'completed';
  const percent = downloadItem?.percent ?? null;
  const inProgress = isPreparing || isDownloading;

  const defaultClasses =
    'submission-download relative overflow-hidden flex items-center gap-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition shadow-2xs border border-indigo-200 dark:border-indigo-800 cursor-pointer disabled:cursor-wait';

  return (
    <button
      type="button"
      onClick={() => downloadManager.startDownload(fullUrl, { fallbackFilename, knownSize })}
      disabled={inProgress}
      aria-label={t("Abgabe herunterladen")}
      className={className || defaultClasses}
    >
      {inProgress && (
        <div
          className="absolute inset-0 bg-indigo-500/25 dark:bg-indigo-400/25 pointer-events-none transition-all duration-150"
          style={{ width: `${percent !== null ? percent : 100}%` }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        {inProgress ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : isCompleted ? (
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        ) : (
          <Download className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="desktop-only">
          {isPreparing
            ? t("Vorbereiten...")
            : isDownloading
            ? percent !== null
              ? `${percent}%`
              : t("Wird geladen...")
            : isCompleted
            ? t("Heruntergeladen")
            : t("Abgabe herunterladen")}
        </span>
        <span className="phone-only">
          {inProgress
            ? percent !== null
              ? `${percent}%`
              : "..."
            : isCompleted
            ? t("Fertig")
            : t("Download")}
        </span>
      </span>
    </button>
  );
};

export interface MaterialDownloadButtonProps {
  refId: string;
  downloadUrl?: string;
  title: string;
  fileSize?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const MaterialDownloadButton: React.FC<MaterialDownloadButtonProps> = ({
  refId,
  downloadUrl,
  title,
  fileSize,
  className,
  style,
}) => {
  const fullUrl = api.getDownloadUrl(refId, downloadUrl);
  const downloadItem = useDownloadItem(fullUrl);

  const isPreparing = downloadItem?.state === 'preparing';
  const isDownloading = downloadItem?.state === 'downloading';
  const isCompleted = downloadItem?.state === 'completed';
  const percent = downloadItem?.percent ?? null;
  const inProgress = isPreparing || isDownloading;

  const defaultClasses =
    'relative overflow-hidden min-h-11 min-w-11 md:min-h-0 md:min-w-0 flex items-center justify-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold hover:opacity-90 transition shadow-2xs cursor-pointer disabled:cursor-wait';

  return (
    <button
      type="button"
      onClick={() => downloadManager.startDownload(fullUrl, { fallbackFilename: title, knownSize: fileSize })}
      disabled={inProgress}
      style={style}
      aria-label={t("Download")}
      className={`${defaultClasses} ${className || ''}`}
    >
      {inProgress && (
        <div
          className="absolute inset-0 bg-white/20 dark:bg-white/10 pointer-events-none transition-all duration-150"
          style={{ width: `${percent !== null ? percent : 100}%` }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1">
        {inProgress ? (
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        ) : isCompleted ? (
          <Check className="h-3 w-3 shrink-0" />
        ) : (
          <Download className="h-3 w-3 shrink-0" />
        )}
        <span className="desktop-only">
          {isCompleted
            ? t("Fertig")
            : inProgress
            ? percent !== null
              ? `${percent}%`
              : t("Wird geladen...")
            : t("Download")}
        </span>
      </span>
    </button>
  );
};

export interface FeedbackFileDownloadButtonProps {
  exerciseRefId: string;
  downloadUrl: string;
  filename?: string;
  size?: string;
  className?: string;
}

export const FeedbackFileDownloadButton: React.FC<FeedbackFileDownloadButtonProps> = ({
  exerciseRefId,
  downloadUrl,
  filename,
  size,
  className,
}) => {
  const fullUrl = api.getDownloadUrl(exerciseRefId, downloadUrl);
  const downloadItem = useDownloadItem(fullUrl);

  const isPreparing = downloadItem?.state === 'preparing';
  const isDownloading = downloadItem?.state === 'downloading';
  const isCompleted = downloadItem?.state === 'completed';
  const inProgress = isPreparing || isDownloading;

  return (
    <button
      type="button"
      onClick={() => downloadManager.startDownload(fullUrl, { fallbackFilename: filename, knownSize: size })}
      disabled={inProgress}
      className={
        className ||
        'inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 cursor-pointer disabled:cursor-wait'
      }
    >
      {inProgress ? (
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
      ) : isCompleted ? (
        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
      ) : (
        <Download className="h-3 w-3 shrink-0" />
      )}
      <span>{inProgress ? t("Wird geladen...") : t("Download")}</span>
    </button>
  );
};

