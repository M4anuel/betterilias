import { t } from '../lib/i18n';
import { LoaderCircle } from 'lucide-react';

export type FileUploadState = 'pending' | 'saving' | 'saved' | 'failed';

/** Keep the activity indicator consistent throughout transfer and ILIAS processing. */
export function FileUploadProgress({ filename, status, progress }: {
  filename: string; status: FileUploadState; progress: number;
}) {
  const processing = status === 'saving' && progress >= 100;
  const transferring = status === 'saving' && !processing;
  const phase = processing ? t('authoring.processing') : transferring ? t('authoring.transferring') : t(`authoring.${status}`);
  return <div role="status" aria-label={t('authoring.file_progress', { name: filename })} className="mt-2 flex items-center gap-2 text-[11px] leading-4">
    {status === 'saving' && <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin text-teal-600 motion-reduce:animate-none dark:text-teal-300" />}
    <span className={status === 'saved' ? 'text-teal-700 dark:text-teal-300' : status === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}>{phase}</span>
  </div>;
}
