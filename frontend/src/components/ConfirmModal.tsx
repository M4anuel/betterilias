import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { t } from '../lib/i18n';
import { ActiveDialogState, registerDialogListener } from '../lib/dialog';

export const ConfirmModal: React.FC = () => {
  const [dialogState, setDialogState] = useState<ActiveDialogState | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return registerDialogListener((state) => {
      setDialogState(state);
    });
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (dialogState) {
      if (!el.open) {
        try {
          el.showModal();
        } catch {
          // If already open or showModal fails in unsupported test runners
        }
      }
      // Focus appropriate action button
      setTimeout(() => {
        if (dialogState.isAlert) {
          confirmButtonRef.current?.focus();
        } else {
          cancelButtonRef.current?.focus();
        }
      }, 50);
    } else {
      if (el.open) {
        el.close();
      }
    }
  }, [dialogState]);

  if (!dialogState) return null;

  const handleConfirm = () => {
    const resolve = dialogState.resolve;
    setDialogState(null);
    resolve(true);
  };

  const handleCancel = () => {
    const resolve = dialogState.resolve;
    setDialogState(null);
    resolve(false);
  };

  const variant = dialogState.variant || 'warning';

  const renderIcon = () => {
    switch (variant) {
      case 'danger':
        return (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
            <AlertCircle className="h-6 w-6" />
          </div>
        );
      case 'info':
        return (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
            <Info className="h-6 w-6" />
          </div>
        );
      case 'warning':
      default:
        return (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
        );
    }
  };

  const confirmBtnClasses = () => {
    switch (variant) {
      case 'danger':
        return 'bg-rose-600 hover:bg-rose-700 text-white shadow-xs focus:ring-rose-500';
      case 'info':
        return 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs focus:ring-indigo-500';
      case 'warning':
      default:
        return 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs focus:ring-amber-500';
    }
  };

  const title =
    dialogState.title ||
    (variant === 'danger'
      ? t("Bestätigung erforderlich")
      : variant === 'info'
      ? t("Hinweis")
      : t("Warnung"));

  const confirmLabel =
    dialogState.confirmLabel ||
    (dialogState.isAlert ? t("OK") : t("Bestätigen"));

  const cancelLabel = dialogState.cancelLabel || t("Abbrechen");

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-description"
      onCancel={(e) => {
        e.preventDefault();
        handleCancel();
      }}
      className="m-auto w-[min(30rem,92vw)] max-h-[90dvh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 text-slate-900 dark:text-slate-100 shadow-2xl backdrop:bg-black/60 dark:backdrop:bg-black/80 backdrop:backdrop-blur-xs transition-colors"
    >
      <div className="flex items-start gap-3.5 sm:gap-4">
        {renderIcon()}

        <div className="flex-1 min-w-0 pr-6">
          <h2
            id="confirm-modal-title"
            className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug"
          >
            {title}
          </h2>

          <div
            id="confirm-modal-description"
            className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line"
          >
            {dialogState.message}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCancel}
          aria-label={t("Schließen")}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
        {!dialogState.isAlert && (
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={handleCancel}
            className="min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/80 transition cursor-pointer text-center"
          >
            {cancelLabel}
          </button>
        )}

        <button
          ref={confirmButtonRef}
          type="button"
          onClick={handleConfirm}
          className={`min-h-[44px] sm:min-h-[38px] px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer text-center focus:outline-hidden focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${confirmBtnClasses()}`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
};
