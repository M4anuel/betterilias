import React from 'react';
import { Edit3, ChevronLeft, ChevronRight, LayoutGrid, Library } from 'lucide-react';
import { CourseItem } from '../types';
import { cache } from '../lib/cache';
import { CourseIcon } from './CourseIcon';

interface SidebarProps {
  courses: CourseItem[];
  selectedCourseId: string | null;
  onSelectCourse: (refId: string) => void;
  onSelectSemesterOverview: () => void;
  onSelectRepository: () => void;
  isRepositorySelected: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenNicknameModal: () => void;
  nicknamesVersion: number; // Increment to trigger re-render of nicknames & icons
}

export const Sidebar: React.FC<SidebarProps> = ({
  courses,
  selectedCourseId,
  onSelectCourse,
  onSelectSemesterOverview,
  onSelectRepository,
  isRepositorySelected,
  isCollapsed,
  onToggleCollapse,
  onOpenNicknameModal,
}) => {
  return (
    <aside
      className={`relative flex flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 transition-all duration-200 ease-in-out shrink-0 select-none ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Top header row */}
      <div className="flex h-14 items-center justify-between border-b border-slate-100 px-3 dark:border-slate-800">
        {!isCollapsed && (
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Meine Vorlesungen
          </span>
        )}
        <div className="flex items-center ml-auto">
          <button
            onClick={onToggleCollapse}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
            title={isCollapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main navigation items */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
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
              title="Semester-Übersicht"
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
                  Semester-Übersicht
                </span>
              )}
            </button>
          );
        })()}

        <button type="button" onClick={onSelectRepository} title="Magazin"
          aria-current={isRepositorySelected ? 'page' : undefined}
          style={isRepositorySelected ? { backgroundColor: 'var(--accent-light)', color: 'var(--accent)' } : undefined}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
          <Library className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span>Magazin</span>}
        </button>

        <div className="pt-2 pb-1">
          <div className="h-px bg-slate-100 dark:bg-slate-800" />
        </div>

        {/* Courses list */}
        {courses.map((course) => {
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
        })}
      </nav>

      {/* Bottom Footer in Sidebar: Edit button only at bottom */}
      {!isCollapsed && (
        <div className="border-t border-slate-100 p-3 text-center dark:border-slate-800">
          <button
            onClick={onOpenNicknameModal}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
          >
            <Edit3 className="h-3 w-3 text-slate-400" />
            <span>Vorlesungen anpassen</span>
          </button>
        </div>
      )}
    </aside>
  );
};
