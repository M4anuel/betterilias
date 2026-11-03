import { t, useLanguage } from '../lib/i18n';
import React, { useMemo } from 'react';
import { X, Edit3, ChevronLeft, ChevronRight, LayoutGrid, Library, Users, Calendar } from 'lucide-react';
import { CourseItem } from '../types';
import { cache } from '../lib/cache';
import { CourseIcon } from './CourseIcon';

interface SidebarProps {
  isMobile?: boolean;
  semester: string;
  courses: CourseItem[];
  selectedCourseId: string | null;
  onSelectCourse: (refId: string) => void;
  onSelectSemesterOverview: () => void;
  onSelectRepository: () => void;
  isRepositorySelected: boolean;
  onSelectMyCourses: () => void;
  isMyCoursesSelected: boolean;
  onSelectCalendar?: () => void;
  isCalendarSelected?: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenNicknameModal: () => void;
  nicknamesVersion: number; // Increment to trigger re-render of nicknames, icons & order
}

export const Sidebar: React.FC<SidebarProps> = ({
  isMobile,
  semester,
  courses,
  selectedCourseId,
  onSelectCourse,
  onSelectSemesterOverview,
  onSelectRepository,
  isRepositorySelected,
  onSelectMyCourses,
  isMyCoursesSelected,
  onSelectCalendar,
  isCalendarSelected = false,
  isCollapsed,
  onToggleCollapse,
  onOpenNicknameModal,
  nicknamesVersion,
}) => {
  const language = useLanguage();

  // Check if a custom user ordering exists
  const customOrder = useMemo(() => {
    return cache.getSidebarOrder(semester);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nicknamesVersion, courses, semester]);

  // Group by subject when in default mode (no custom ordering)
  const groupedBySubject = useMemo(() => {
    const map = new Map<string, CourseItem[]>();
    const positions = new Map((customOrder || []).filter(item => item.type === 'course').map((item, index) => [item.id, index]));
    const ordered = [...courses].sort((a, b) => (positions.get(a.ref_id) ?? Infinity) - (positions.get(b.ref_id) ?? Infinity));
    for (const course of ordered) {
      const subject = (course.subject && course.subject.trim()) || t('Sonstige');
      if (!map.has(subject)) {
        map.set(subject, []);
      }
      map.get(subject)!.push(course);
    }
    return map;
  }, [courses, language, customOrder]);

  // Every row keeps its geometry and inherits one foreground colour. Wrapping
  // icons also avoids the global SVG-only button centering rule during collapse.
  const rowClass = (selected: boolean) => `group flex h-11 min-h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-4 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] cursor-pointer ${
    selected ? '' : 'text-slate-700 hover:bg-slate-100/80 hover:text-[var(--accent)] dark:text-slate-200 dark:hover:bg-slate-800/80'
  }`;
  const selectedStyle = { backgroundColor: 'var(--accent-light)', color: 'var(--accent)' };
  const icon = (content: React.ReactNode) => <span className="sidebar-icon flex h-4 w-4 shrink-0 items-center justify-center">{content}</span>;
  const renderNavigation = (title: string, Icon: typeof LayoutGrid, selected: boolean, onClick: () => void) => (
    <button key={title} type="button" onClick={onClick} title={title} aria-label={title}
      aria-current={selected ? 'page' : undefined} className={rowClass(selected)} style={selected ? selectedStyle : undefined}>
      {icon(<Icon className="h-4 w-4" />)}
      {!isCollapsed && <span className="min-w-0 truncate whitespace-nowrap leading-tight">{title}</span>}
    </button>
  );
  const renderCourseButton = (course: CourseItem) => {
    const displayName = cache.getDisplayName(course.ref_id, course.title);
    const isSelected = selectedCourseId === course.ref_id;
    return <button key={course.ref_id} type="button" onClick={() => onSelectCourse(course.ref_id)}
      className={rowClass(isSelected)} style={isSelected ? selectedStyle : undefined}
      aria-label={displayName} aria-current={isSelected ? 'page' : undefined} title={course.title}>
      {icon(<CourseIcon iconName={cache.getCourseIcon(course.ref_id, course)} className="h-4 w-4" />)}
      {!isCollapsed && <span className="min-w-0 flex-1 overflow-hidden text-left">
        <span className="block truncate whitespace-nowrap text-xs font-semibold leading-tight">{displayName}</span>
        {displayName !== course.title && <span className={`block truncate whitespace-nowrap text-[10px] leading-tight ${isSelected ? 'opacity-75' : 'text-slate-400 dark:text-slate-400'}`}>
          {course.title.split(':')[0]}
        </span>}
      </span>}
    </button>;
  };
  const renderDivider = (key: string, title: string, custom: boolean) => (
    <div key={key} title={title} className={`flex shrink-0 items-center overflow-hidden px-4 ${custom ? 'h-8' : 'h-7'}`}>
      {isCollapsed ? <span className={`h-px w-6 shrink-0 rounded-full ${custom ? 'bg-[var(--accent)] opacity-60' : 'bg-slate-200 dark:bg-slate-700'}`} />
        : <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`min-w-0 truncate whitespace-nowrap text-[10px] font-bold uppercase tracking-wider ${custom ? 'text-[var(--accent)]' : 'text-slate-400 dark:text-slate-400'}`}>{title}</span>
          <span className="h-px min-w-2 flex-1 bg-slate-200 dark:bg-slate-800" />
        </span>}
    </div>
  );
  const isSemesterSelected = selectedCourseId === null && !isRepositorySelected && !isMyCoursesSelected && !isCalendarSelected;
  const customSections = customOrder?.some(item => item.type === 'section');
  const placed = new Set<string>();

  return <aside data-sidebar-collapsed={isCollapsed} className={`relative flex h-full min-h-0 shrink-0 select-none flex-col overflow-hidden border-r border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 transition-[width] duration-200 ease-in-out motion-reduce:transition-none ${isCollapsed ? 'w-16' : 'w-64'}`}>
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-slate-100 px-3 dark:border-slate-800">
      {!isCollapsed && <span className="min-w-0 truncate whitespace-nowrap text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">{t('Meine Vorlesungen')}</span>}
      <button type="button" onClick={onToggleCollapse}
        className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        aria-label={isMobile ? t('Schliessen') : isCollapsed ? t('Seitenleiste ausklappen') : t('Seitenleiste einklappen')}
        title={isMobile ? t('Schliessen') : isCollapsed ? t('Seitenleiste ausklappen') : t('Seitenleiste einklappen')}>
        {isMobile ? <X className="h-5 w-5" /> : isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </div>
    <nav aria-label={t('Meine Vorlesungen')} className="min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto p-2">
      {renderNavigation(t('Semester-Übersicht'), LayoutGrid, isSemesterSelected, onSelectSemesterOverview)}
      {onSelectCalendar && renderNavigation(t('calendar.sidebar_nav'), Calendar, isCalendarSelected, onSelectCalendar)}
      {renderNavigation(t('my_courses.title'), Users, isMyCoursesSelected, onSelectMyCourses)}
      {renderNavigation(t('Magazin'), Library, isRepositorySelected, onSelectRepository)}
      <div className="pt-2 pb-1"><div className="h-px bg-slate-100 dark:bg-slate-800" /></div>
      {customSections ? <div className="space-y-1">
        {customOrder?.map(item => {
          if (item.type === 'section') return renderDivider(item.id, item.title || t('Abschnittsname'), true);
          const course = courses.find(candidate => candidate.ref_id === item.id);
          if (!course || placed.has(course.ref_id)) return null;
          placed.add(course.ref_id);
          return renderCourseButton(course);
        })}
        {courses.filter(course => !placed.has(course.ref_id)).map(renderCourseButton)}
      </div> : <div className="space-y-2">
        {Array.from(groupedBySubject.entries()).map(([subject, subjectCourses]) => <div key={subject} className="space-y-1">
          {renderDivider(subject, subject, false)}
          {subjectCourses.map(renderCourseButton)}
        </div>)}
      </div>}
    </nav>
    <div className="flex h-16 shrink-0 items-center justify-center border-t border-slate-100 px-2 dark:border-slate-800">
      <button type="button" onClick={onOpenNicknameModal} aria-label={t('Vorlesungen anpassen')} title={t('Vorlesungen anpassen')}
        className="flex h-11 w-full min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
        {icon(<Edit3 className="h-4 w-4" />)}
        {!isCollapsed && <span className="min-w-0 truncate whitespace-nowrap">{t('Vorlesungen anpassen')}</span>}
      </button>
    </div>
  </aside>;
};
