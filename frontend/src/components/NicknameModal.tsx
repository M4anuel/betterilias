import { t, useLanguage } from '../lib/i18n';
import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Check,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  GraduationCap,
  Folder,
  Trash2,
} from 'lucide-react';
import { CourseItem, SidebarOrderItem } from '../types';
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
  useLanguage();
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [activePickerRefId, setActivePickerRefId] = useState<string | null>(null);
  const [orderItems, setOrderItems] = useState<SidebarOrderItem[]>([]);
  const [hasCustomOrder, setHasCustomOrder] = useState<boolean>(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const backdropMouseDownRef = useRef(false);

  // Sync state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setNicknames(cache.getNicknames());
      setIcons(cache.getCourseIcons());
      setActivePickerRefId(null);
      setDraggedIndex(null);

      const existingOrder = cache.getSidebarOrder();
      if (existingOrder && existingOrder.length > 0) {
        setHasCustomOrder(true);
        // Ensure all current courses exist in orderItems
        const currentCourseIds = new Set(courses.map((c) => c.ref_id));
        const orderCourseIds = new Set(
          existingOrder.filter((i) => i.type === 'course').map((i) => i.id)
        );
        const unplaced = courses
          .filter((c) => !orderCourseIds.has(c.ref_id))
          .map((c) => ({ id: c.ref_id, type: 'course' as const }));

        const validExisting = existingOrder.filter(
          (i) => i.type === 'section' || currentCourseIds.has(i.id)
        );
        setOrderItems([...validExisting, ...unplaced]);
      } else {
        setHasCustomOrder(false);
        setOrderItems(courses.map((c) => ({ id: c.ref_id, type: 'course' as const })));
      }
    }
  }, [isOpen, courses]);

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
    // Save nicknames & icons
    for (const course of courses) {
      const name = nicknames[course.ref_id] || '';
      cache.setNickname(course.ref_id, name);

      const icon = icons[course.ref_id] || '';
      cache.setCourseIcon(course.ref_id, icon);
    }

    // Save or clear custom sidebar ordering
    if (hasCustomOrder) {
      cache.setSidebarOrder(orderItems);
    } else {
      cache.clearSidebarOrder();
    }

    onNicknamesUpdated();
    onClose();
  };

  const handleReset = (refId: string) => {
    const updatedNames = { ...nicknames };
    delete updatedNames[refId];
    setNicknames(updatedNames);

    const updatedIcons = { ...icons };
    delete updatedIcons[refId];
    setIcons(updatedIcons);

    setActivePickerRefId(null);
  };

  const handleAddSection = (title = '') => {
    const newSection: SidebarOrderItem = {
      id: `section-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'section',
      title: title || t('Hilfsassistenz (TA)'),
    };
    setOrderItems((prev) => [newSection, ...prev]);
    setHasCustomOrder(true);
  };

  const handleResetToDefault = () => {
    setHasCustomOrder(false);
    setOrderItems(courses.map((c) => ({ id: c.ref_id, type: 'course' as const })));
  };

  // Drag and Drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newItems = [...orderItems];
    const [removed] = newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, removed);
    setDraggedIndex(index);
    setOrderItems(newItems);
    setHasCustomOrder(true);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const newItems = [...orderItems];
    const temp = newItems[index - 1];
    newItems[index - 1] = newItems[index];
    newItems[index] = temp;
    setOrderItems(newItems);
    setHasCustomOrder(true);
  };

  const handleMoveDown = (index: number) => {
    if (index >= orderItems.length - 1) return;
    const newItems = [...orderItems];
    const temp = newItems[index + 1];
    newItems[index + 1] = newItems[index];
    newItems[index] = temp;
    setOrderItems(newItems);
    setHasCustomOrder(true);
  };

  return (
    <div
      className="app-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
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
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t("Vorlesungen anpassen")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("Wähle ein individuelles Icon und einen kurzen Namen für deine Seitenleiste.")}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("Schliessen")}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action Toolbar for Sections & Reordering */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleAddSection(t("Abschnittsname"))}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer shadow-2xs"
            >
              <Plus className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>{t("Abschnitt hinzufügen")}</span>
            </button>

            <button
              type="button"
              onClick={() => handleAddSection(t("Hilfsassistenz (TA)"))}
              className="flex items-center gap-1.5 rounded-lg border border-teal-200 dark:border-teal-800/60 bg-teal-50/80 dark:bg-teal-950/40 px-2.5 py-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-100/70 dark:hover:bg-teal-900/40 transition cursor-pointer shadow-2xs"
              title={t("Hilfsassistenz (TA)")}
            >
              <GraduationCap className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>{t("+ TA (Teaching Assistant)")}</span>
            </button>
          </div>

          {hasCustomOrder && (
            <button
              type="button"
              onClick={handleResetToDefault}
              className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition cursor-pointer"
              title={t("Auf Fachbereiche zurücksetzen")}
            >
              <RotateCcw className="h-3 w-3" />
              <span>{t("Auf Fachbereiche zurücksetzen")}</span>
            </button>
          )}
        </div>

        {/* Course Rows & Custom Section Rows */}
        <div className="max-h-[60vh] overflow-y-auto p-6 space-y-3.5">
          {orderItems.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              {t("Keine Vorlesungen zum Bearbeiten vorhanden.")}
            </div>
          ) : (
            orderItems.map((item, index) => {
              // 1. Custom Section Divider Row
              if (item.type === 'section') {
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`flex flex-wrap items-center gap-2.5 rounded-xl border border-teal-200 dark:border-teal-800/80 bg-teal-50/70 dark:bg-teal-950/30 px-3.5 py-2.5 transition ${
                      draggedIndex === index
                        ? 'opacity-40 border-dashed border-teal-400'
                        : 'hover:border-teal-300 dark:hover:border-teal-700'
                    }`}
                  >
                    {/* Drag handle */}
                    <div
                      className="hidden sm:block cursor-grab active:cursor-grabbing text-teal-600/70 dark:text-teal-400/70 p-0.5 hover:text-teal-900 dark:hover:text-teal-100"
                      title={t("Reihenfolge & Abschnitte anpassen")}
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>

                    <Folder className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />

                    {/* Editable Section Title Input */}
                    <input
                      type="text"
                      value={item.title || ''}
                      placeholder={t("Abschnittsname")}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOrderItems((prev) =>
                          prev.map((it) => (it.id === item.id ? { ...it, title: val } : it))
                        );
                        setHasCustomOrder(true);
                      }}
                      className="min-w-0 basis-[calc(100%-3rem)] sm:basis-0 flex-1 rounded-lg border border-teal-200/90 dark:border-teal-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-teal-900 dark:text-teal-100 placeholder:text-teal-400/60 focus:outline-hidden focus:ring-2 focus:ring-teal-500/30"
                    />

                    {/* Move Up / Move Down buttons */}
                    <div className="flex flex-1 justify-end items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        className="rounded-md p-1 text-teal-600/70 dark:text-teal-400/70 hover:bg-teal-100/60 dark:hover:bg-teal-900/40 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                        title={t("Nach oben verschieben")}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveDown(index)}
                        disabled={index === orderItems.length - 1}
                        className="rounded-md p-1 text-teal-600/70 dark:text-teal-400/70 hover:bg-teal-100/60 dark:hover:bg-teal-900/40 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                        title={t("Nach unten verschieben")}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Delete Section Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setOrderItems((prev) => prev.filter((it) => it.id !== item.id));
                        setHasCustomOrder(true);
                      }}
                      className="rounded-md p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer ml-1"
                      title={t("Abschnitt entfernen")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              }

              // 2. Course Item Row
              const course = courses.find((c) => c.ref_id === item.id);
              if (!course) return null;

              const currentNickname = nicknames[course.ref_id] || '';
              const currentIcon =
                icons[course.ref_id] || cache.getDefaultCourseIcon(course.ref_id, course);
              const isPickerOpen = activePickerRefId === course.ref_id;
              const hasCustomizations = !!currentNickname || !!icons[course.ref_id];

              return (
                <div
                  key={course.ref_id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 p-4 space-y-3 transition hover:border-slate-300 dark:hover:border-slate-700 ${
                    draggedIndex === index
                      ? 'opacity-40 border-dashed border-[var(--accent)]'
                      : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Drag handle */}
                      <div
                        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 shrink-0"
                        title={t("Reihenfolge & Abschnitte anpassen")}
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>
                      <div
                        className="text-xs font-semibold text-slate-700 dark:text-slate-300 leading-snug line-clamp-1 flex-1"
                        title={course.title}
                      >
                        {course.title}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Move Up / Move Down buttons */}
                      <button
                        type="button"
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        className="rounded-md p-1 text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                        title={t("Nach oben verschieben")}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveDown(index)}
                        disabled={index === orderItems.length - 1}
                        className="rounded-md p-1 text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                        title={t("Nach unten verschieben")}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>

                      {hasCustomizations && (
                        <button
                          onClick={() => handleReset(course.ref_id)}
                          className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-red-500 transition shrink-0 cursor-pointer ml-1"
                          title={t("Auf Standard zurücksetzen")}
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>{t("Reset")}</span>
                        </button>
                      )}
                    </div>
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
                      title={t("Icon auswählen")}
                    >
                      <CourseIcon
                        iconName={currentIcon}
                        className="h-4 w-4"
                        style={{ color: 'var(--accent, #0AACA5)' }}
                      />
                      <ChevronDown className="h-3 w-3 text-slate-400" />
                    </button>

                    {/* Nickname Input - Disabled browser autofill */}
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
                      placeholder={t("Eigener Anzeigename (z.B. Vorlesung, Schnittstellen...)")}
                      value={currentNickname}
                      onChange={(e) =>
                        setNicknames({
                          ...nicknames,
                          [course.ref_id]: e.target.value,
                        })
                      }
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/30 transition"
                    />
                  </div>

                  {/* Inline Icon Picker Grid */}
                  {isPickerOpen && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xs animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                        {t("Icon auswählen")}
                      </div>
                      <div className="grid grid-cols-4 sm:grid-cols-10 gap-1.5">
                        <button
                          type="button"
                          title={t("Automatisch nach Fach und Fakultät")}
                          aria-label={t("Automatisch nach Fach und Fakultät")}
                          onClick={() => {
                            const next = { ...icons };
                            delete next[course.ref_id];
                            setIcons(next);
                            setActivePickerRefId(null);
                          }}
                          className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
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
            {t("Abbrechen")}
          </button>
          <button
            onClick={handleSave}
            style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition cursor-pointer"
          >
            <Check className="h-4 w-4" />
            <span>{t("Änderungen speichern")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default NicknameModal;
