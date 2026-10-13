import React from 'react';
import { ChevronRight, Home, Folder } from 'lucide-react';
import { BreadcrumbItem } from '../types';

interface CompactBreadcrumbsProps {
  rawBreadcrumbs: BreadcrumbItem[];
  courseNickname?: string;
  courseRefId?: string;
  currentFolderRefId?: string;
  onNavigateHome: () => void;
  onNavigateCourse: (refId: string) => void;
  onNavigateFolder?: (refId: string) => void;
}

export const CompactBreadcrumbs: React.FC<CompactBreadcrumbsProps> = ({
  rawBreadcrumbs = [],
  courseNickname,
  courseRefId,
  currentFolderRefId,
  onNavigateHome,
  onNavigateCourse,
  onNavigateFolder,
}) => {
  // Filter out redundant ILIAS items: Repository, Fakultät, Vorlesung/Seminar
  const ignoredWords = ['repository', 'fakultät', 'fakultat', 'vorlesung', 'seminar', 'magazin', 'root'];

  // Identify Subject (e.g. Informatik, BWL) and Semester (e.g. HS2026) from breadcrumbs
  let subject: BreadcrumbItem | null = null;
  let semester: BreadcrumbItem | null = null;
  let subfolders: BreadcrumbItem[] = [];

  let foundCourse = false;

  for (const b of rawBreadcrumbs) {
    const titleLower = b.title.toLowerCase();

    // Check if ignored
    if (ignoredWords.some((w) => titleLower.includes(w))) {
      continue;
    }

    // Check if semester (e.g., HS2026, FS2025)
    if (/^(HS|FS)\d{4}$/i.test(b.title.trim())) {
      semester = b;
      continue;
    }

    // If it's before the course and not a semester/ignored, treat as subject (Informatik, etc.)
    if (!foundCourse && (b.ref_id === courseRefId || titleLower.includes('schnittstelle') || titleLower.includes('personal') || b.ref_id)) {
      if (b.ref_id === courseRefId) {
        foundCourse = true;
        continue;
      }
      if (!subject) {
        subject = b;
        continue;
      }
    }

    if (b.ref_id === courseRefId) {
      foundCourse = true;
      continue;
    }

    // If after course, it is a subfolder
    if (foundCourse) {
      subfolders.push(b);
    }
  }

  return (
    <nav aria-label="Compact Breadcrumb" className="flex items-center text-xs text-slate-500 dark:text-slate-400 overflow-x-auto py-1">
      {/* Home / Semester trigger */}
      <button
        onClick={onNavigateHome}
        className="flex items-center gap-1 font-medium hover:text-slate-900 dark:hover:text-slate-100 transition shrink-0 cursor-pointer"
        title="Startseite / Semester"
      >
        <Home className="h-3.5 w-3.5" />
        <span>Start</span>
      </button>

      {/* Subject */}
      {subject && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 mx-1.5 shrink-0" />
          <span className="font-medium text-slate-600 dark:text-slate-300 shrink-0">{subject.title}</span>
        </>
      )}

      {/* Semester */}
      {semester && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 mx-1.5 shrink-0" />
          <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 shrink-0">
            {semester.title}
          </span>
        </>
      )}

      {/* Course Title (or Nickname) */}
      {courseRefId && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 mx-1.5 shrink-0" />
          <button
            onClick={() => onNavigateCourse(courseRefId)}
            style={currentFolderRefId === courseRefId ? { color: 'var(--accent, #0AACA5)' } : {}}
            className={`font-semibold shrink-0 hover:underline cursor-pointer ${
              currentFolderRefId === courseRefId
                ? 'font-bold'
                : 'text-slate-800 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {courseNickname || 'Vorlesung'}
          </button>
        </>
      )}

      {/* Subfolder steps if navigating inside course */}
      {subfolders.map((sf, idx) => {
        const isLast = idx === subfolders.length - 1;
        return (
          <React.Fragment key={sf.ref_id || idx}>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 mx-1.5 shrink-0" />
            <button
              onClick={() => sf.ref_id && onNavigateFolder?.(sf.ref_id)}
              disabled={isLast || !sf.ref_id}
              className={`flex items-center gap-1 shrink-0 ${
                isLast
                  ? 'font-bold text-slate-900 dark:text-slate-100 cursor-default'
                  : 'font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:underline cursor-pointer'
              }`}
            >
              <Folder className="h-3 w-3 text-amber-500 fill-amber-100 dark:fill-amber-950/40" />
              <span>{sf.title}</span>
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
};

