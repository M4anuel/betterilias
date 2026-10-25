import React, { useState, useMemo } from 'react';
import {
  User,
  ArrowRight,
  Clock,
  GraduationCap,
  Calendar,
  RefreshCw,
  LayoutGrid,
  List,
  SlidersHorizontal,
} from 'lucide-react';
import { SemesterScreenResponse, CourseItem } from '../types';
import { cache } from '../lib/cache';
import { CourseIcon } from './CourseIcon';
import {
  getCurrentSemester,
  getDefaultStartSemester,
  generateSemesterList,
  getSemesterOption,
  SemesterOption,
} from '../lib/semesterUtils';
import { SemesterRangeModal } from './SemesterRangeModal';

export type { SemesterOption } from '../lib/semesterUtils';

// Fallback constant for backwards compatibility
export const ALL_SEMESTERS: SemesterOption[] = generateSemesterList().all;

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

  // User-customized start semester (defaults to HS 5 years ago)
  const defaultStartSem = useMemo(() => getDefaultStartSemester(), []);
  const [customStartSemester, setCustomStartSemester] = useState<string | null>(() =>
    cache.getSemesterStart()
  );
  const [isRangeModalOpen, setIsRangeModalOpen] = useState(false);

  const handleViewModeChange = (mode: 'cards' | 'list') => {
    setViewMode(mode);
    cache.setSemesterViewMode(mode);
  };

  const currentSemId = useMemo(() => getCurrentSemester(), []);
  const activeStartSem = customStartSemester || defaultStartSem;

  // Generate semesters down to activeStartSem
  const { all: allSemesters, currentAndPreview, past } = useMemo(
    () => generateSemesterList(activeStartSem, currentSemId),
    [activeStartSem, currentSemId]
  );

  // Quick pills: recent non-preview semesters + selectedSemester
  const pillIds = useMemo(() => {
    const recentNonPreview = allSemesters
      .filter((s) => !s.isPreview)
      .slice(0, 4)
      .map((s) => s.id);

    if (recentNonPreview.includes(selectedSemester)) {
      return recentNonPreview;
    }
    return [selectedSemester, ...recentNonPreview.slice(0, 3)];
  }, [allSemesters, selectedSemester]);

  // Selected semester metadata
  const currentSemesterMeta = useMemo(() => {
    return allSemesters.find((s) => s.id === selectedSemester) || getSemesterOption(selectedSemester);
  }, [allSemesters, selectedSemester]);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200">
      {/* Hero Welcome & Last Opened Course banner */}
      {lastOpenedCourse && (
        <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-slate-50 p-6 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 dark:border-slate-800 dark:from-slate-900 dark:via-slate-900/80 dark:to-slate-800 transition-colors">
          <div className="flex items-center gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
              style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
            >
              <Clock className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'var(--accent, #0AACA5)' }}
                >
                  Zuletzt geöffnet
                </span>
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    backgroundColor: 'var(--accent-light, rgba(10, 172, 165, 0.12))',
                    color: 'var(--accent-text, #088b85)',
                  }}
                >
                  {lastOpenedCourse.semester || selectedSemester}
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {cache.getDisplayName(lastOpenedCourse.ref_id, lastOpenedCourse.title)}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{lastOpenedCourse.title}</p>
            </div>
          </div>

          <button
            onClick={() => onSelectCourse(lastOpenedCourse.ref_id)}
            style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:opacity-90 transition shrink-0 cursor-pointer"
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
            <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
              <GraduationCap className="h-6 w-6" style={{ color: 'var(--accent, #0AACA5)' }} />
              <span>Vorlesungsübersicht</span>
              {isLoading && (
                <RefreshCw className="h-4 w-4 animate-spin text-slate-400 ml-2" />
              )}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Aktuell ausgewählt: <strong className="text-slate-800 dark:text-slate-200">{currentSemesterMeta.full}</strong>
            </p>
          </div>

          {/* Controls: Quick Pills + Clean Semester Dropdown + Dialog Trigger + View Mode */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Pills */}
            <div className="flex items-center gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
              {pillIds.map((semId) => {
                const isActive = semId === selectedSemester;
                const semMeta = allSemesters.find((s) => s.id === semId);
                const label = semMeta ? semMeta.short : semId;

                return (
                  <button
                    key={semId}
                    type="button"
                    onClick={() => onSelectSemester(semId)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                      isActive
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700/50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Clean Dropdown: Only semesters (No overfilled settings options) */}
            <div className="relative flex items-center gap-1.5">
              <div className="relative">
                <select
                  value={selectedSemester}
                  onChange={(e) => onSelectSemester(e.target.value)}
                  className="appearance-none rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-8 text-xs font-semibold text-slate-700 shadow-xs hover:border-slate-300 focus:outline-hidden transition cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  title="Semester auswählen"
                >
                  {/* Current & Preview */}
                  <optgroup label="Aktuelle & Künftige Semester">
                    {currentAndPreview.map((sem) => (
                      <option key={sem.id} value={sem.id}>
                        {sem.short} – {sem.full}
                      </option>
                    ))}
                  </optgroup>

                  {/* All Past Semesters (Unified, no useless archive split) */}
                  <optgroup label="Vergangene Semester">
                    {past.map((sem) => (
                      <option key={sem.id} value={sem.id}>
                        {sem.short} – {sem.full}
                      </option>
                    ))}
                  </optgroup>

                  {/* Fallback if selected is outside generated list */}
                  {!allSemesters.some((s) => s.id === selectedSemester) && (
                    <optgroup label="Ausgewähltes Semester">
                      <option value={selectedSemester}>{selectedSemester}</option>
                    </optgroup>
                  )}
                </select>
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              </div>

              {/* Dedicated button to open the custom start year/semester dialog */}
              <button
                type="button"
                onClick={() => setIsRangeModalOpen(true)}
                className="rounded-xl border border-slate-200 bg-white p-1.5 text-slate-500 shadow-xs hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition cursor-pointer"
                title="Studienbeginn / Startsemester anpassen"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>

            {/* View Mode Toggle: Cards vs. List */}
            <div className="flex items-center gap-0.5 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800" title="Ansicht umschalten">
              <button
                type="button"
                onClick={() => handleViewModeChange('cards')}
                className={`rounded-lg p-1.5 transition cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700/50'
                }`}
                title="Kartenansicht"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange('list')}
                className={`rounded-lg p-1.5 transition cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700/50'
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
          <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
              <div
                className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: 'var(--accent, #0AACA5)', borderTopColor: 'transparent' }}
              />
              <span className="text-xs font-medium">Lade Semester-Angebote für {currentSemesterMeta.short}...</span>
            </div>
          </div>
        )}

        {/* Empty state if semester has no courses */}
        {!isLoading && semesterData && Object.keys(semesterData.grouped_by_category).length === 0 && (
          <div className="flex h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
            <GraduationCap className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">Keine Vorlesungen gefunden</h4>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm">
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
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">{category}</h3>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                  <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">{courses.length} Vorlesungen</span>
                </div>

                {viewMode === 'cards' ? (
                  /* Cards Grid View */
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {courses.map((course) => {
                      const displayName = cache.getDisplayName(course.ref_id, course.title);
                      const iconName = cache.getCourseIcon(course.ref_id, course);

                      return (
                        <div
                          key={course.ref_id}
                          onClick={() => onSelectCourse(course.ref_id)}
                          className="group relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-400 hover:shadow-md cursor-pointer dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-slate-200 group-hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-700 dark:group-hover:text-slate-100 transition">
                                <CourseIcon iconName={iconName} className="h-5 w-5" />
                              </div>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                {course.ref_id}
                              </span>
                            </div>

                            <h4 className="mt-3.5 text-base font-bold text-slate-900 group-hover:text-[var(--accent)] dark:text-slate-100 dark:group-hover:text-[var(--accent)] transition leading-snug">
                              {displayName}
                            </h4>

                            {displayName !== course.title && (
                              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 line-clamp-1" title={course.title}>
                                {course.title}
                              </p>
                            )}
                          </div>

                          {/* Contact or Lecturer */}
                          <div className="mt-5 border-t border-slate-100 dark:border-slate-800 pt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            {course.description ? (
                              <div className="flex items-center gap-1.5 truncate pr-2">
                                <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span className="truncate">{course.description.replace('Contact: ', '')}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600">Keine Dozenten-Info</span>
                            )}
                            <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition shrink-0 dark:text-slate-600" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Compact List View */
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden dark:border-slate-800 dark:bg-slate-900 dark:divide-slate-800">
                    {courses.map((course) => {
                      const displayName = cache.getDisplayName(course.ref_id, course.title);
                      const iconName = cache.getCourseIcon(course.ref_id, course);

                      return (
                        <div
                          key={course.ref_id}
                          onClick={() => onSelectCourse(course.ref_id)}
                          className="group flex items-center justify-between p-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition cursor-pointer gap-4"
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-slate-200 group-hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-700 dark:group-hover:text-slate-100 transition">
                              <CourseIcon iconName={iconName} className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-slate-900 group-hover:text-[var(--accent)] dark:text-slate-100 transition truncate">
                                  {displayName}
                                </h4>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400 shrink-0">
                                  {course.ref_id}
                                </span>
                              </div>
                              {displayName !== course.title && (
                                <p className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-xl">{course.title}</p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 shrink-0 text-xs text-slate-500 dark:text-slate-400">
                            {course.description && (
                              <span className="hidden sm:inline-block max-w-xs truncate text-slate-400 dark:text-slate-500 text-[11px]">
                                {course.description.replace('Contact: ', '')}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 font-semibold text-slate-700 group-hover:text-[var(--accent)] dark:text-slate-300 transition text-xs">
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

      {/* Compact dialog to set custom start semester */}
      <SemesterRangeModal
        isOpen={isRangeModalOpen}
        onClose={() => setIsRangeModalOpen(false)}
        currentSemester={currentSemId}
        customStartSemester={customStartSemester}
        onSaveStartSemester={(newStart) => {
          cache.setSemesterStart(newStart);
          setCustomStartSemester(newStart);
        }}
      />
    </div>
  );
};

export default SemesterView;
