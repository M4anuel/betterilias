import React, { useEffect, useState } from 'react';
import { ChevronRight, Folder, Home, Lock, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { RepositoryResponse, MembershipAction } from '../types';
import { CourseIcon } from './CourseIcon';

interface Props {
  refId: string;
  onNavigate: (refId: string) => void;
  onOpenCourse: (refId: string) => void;
  onManageMembership: (refId: string, title: string, action: MembershipAction) => void;
}

export const RepositoryView: React.FC<Props> = ({ refId, onNavigate, onOpenCourse, onManageMembership }) => {
  const [data, setData] = useState<RepositoryResponse | null>(() => cache.getCachedRepository(refId));
  const [location] = useState(() => cache.getRepositoryLocation(refId));
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    setIsRefreshing(true);
    api.getRepository(refId).then((next) => {
      if (active) {
        cache.setCachedRepository(next);
        setData(next);
      }
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setIsRefreshing(false); });
    return () => { active = false; };
  }, [refId, revision]);
  const crumbs = (data?.breadcrumbs || location?.breadcrumbs || []).filter((b) => b.ref_id !== '1');
  const title = data?.title || location?.title;
  return <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
    <nav aria-label="Magazin-Pfad" className="flex items-center flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
      <button type="button" onClick={() => onNavigate('1')} aria-label="Magazin öffnen"><Home className="h-4 w-4" /></button>
      {crumbs.map((crumb, index) => <React.Fragment key={`${crumb.ref_id}-${index}`}>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <button type="button" onClick={() => crumb.ref_id && onNavigate(crumb.ref_id)} disabled={!crumb.ref_id}
          aria-current={crumb.ref_id === refId ? 'page' : undefined} className="hover:underline">{crumb.title}</button>
      </React.Fragment>)}
    </nav>
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-2xl font-bold">{title || <span aria-label="Titel wird geladen" className="block h-8 w-48 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />}</h1>
      <button type="button" onClick={() => setRevision((v) => v + 1)} disabled={isRefreshing} aria-label="Magazin aktualisieren" className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800"><RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} /></button>
    </div>
    {error && <div role="alert" className="text-red-600">{error} <button type="button" onClick={() => setRevision((v) => v + 1)} className="underline">Erneut versuchen</button></div>}
    {!data ? !error && <p role="status">Inhalte werden geladen…</p>
      : data.items.length === 0 ? <p className="text-slate-500">Keine sichtbaren Einträge vorhanden.</p>
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map((item) => {
          const container = ['cat', 'fold', 'grp', 'crs'].includes(item.item_type);
          const content = <>
            {!item.accessible ? <Lock className="h-5 w-5 shrink-0 text-slate-400" /> : item.item_type === 'crs' ? <CourseIcon iconName={cache.getCourseIcon(item.ref_id, { breadcrumbs: data.breadcrumbs })} className="h-5 w-5 shrink-0 text-teal-600" /> : <Folder className="h-5 w-5 shrink-0 text-amber-500" />}
            <span className="min-w-0"><span className="block font-semibold">{item.title}</span>
              {item.description && <span className="block text-xs text-slate-500 mt-1">{item.description}</span>}
              {!item.accessible && <span className="block text-xs text-slate-500 mt-1">Inhalt nicht zugänglich</span>}
            </span>
          </>;
          const className = 'flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left text-sm hover:border-teal-500 disabled:opacity-60 disabled:cursor-default';
          return container || !item.accessible
            ? <div key={item.ref_id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <button type="button" disabled={!item.accessible} className={`${className} w-full !border-0`}
                  onClick={() => item.item_type === 'crs' ? onOpenCourse(item.ref_id) : onNavigate(item.ref_id)}>{content}</button>
                {(item.membership?.can_join || item.membership?.can_leave) && <button type="button"
                  onClick={() => onManageMembership(item.ref_id, item.title, item.membership?.can_join ? 'join' : 'leave')}
                  aria-label={`${item.membership?.can_join ? 'Kurs beitreten' : 'Kurs verlassen'}: ${item.title}`}
                  className="mx-4 mb-3 text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline">
                  {item.membership?.can_join ? 'Kurs beitreten' : 'Kurs verlassen'}
                </button>}
              </div>
            : <a key={item.ref_id} href={item.url} target="_blank" rel="noreferrer" className={className}>{content}<span className="sr-only">In ILIAS öffnen</span></a>;
        })}
      </div>}
  </div>;
};
