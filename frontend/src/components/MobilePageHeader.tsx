import React, { useEffect, useRef } from 'react';
import { ArrowLeft, MoreVertical, RefreshCw } from 'lucide-react';
import { t } from '../lib/i18n';

export function MobilePageHeader({ title, onBack, onRefresh, refreshing, trailing, children }: {
  title: string; onBack: () => void; onRefresh: () => void; refreshing?: boolean;
  trailing?: React.ReactNode; children?: React.ReactNode;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) menu.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  return <div className="phone-page-header phone-only flex items-center gap-1">
    <button type="button" onClick={onBack} aria-label={t('mobile.back')} className="icon-button shrink-0 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowLeft size={18} /></button>
    <h1 className="min-w-0 flex-1 line-clamp-2 text-base font-bold leading-tight" title={title}>{title}</h1>
    {trailing}
    <details ref={menu} className="relative shrink-0" onKeyDown={event => { if (event.key === 'Escape') { menu.current?.removeAttribute('open'); menu.current?.querySelector('summary')?.focus(); } }}>
      <summary aria-label={t('mobile.actions')} className="icon-button cursor-pointer list-none rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"><MoreVertical size={18} /></summary>
      <div className="absolute right-0 top-full z-30 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900 [&_button]:w-full [&_button]:text-left"
        onClick={event => { if ((event.target as HTMLElement).closest('button')) menu.current?.removeAttribute('open'); }}>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />{t('Neu von ILIAS abrufen')}</button>
        {children}
      </div>
    </details>
  </div>;
}
