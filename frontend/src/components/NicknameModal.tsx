import React, { useState, useEffect, useRef } from 'react';
import { X, Check, RotateCcw, ChevronDown, Smile } from 'lucide-react';
import { CourseItem } from '../types';
import { cache } from '../lib/cache';
import { CourseIcon, AVAILABLE_COURSE_ICONS } from './CourseIcon';

interface NicknameModalProps {
  courses: CourseItem[];
  isOpen: boolean;
  onClose: () => void;
  onNicknamesUpdated: () => void;
}

export const NicknameModal: React.FC<NicknameModalProps> = ({
  courses,
  isOpen,
  onClose,
  onNicknamesUpdated,
}) => {
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [activePickerRefId, setActivePickerRefId] = useState<string | null>(null);
  const backdropMouseDownRef = useRef(false);

  // Sync state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setNicknames(cache.getNicknames());
      setIcons(cache.getCourseIcons());
      setActivePickerRefId(null);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = () => {
    // Save nicknames
    for (const course of courses) {
      const name = nicknames[course.ref_id] || '';
      cache.setNickname(course.ref_id, name);

      const icon = icons[course.ref_id] || 'BookOpen';
      cache.setCourseIcon(course.ref_id, icon);
    }

    onNicknamesUpdated();
    onClose();
  };

  const handleReset = (refId: string) => {
    const updatedNames = { ...nicknames };
    delete updatedNames[refId];
    setNicknames(updatedNames);
    cache.setNickname(refId, '');

    const updatedIcons = { ...icons };
    delete updatedIcons[refId];
    setIcons(updatedIcons);
    cache.setCourseIcon(refId, 'BookOpen');

    setActivePickerRefId(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current) {
          onClose();
        }
        backdropMouseDownRef.current = false;
      }}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Vorlesungen anpassen</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Wähle ein individuelles Icon und einen kurzen Namen für deine Seitenleiste.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Course Rows */}
        <div className="max-h-[60vh] overflow-y-auto p-6 space-y-4">
          {courses.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              Keine Vorlesungen zum Bearbeiten vorhanden.
            </div>
          ) : (
            courses.map((course) => {
              const currentNickname = nicknames[course.ref_id] || '';
              const currentIcon = icons[course.ref_id] || 'BookOpen';
              const isPickerOpen = activePickerRefId === course.ref_id;
              const hasCustomizations = !!currentNickname || currentIcon !== 'BookOpen';

              return (
                <div
                  key={course.ref_id}
                  className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 p-4 space-y-3 transition hover:border-slate-300 dark:hover:border-slate-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 leading-snug line-clamp-1" title={course.title}>
                      {course.title}
                    </div>
                    {hasCustomizations && (
                      <button
                        onClick={() => handleReset(course.ref_id)}
                        className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-red-500 transition shrink-0 cursor-pointer"
                        title="Auf Standard zurücksetzen"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>

                  {/* Icon Button & Nickname Input */}
                  <div className="flex items-center gap-2.5">
                    {/* Icon selection trigger */}
                    <button
                      type="button"
                      onClick={() =>
                        setActivePickerRefId(isPickerOpen ? null : course.ref_id)
                      }
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                        isPickerOpen
                          ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent-text)] ring-2 ring-[var(--accent)]/20'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                      title="Icon auswählen"
                    >
                      <CourseIcon iconName={currentIcon} className="h-4 w-4" style={{ color: 'var(--accent, #0AACA5)' }} />
                      <ChevronDown className="h-3 w-3 text-slate-400" />
                    </button>

                    {/* Nickname Input - Disabled browser autofill (avoids Chrome Kfz-Kennzeichen heuristics) */}
                    <input
                      type="text"
                      id={`course-nickname-${course.ref_id}`}
                      name={`course_nickname_field_${course.ref_id}`}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      data-lpignore="true"
                      data-form-type="other"
                      placeholder="Eigener Anzeigename (z.B. Vorlesung, Schnittstellen...)"
                      value={currentNickname}
                      onChange={(e) =>
                        setNicknames({
                          ...nicknames,
                          [course.ref_id]: e.target.value,
                        })
                      }
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/30 transition"
                    />
                  </div>

                  {/* Inline Icon Picker Grid */}
                  {isPickerOpen && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xs animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                        Icon auswählen
                      </div>
                      <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                        {AVAILABLE_COURSE_ICONS.map((opt) => {
                          const isSelected = currentIcon === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                setIcons({
                                  ...icons,
                                  [course.ref_id]: opt.id,
                                });
                                setActivePickerRefId(null);
                              }}
                              style={isSelected ? { backgroundColor: 'var(--accent, #0AACA5)' } : {}}
                              className={`flex h-9 w-9 items-center justify-center rounded-lg transition cursor-pointer ${
                                isSelected
                                  ? 'text-white shadow-xs'
                                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                              }`}
                              title={opt.label}
                            >
                              <opt.icon className="h-4 w-4" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-6 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition cursor-pointer"
          >
            <Check className="h-4 w-4" />
            <span>Änderungen speichern</span>
          </button>
        </div>
      </div>
    </div>
  );
};
export default NicknameModal;
