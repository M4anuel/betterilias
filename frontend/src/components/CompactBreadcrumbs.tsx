import { t, useLanguage } from '../lib/i18n';
import React, { useState } from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { BreadcrumbItem } from '../types';

interface CompactBreadcrumbsProps {
  rawBreadcrumbs: BreadcrumbItem[];
  courseNickname?: string;
  courseRefId?: string;
  currentFolderRefId?: string;
  onNavigateHome: () => void;
  onNavigateCourse: (refId: string) => void;
  onNavigateFolder?: (refId: string) => void;
  onNavigateRepository: (refId: string) => void;
  onNavigateSemester?: (semester: string) => void;
}

export function semesterFromTitle(title: string): string | undefined {
  const match = title.trim().match(/^(HS|FS)\s*(\d{4})$/i);
  return match ? `${match[1].toUpperCase()}${match[2]}` : undefined;
}

export const CompactBreadcrumbs: React.FC<CompactBreadcrumbsProps> = ({
  rawBreadcrumbs = [], courseNickname, courseRefId, currentFolderRefId,
  onNavigateHome, onNavigateCourse, onNavigateFolder, onNavigateRepository, onNavigateSemester,
}) => {
  useLanguage();
  const [expanded, setExpanded] = useState(false);
  const semesterIndex = rawBreadcrumbs.findIndex((b) => semesterFromTitle(b.title));
  const courseIndex = rawBreadcrumbs.findIndex((b) => b.ref_id === courseRefId);
  // If there is no semester, collapse only ancestors of the course.
  const split = semesterIndex >= 0 ? semesterIndex : Math.max(0, courseIndex);
  const ancestors = rawBreadcrumbs.slice(0, split).filter((b) => b.ref_id !== '1');
  const visible = rawBreadcrumbs.slice(split).filter((b) => b.ref_id !== '1');
  const courseMissing = courseRefId && courseIndex < 0;
  const separator = <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 mx-1.5 shrink-0 text-slate-400" />;
  const renderCrumb = (b: BreadcrumbItem, index: number) => {
    const semester = semesterFromTitle(b.title);
    const isCourse = b.ref_id === courseRefId;
    const isFolder = courseIndex >= 0 && rawBreadcrumbs.indexOf(b) > courseIndex;
    const current = b.ref_id === currentFolderRefId;
    const navigate = () => {
      if (semester && onNavigateSemester) onNavigateSemester(semester);
      else if (isCourse && courseRefId) onNavigateCourse(courseRefId);
      else if (isFolder && b.ref_id && onNavigateFolder) onNavigateFolder(b.ref_id);
      else if (b.ref_id) onNavigateRepository(b.ref_id);
    };
    return <React.Fragment key={`${b.ref_id || b.title}-${index}`}>
      {separator}
      <button type="button" onClick={navigate} disabled={!b.ref_id && !(semester && onNavigateSemester)}
        aria-current={current ? 'page' : undefined}
        title={semester && onNavigateSemester ? t("Meine Kurse im {p0}", { p0: semester }) : b.title}
        className={`shrink-0 hover:underline disabled:no-underline ${current ? 'font-bold' : 'font-medium'}`}>
        {isCourse ? courseNickname || b.title : b.title}
      </button>
    </React.Fragment>;
  };
  return <nav aria-label={t("Breadcrumb")} className="flex items-center text-xs text-slate-600 dark:text-slate-300 overflow-x-auto py-1">
    {expanded || ancestors.length === 0 ? <button type="button" onClick={() => onNavigateRepository('1')} aria-label={t("Magazin öffnen")} className="shrink-0"><Home className="h-3.5 w-3.5" /></button> : null}
    {ancestors.length > 0 && <>
      {!expanded ? <button type="button" onClick={() => setExpanded(true)} aria-expanded={false} aria-label={t("Vollständigen Pfad anzeigen")} className="flex items-center shrink-0 hover:underline">
        <Home className="h-3.5 w-3.5" />{separator}<span>…</span>
      </button> : <>
        {ancestors.map(renderCrumb)}
        <button type="button" onClick={() => setExpanded(false)} aria-expanded={true} aria-label={t("Pfad einklappen")} className="ml-2 shrink-0 hover:underline">…</button>
      </>}
    </>}
    {visible.map(renderCrumb)}
    {courseMissing && <>{separator}<button type="button" onClick={() => onNavigateCourse(courseRefId)} className="font-semibold shrink-0 hover:underline">{courseNickname || t("Vorlesung")}</button></>}
    {rawBreadcrumbs.length === 0 && <>{separator}<button type="button" onClick={onNavigateHome}>{t("Semester-Übersicht")}</button></>}
  </nav>;
};
