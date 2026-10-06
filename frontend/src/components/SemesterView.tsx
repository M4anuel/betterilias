import React, { useState } from 'react';
import { User, ArrowRight, Clock, GraduationCap, Calendar, RefreshCw, LayoutGrid, List } from 'lucide-react';
import { SemesterScreenResponse, CourseItem } from '../types';
import { cache } from '../lib/cache';
import { CourseIcon } from './CourseIcon';

export interface SemesterOption {
  id: string;
  short: string;
  full: string;
}

export const ALL_SEMESTERS: SemesterOption[] = [
  { id: 'HS2026', short: 'HS 2026', full: 'Herbstsemester 2026 (Aktuell)' },
  { id: 'FS2026', short: 'FS 2026', full: 'Frühjahrssemester 2026' },
  { id: 'HS2025', short: 'HS 2025', full: 'Herbstsemester 2025' },
  { id: 'FS2025', short: 'FS 2025', full: 'Frühjahrssemester 2025' },
  { id: 'HS2024', short: 'HS 2024', full: 'Herbstsemester 2024' },
  { id: 'FS2024', short: 'FS 2024', full: 'Frühjahrssemester 2024' },
  { id: 'HS2023', short: 'HS 2023', full: 'Herbstsemester 2023' },
  { id: 'FS2023', short: 'FS 2023', full: 'Frühjahrssemester 2023' },
  { id: 'HS2022', short: 'HS 2022', full: 'Herbstsemester 2022 (Studienbeginn)' },
  { id: 'FS2022', short: 'FS 2022', full: 'Frühjahrssemester 2022' },
  { id: 'HS2021', short: 'HS 2021', full: 'Herbstsemester 2021' },
  { id: 'FS2027', short: 'FS 2027', full: 'Frühjahrssemester 2027 (Vorschau)' },
];

interface SemesterViewProps {
  semesterData: SemesterScreenResponse | null;
  selectedSemester: string;
  onSelectSemester: (semId: string) => void;
  onSelectCourse: (refId: string) => void;
  lastOpenedCourseId: string | null;
  coursesList: CourseItem[];
  isLoading: boolean;
}

export const SemesterView: React.FC<SemesterViewProps> = ({
  semesterData,
  selectedSemester,
  onSelectSemester,
  onSelectCourse,
  lastOpenedCourseId,
  coursesList,
  isLoading,
}) => {
  // Find last opened course object if available
  const lastOpenedCourse = coursesList.find((c) => c.ref_id === lastOpenedCourseId);

  // View mode: 'cards' or 'list'
  const [viewMode, setViewMode] = useState<'cards' | 'list'>(() => cache.getSemesterViewMode());

  const handleViewModeChange = (mode: 'cards' | 'list') => {
    setViewMode(mode);
    cache.setSemesterViewMode(mode);
  };

  // Quick pills: recent semesters plus active if not already in recent
  const defaultPillIds = ['HS2026', 'FS2026', 'HS2025', 'FS2025'];
  const pillIds = defaultPillIds.includes(selectedSemester)
    ? defaultPillIds
    : [selectedSemester, ...defaultPillIds];

  const currentSemesterMeta =
    ALL_SEMESTERS.find((s) => s.id === selectedSemester) || {
      id: selectedSemester,
      short: selectedSemester,
      full: selectedSemester,
    };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200">
      {/* Hero Welcome & Last Opened Course banner */}
      {lastOpenedCourse && (
        <div className="rounded-2xl border border-red-100 bg-gradient-to-r from-red-50 via-white to-slate-50 p-6 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-sm">
              <Clock className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-red-700 uppercase tracking-wider">Zuletzt geöffnet</span>
                <span className="rounded bg-red-100/60 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                  {lastOpenedCourse.semester || selectedSemester}
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                {cache.getDisplayName(lastOpenedCourse.ref_id, lastOpenedCourse.title)}
              </h2>
              <p className="text-xs text-slate-500 line-clamp-1">{lastOpenedCourse.title}</p>
            </div>
          </div>

          <button
            onClick={() => onSelectCourse(lastOpenedCourse.ref_id)}
            className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-red-700 transition shrink-0"
          >
            <span>Weiterlernen</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Semester Switcher Header & Controls */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <GraduationCap className="h-6 w-6 text-red-600" />
              <span>Vorlesungsübersicht</span>
              {isLoading && (
                <RefreshCw className="h-4 w-4 animate-spin text-slate-400 ml-2" />
              )}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Aktuell ausgewählt: <strong className="text-slate-800">{currentSemesterMeta.full}</strong>
            </p>
          </div>

          {/* Combined Selection Controls: Quick Pills + Full Archive Dropdown + View Mode */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Pills */}
            <div className="flex items-center gap-1 rounded-xl bg-slate-200/70 p-1">
              {pillIds.map((semId) => {
                const isActive = semId === selectedSemester;
                const semMeta = ALL_SEMESTERS.find((s) => s.id === semId);
                const label = semMeta ? semMeta.short : semId;

                return (
                  <button
                    key={semId}
                    type="button"
                    onClick={() => onSelectSemester(semId)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      isActive
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Archive / Full Semester Dropdown */}
            <div className="relative flex items-center">
              <div className="relative">
                <select
                  value={selectedSemester}
                  onChange={(e) => onSelectSemester(e.target.value)}
                  className="appearance-none rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-8 text-xs font-semibold text-slate-700 shadow-xs hover:border-slate-300 focus:border-red-500 focus:outline-hidden focus:ring-2 focus:ring-red-100 transition cursor-pointer"
                  title="Anderes Semester auswählen"
                >
                  <optgroup label="Aktuelle & Künftige Semester">
                    <option value="HS2026">HS 2026 – Herbstsemester (Aktuell)</option>
                    <option value="FS2027">FS 2027 – Frühjahrssemester (Vorschau)</option>
                  </optgroup>
                  <optgroup label="Vergangene Semester (2024 – 2026)">
                    <option value="FS2026">FS 2026 – Frühjahrssemester</option>
                    <option value="HS2025">HS 2025 – Herbstsemester</option>
                    <option value="FS2025">FS 2025 – Frühjahrssemester</option>
                    <option value="HS2024">HS 2024 – Herbstsemester</option>
                    <option value="FS2024">FS 2024 – Frühjahrssemester</option>
                  </optgroup>
                  <optgroup label="Studienbeginn (2021 – 2023)">
                    <option value="HS2023">HS 2023 – Herbstsemester</option>
                    <option value="FS2023">FS 2023 – Frühjahrssemester</option>
                    <option value="HS2022">HS 2022 – Herbstsemester (Studienbeginn)</option>
                    <option value="FS2022">FS 2022 – Frühjahrssemester</option>
                    <option value="HS2021">HS 2021 – Herbstsemester</option>
                  </optgroup>
                </select>
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              </div>
            </div>

            {/* View Mode Toggle: Cards vs. List */}
            <div className="flex items-center gap-0.5 rounded-xl bg-slate-200/70 p-1" title="Ansicht umschalten">
              <button
                type="button"
                onClick={() => handleViewModeChange('cards')}
                className={`rounded-lg p-1.5 transition ${
                  viewMode === 'cards'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
                }`}
                title="Kartenansicht"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange('list')}
                className={`rounded-lg p-1.5 transition ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
                }`}
                title="Kompakte Listenansicht"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Loading state when no data exists yet */}
        {isLoading && !semesterData && (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
              <span className="text-xs font-medium">Lade Semester-Angebote für {currentSemesterMeta.short}...</span>
            </div>
          </div>
        )}

        {/* Empty state if semester has no courses */}
        {!isLoading && semesterData && Object.keys(semesterData.grouped_by_category).length === 0 && (
          <div className="flex h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
            <GraduationCap className="h-8 w-8 text-slate-300 mb-2" />
            <h4 className="text-sm font-bold text-slate-700">Keine Vorlesungen gefunden</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              Für das Semester <strong>{currentSemesterMeta.full}</strong> sind keine eingeschriebenen Module vorhanden.
            </p>
          </div>
        )}

        {/* Categories & Course Cards / List */}
        {semesterData && Object.keys(semesterData.grouped_by_category).length > 0 && (
          <div className="space-y-8">
            {Object.entries(semesterData.grouped_by_category).map(([category, courses]) => (
              <div key={category} className="space-y-3.5">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">{category}</h3>
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-semibold text-slate-400">{courses.length} Vorlesungen</span>
                </div>

                {viewMode === 'cards' ? (
                  /* Cards Grid View */
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {courses.map((course) => {
                      const displayName = cache.getDisplayName(course.ref_id, course.title);
                      const iconName = cache.getCourseIcon(course.ref_id);

                      return (
                        <div
                          key={course.ref_id}
                          onClick={() => onSelectCourse(course.ref_id)}
                          className="group relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-red-300 hover:shadow-md cursor-pointer"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-red-50 group-hover:text-red-600 transition">
                                <CourseIcon iconName={iconName} className="h-5 w-5" />
                              </div>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-600">
                                {course.ref_id}
                              </span>
                            </div>

                            <h4 className="mt-3.5 text-base font-bold text-slate-900 group-hover:text-red-600 transition leading-snug">
                              {displayName}
                            </h4>

                            {displayName !== course.title && (
                              <p className="mt-1 text-xs text-slate-400 line-clamp-1" title={course.title}>
                                {course.title}
                              </p>
                            )}
                          </div>

                          {/* Contact or Lecturer */}
                          <div className="mt-5 border-t border-slate-100 pt-3 flex items-center justify-between text-xs text-slate-500">
                            {course.description ? (
                              <div className="flex items-center gap-1.5 truncate pr-2">
                                <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span className="truncate">{course.description.replace('Contact: ', '')}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400">Keine Dozenten-Info</span>
                            )}
                            <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-red-600 group-hover:translate-x-0.5 transition shrink-0" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Compact List View */
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden">
                    {courses.map((course) => {
                      const displayName = cache.getDisplayName(course.ref_id, course.title);
                      const iconName = cache.getCourseIcon(course.ref_id);

                      return (
                        <div
                          key={course.ref_id}
                          onClick={() => onSelectCourse(course.ref_id)}
                          className="group flex items-center justify-between p-3.5 hover:bg-slate-50/80 transition cursor-pointer gap-4"
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-red-50 group-hover:text-red-600 transition">
                              <CourseIcon iconName={iconName} className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-slate-900 group-hover:text-red-600 transition truncate">
                                  {displayName}
                                </h4>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-500 shrink-0">
                                  {course.ref_id}
                                </span>
                              </div>
                              {displayName !== course.title && (
                                <p className="text-xs text-slate-400 truncate max-w-xl">{course.title}</p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 shrink-0 text-xs text-slate-500">
                            {course.description && (
                              <span className="hidden sm:inline-block max-w-xs truncate text-slate-400 text-[11px]">
                                {course.description.replace('Contact: ', '')}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 font-semibold text-slate-700 group-hover:text-red-600 transition text-xs">
                              Öffnen
                              <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition" />
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
export default SemesterView;
