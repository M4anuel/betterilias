import React, { useState, useEffect } from 'react';
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

  // Sync state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setNicknames(cache.getNicknames());
      setIcons(cache.getCourseIcons());
      setActivePickerRefId(null);
    }
  }, [isOpen]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Vorlesungen anpassen</h3>
            <p className="text-xs text-slate-500">
              Wähle ein individuelles Icon und einen kurzen Namen für deine Seitenleiste.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
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
                  className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-3 transition hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-700 leading-snug line-clamp-1" title={course.title}>
                      {course.title}
                    </div>
                    {hasCustomizations && (
                      <button
                        onClick={() => handleReset(course.ref_id)}
                        className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-red-600 transition shrink-0"
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
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                        isPickerOpen
                          ? 'border-red-500 bg-red-50 text-red-700 ring-2 ring-red-100'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                      }`}
                      title="Icon auswählen"
                    >
                      <CourseIcon iconName={currentIcon} className="h-4 w-4 text-red-600" />
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
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden focus:ring-2 focus:ring-red-100 transition"
                    />
                  </div>

                  {/* Inline Icon Picker Grid */}
                  {isPickerOpen && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
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
                              className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
                                isSelected
                                  ? 'bg-red-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
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
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 transition"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-red-700 transition"
          >
            <Check className="h-4 w-4" />
            <span>Speichern</span>
          </button>
        </div>
      </div>
    </div>
  );
};
export default NicknameModal;
