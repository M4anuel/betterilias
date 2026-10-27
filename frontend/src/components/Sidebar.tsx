import { t, useLanguage } from '../lib/i18n';
import React, { useMemo } from 'react';
import { X, Edit3, ChevronLeft, ChevronRight, LayoutGrid, Library } from 'lucide-react';
import { CourseItem } from '../types';
import { cache } from '../lib/cache';
import { CourseIcon } from './CourseIcon';

interface SidebarProps {
  isMobile?: boolean;
  courses: CourseItem[];
  selectedCourseId: string | null;
  onSelectCourse: (refId: string) => void;
  onSelectSemesterOverview: () => void;
  onSelectRepository: () => void;
  isRepositorySelected: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenNicknameModal: () => void;
  nicknamesVersion: number; // Increment to trigger re-render of nicknames, icons & order
}

export const Sidebar: React.FC<SidebarProps> = ({
  isMobile,
  courses,
  selectedCourseId,
  onSelectCourse,
  onSelectSemesterOverview,
  onSelectRepository,
  isRepositorySelected,
  isCollapsed,
  onToggleCollapse,
  onOpenNicknameModal,
  nicknamesVersion,
}) => {
  useLanguage();

  // Check if a custom user ordering exists
  const customOrder = useMemo(() => {
    return cache.getSidebarOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nicknamesVersion, courses]);

  // Group by subject when in default mode (no custom ordering)
  const groupedBySubject = useMemo(() => {
    const map = new Map<string, CourseItem[]>();
    for (const course of courses) {
      const subject = (course.subject && course.subject.trim()) || t('Sonstige');
      if (!map.has(subject)) {
        map.set(subject, []);
      }
      map.get(subject)!.push(course);
    }
    return map;
  }, [courses]);

  const renderCourseButton = (course: CourseItem) => {
    const displayName = cache.getDisplayName(course.ref_id, course.title);
    const iconName = cache.getCourseIcon(course.ref_id, course);
    const isSelected = selectedCourseId === course.ref_id;

    return (
      <button
        key={course.ref_id}
        onClick={() => onSelectCourse(course.ref_id)}
        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition cursor-pointer ${
          isSelected
            ? 'font-semibold'
            : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white'
        }`}
        style={
          isSelected
            ? { backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }
            : undefined
        }
        aria-label={course.title}
        aria-current={isSelected ? "page" : undefined}
        title={course.title}
      >
        <div
          className={`flex h-4 w-4 shrink-0 items-center justify-center transition ${
            isSelected
              ? ''
              : 'text-slate-400 group-hover:text-[var(--accent)] dark:text-slate-400 dark:group-hover:text-[var(--accent)]'
          }`}
          style={isSelected ? { color: 'var(--accent)' } : undefined}
        >
          <CourseIcon iconName={iconName} className="h-4 w-4" />
        </div>

        {!isCollapsed && (
          <div className="flex-1 truncate">
            <div
              className={`truncate text-xs font-semibold leading-tight transition ${
                isSelected ? '' : 'group-hover:text-[var(--accent)]'
              }`}
            >
              {displayName}
            </div>
            {displayName !== course.title && (
              <div
                className={`truncate text-[10px] leading-tight ${
                  isSelected ? 'opacity-75' : 'text-slate-400 dark:text-slate-500'
                }`}
                style={isSelected ? { color: 'var(--accent)' } : undefined}
              >
                {course.title.split(':')[0]}
              </div>
            )}
          </div>
        )}
      </button>
    );
  };

  return (
    <aside
      className={`relative flex h-full min-h-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 transition-all duration-200 ease-in-out shrink-0 select-none ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Top header row */}
      <div className="flex h-14 items-center justify-between border-b border-slate-100 px-3 dark:border-slate-800">
        {!isCollapsed && (
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {t("Meine Vorlesungen")}
          </span>
        )}
        <div className="flex items-center ml-auto">
          <button
            onClick={onToggleCollapse}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
            aria-label={isMobile ? t("Schliessen") : isCollapsed ? t("Seitenleiste ausklappen") : t("Seitenleiste einklappen")}
            title={isCollapsed ? t("Seitenleiste ausklappen") : t("Seitenleiste einklappen")}
          >
            {isMobile ? <X className="h-5 w-5" /> : isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main navigation items */}
      <nav aria-label={t("Meine Vorlesungen")} className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
        {/* Semester / Overview Button */}
        {(() => {
          const isSemesterSelected = selectedCourseId === null && !isRepositorySelected;
          return (
            <button
              onClick={onSelectSemesterOverview}
              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition cursor-pointer ${
                isSemesterSelected
                  ? 'font-semibold'
                  : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white'
              }`}
              style={
                isSemesterSelected
                  ? { backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }
                  : undefined
              }
              title={t("Semester-Übersicht")}
            >
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center transition ${
                  isSemesterSelected
                    ? ''
                    : 'text-slate-400 group-hover:text-[var(--accent)] dark:text-slate-400 dark:group-hover:text-[var(--accent)]'
                }`}
                style={isSemesterSelected ? { color: 'var(--accent)' } : undefined}
              >
                <LayoutGrid className="h-4 w-4" />
              </div>
              {!isCollapsed && (
                <span
                  className={`truncate text-xs leading-tight font-semibold transition ${
                    isSemesterSelected ? '' : 'group-hover:text-[var(--accent)]'
                  }`}
                >
                  {t("Semester-Übersicht")}
                </span>
              )}
            </button>
          );
        })()}

        <button
          type="button"
          onClick={onSelectRepository}
          title={t("Magazin")}
          aria-current={isRepositorySelected ? 'page' : undefined}
          style={isRepositorySelected ? { backgroundColor: 'var(--accent-light)', color: 'var(--accent)' } : undefined}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <Library className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span>{t("Magazin")}</span>}
        </button>

        <div className="pt-2 pb-1">
          <div className="h-px bg-slate-100 dark:bg-slate-800" />
        </div>

        {/* Courses List - Custom Ordering vs Default Subject Sectioning */}
        {customOrder !== null ? (
          /* Custom Ordering Mode: default subject sections disappear, custom order and custom section dividers take over */
          <div className="space-y-1">
            {(() => {
              const renderedCourseIds = new Set<string>();
              const elements: React.ReactNode[] = [];

              for (const item of customOrder) {
                if (item.type === 'section') {
                  elements.push(
                    isCollapsed ? (
                      <div
                        key={item.id}
                        className="my-2 flex items-center justify-center"
                        title={item.title || t("Hilfsassistenz (TA)")}
                      >
                        <div className="h-0.5 w-6 rounded-full bg-[var(--accent)] opacity-60" />
                      </div>
                    ) : (
                      <div key={item.id} className="pt-3 pb-1 px-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] truncate max-w-[190px]"
                            title={item.title}
                          >
                            {item.title || t("Hilfsassistenz (TA)")}
                          </span>
                          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                        </div>
                      </div>
                    )
                  );
                } else {
                  const course = courses.find((c) => c.ref_id === item.id);
                  if (course) {
                    renderedCourseIds.add(course.ref_id);
                    elements.push(renderCourseButton(course));
                  }
                }
              }

              // Append any unplaced courses safely at the bottom
              const unplacedCourses = courses.filter((c) => !renderedCourseIds.has(c.ref_id));
              for (const course of unplacedCourses) {
                elements.push(renderCourseButton(course));
              }

              return elements;
            })()}
          </div>
        ) : (
          /* Default Mode: Sectioned into subjects (matching Semester Overview) */
          <div className="space-y-2">
            {Array.from(groupedBySubject.entries()).map(([subject, subjectCourses], groupIndex) => (
              <div key={subject} className="space-y-1">
                {isCollapsed ? (
                  groupIndex > 0 && <div className="my-1.5 h-px bg-slate-100 dark:bg-slate-800" />
                ) : (
                  <div className="pt-2.5 pb-0.5 px-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate max-w-[190px]"
                        title={subject}
                      >
                        {subject}
                      </span>
                      <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
                    </div>
                  </div>
                )}
                {subjectCourses.map((course) => renderCourseButton(course))}
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* Bottom Footer in Sidebar: Vorlesungen anpassen */}
      {!isCollapsed && (
        <div className="border-t border-slate-100 p-3 text-center dark:border-slate-800">
          <button
            onClick={onOpenNicknameModal}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
          >
            <Edit3 className="h-3 w-3 text-slate-400" />
            <span>{t("Vorlesungen anpassen")}</span>
          </button>
        </div>
      )}
    </aside>
  );
};
