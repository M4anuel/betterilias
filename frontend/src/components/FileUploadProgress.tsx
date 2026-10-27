import { t } from '../lib/i18n';

export type FileUploadState = 'pending' | 'saving' | 'saved' | 'failed';

/** Transfer bytes are measurable; ILIAS saving/verification has no percentage. */
export function FileUploadProgress({ filename, status, progress }: {
  filename: string; status: FileUploadState; progress: number;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  const processing = status === 'saving' && percent >= 100;
  const transferring = status === 'saving' && !processing;
  const phase = processing ? t('authoring.processing') : transferring ? t('authoring.transferring') : t(`authoring.${status}`);
  return <div className="mt-2 space-y-2">
    <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
      <span role="status" className={status === 'saved' ? 'text-teal-700 dark:text-teal-300' : status === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}>{phase}</span>
      {(transferring || status === 'saved') && <span aria-hidden="true" className="shrink-0 font-medium tabular-nums text-slate-500 dark:text-slate-400">{status === 'saved' ? 100 : percent}%</span>}
    </div>
    {(status === 'saving' || status === 'saved') && <div role="progressbar"
      aria-label={t('authoring.file_progress', { name: filename })}
      aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={processing ? undefined : status === 'saved' ? 100 : percent}
      aria-valuetext={transferring ? `${phase} ${percent}%` : phase}
      className="relative h-2 overflow-hidden rounded-full bg-slate-200/80 shadow-inner dark:bg-slate-700/70">
      <div className={`absolute inset-y-0 left-0 overflow-hidden rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-teal-400 shadow-[0_0_10px_rgba(10,172,165,0.2)] ${processing ? 'upload-progress-processing' : 'transition-[width] duration-300 ease-out motion-reduce:transition-none'}`}
        style={{ width: processing ? '35%' : `${status === 'saved' ? 100 : percent}%` }}>
        <div className="absolute inset-x-0 top-0 h-1/2 rounded-full bg-gradient-to-b from-white/35 to-transparent" />
      </div>
    </div>}
  </div>;
}
