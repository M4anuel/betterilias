import React, { useEffect, useState } from 'react';
import { ChevronRight, Folder, GraduationCap, Home, Lock, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { RepositoryResponse } from '../types';

interface Props {
  refId: string;
  onNavigate: (refId: string) => void;
  onOpenCourse: (refId: string) => void;
}

export const RepositoryView: React.FC<Props> = ({ refId, onNavigate, onOpenCourse }) => {
  const [data, setData] = useState<RepositoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    api.getRepository(refId).then((next) => { if (active) setData(next); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [refId, revision]);
  const crumbs = data?.breadcrumbs.filter((b) => b.ref_id !== '1') || [];
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
      <h1 className="text-2xl font-bold">{data?.title || 'Magazin'}</h1>
      <button type="button" onClick={() => setRevision((v) => v + 1)} aria-label="Magazin aktualisieren" className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800"><RefreshCw className="h-4 w-4" /></button>
    </div>
    {error ? <div role="alert" className="text-red-600">{error} <button type="button" onClick={() => setRevision((v) => v + 1)} className="underline">Erneut versuchen</button></div>
      : !data ? <p role="status">Magazin wird geladen…</p>
      : data.items.length === 0 ? <p className="text-slate-500">Keine sichtbaren Einträge vorhanden.</p>
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map((item) => {
          const container = ['cat', 'fold', 'grp', 'crs'].includes(item.item_type);
          const content = <>
            {!item.accessible ? <Lock className="h-5 w-5 shrink-0 text-slate-400" /> : item.item_type === 'crs' ? <GraduationCap className="h-5 w-5 shrink-0 text-teal-600" /> : <Folder className="h-5 w-5 shrink-0 text-amber-500" />}
            <span className="min-w-0"><span className="block font-semibold">{item.title}</span>
              {item.description && <span className="block text-xs text-slate-500 mt-1">{item.description}</span>}
              {!item.accessible && <span className="block text-xs text-slate-500 mt-1">Inhalt nicht zugänglich</span>}
            </span>
          </>;
          const className = 'flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left text-sm hover:border-teal-500 disabled:opacity-60 disabled:cursor-default';
          return container || !item.accessible
            ? <button type="button" key={item.ref_id} disabled={!item.accessible} className={className}
                onClick={() => item.item_type === 'crs' ? onOpenCourse(item.ref_id) : onNavigate(item.ref_id)}>{content}</button>
            : <a key={item.ref_id} href={item.url} target="_blank" rel="noreferrer" className={className}>{content}<span className="sr-only">In ILIAS öffnen</span></a>;
        })}
      </div>}
  </div>;
};
