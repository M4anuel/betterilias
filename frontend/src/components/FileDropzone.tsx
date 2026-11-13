import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { t, useLanguage } from '../lib/i18n';

/** Shared file selection for course uploads and forum attachments. */
export function FileDropzone({ onFiles, disabled = false, compact = false, accept }: {
  onFiles: (files: File[]) => void; disabled?: boolean; compact?: boolean; accept?: string;
}) {
  useLanguage();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <div data-file-dropzone className={`rounded-xl border-2 border-dashed text-center ${compact ? 'p-3' : 'p-6'} ${dragging && !disabled ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40' : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40'} ${disabled ? 'opacity-60' : ''}`}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); if (!disabled) onFiles(Array.from(event.dataTransfer.files)); }}>
    <Upload aria-hidden="true" className="mx-auto mb-2 h-5 w-5 text-teal-600 dark:text-teal-400" />
    <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">{t('authoring.drop_files')}</p>
    <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="min-h-11 rounded-lg border border-teal-600 px-4 text-sm font-semibold text-teal-800 focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-teal-400 dark:text-teal-200">{t('authoring.browse_files')}</button>
    <input ref={input} type="file" accept={accept} multiple hidden disabled={disabled} aria-label={t('authoring.browse_files')} onChange={event => {
      const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = '';
      if (!disabled) onFiles(files);
    }} />
  </div>;
}
