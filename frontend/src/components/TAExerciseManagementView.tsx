import { t, useLanguage } from '../lib/i18n';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Plus,
  Save,
  RotateCcw,
  Edit3,
  Trash2,
  FileText,
  Users,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Paperclip,
  Loader2,
  Search,
} from 'lucide-react';
import { api } from '../lib/api';
import { TAAssignmentListItem } from '../types';

interface TAExerciseManagementViewProps {
  exerciseRefId: string;
  exerciseTitle?: string;
  onBack: () => void;
  onEditAssignment: (assId: string | null, typeId?: number) => void;
}

export const TAExerciseManagementView: React.FC<TAExerciseManagementViewProps> = ({
  exerciseRefId,
  exerciseTitle,
  onBack,
  onEditAssignment,
}) => {
  useLanguage();
  const [assignments, setAssignments] = useState<TAAssignmentListItem[]>([]);
  const [initialOrders, setInitialOrders] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<TAAssignmentListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load assignments
  const loadAssignments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getTAAssignments(exerciseRefId);
      // Sort by order_val initially
      const sorted = [...(data.assignments || [])].sort((a, b) => a.order_val - b.order_val);
      setAssignments(sorted);
      const ordersMap: Record<string, number> = {};
      sorted.forEach((a) => {
        ordersMap[a.ass_id] = a.order_val;
      });
      setInitialOrders(ordersMap);
    } catch (err: any) {
      setError(err?.message || t("Fehler beim Laden der Übungsliste"));
    } finally {
      setIsLoading(false);
    }
  }, [exerciseRefId]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  // Check if there are unsaved order changes
  const hasUnsavedOrder = useMemo(() => {
    return assignments.some((a) => initialOrders[a.ass_id] !== a.order_val);
  }, [assignments, initialOrders]);

  // Reordering handlers
  const handleMove = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= assignments.length) return;

    const newItems = [...assignments];
    const [moved] = newItems.splice(index, 1);
    newItems.splice(targetIndex, 0, moved);

    // Re-assign order numbers in steps of 10
    const updated = newItems.map((item, idx) => ({
      ...item,
      order_val: (idx + 1) * 10,
    }));

    setAssignments(updated);
  };

  const handleOrderInputChange = (assId: string, valStr: string) => {
    const num = parseInt(valStr, 10);
    if (isNaN(num)) return;

    setAssignments((prev) =>
      prev.map((a) => (a.ass_id === assId ? { ...a, order_val: num } : a))
    );
  };

  const handleSortByOrderInput = () => {
    setAssignments((prev) => [...prev].sort((a, b) => a.order_val - b.order_val));
  };

  const handleResetOrder = () => {
    setAssignments((prev) =>
      [...prev]
        .map((a) => ({
          ...a,
          order_val: initialOrders[a.ass_id] ?? a.order_val,
        }))
        .sort((a, b) => (initialOrders[a.ass_id] ?? 0) - (initialOrders[b.ass_id] ?? 0))
    );
  };

  const handleSaveOrder = async () => {
    setIsSavingOrder(true);
    setSaveSuccessMsg(null);
    setError(null);
    try {
      const ordersMap: Record<string, number> = {};
      assignments.forEach((a) => {
        ordersMap[a.ass_id] = a.order_val;
      });
      const res = await api.updateTAAssignmentOrder(exerciseRefId, ordersMap);
      const sorted = [...(res.assignments || [])].sort((a, b) => a.order_val - b.order_val);
      setAssignments(sorted);
      const newOrdersMap: Record<string, number> = {};
      sorted.forEach((a) => {
        newOrdersMap[a.ass_id] = a.order_val;
      });
      setInitialOrders(newOrdersMap);
      setSaveSuccessMsg(t("Reihenfolge erfolgreich gespeichert."));
      setTimeout(() => setSaveSuccessMsg(null), 3500);
    } catch (err: any) {
      setError(err?.message || t("Fehler beim Speichern der Reihenfolge"));
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setError(null);
    try {
      await api.deleteTAAssignment(exerciseRefId, deleteTarget.ass_id);
      setAssignments((prev) => prev.filter((a) => a.ass_id !== deleteTarget.ass_id));
      setDeleteTarget(null);
    } catch (err: any) {
      setError(err?.message || t("Übung konnte nicht gelöscht werden"));
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtered assignments by search
  const filteredAssignments = useMemo(() => {
    if (!searchQuery.trim()) return assignments;
    const q = searchQuery.toLowerCase();
    return assignments.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.type_name.toLowerCase().includes(q) ||
        a.ass_id.includes(q)
    );
  }, [assignments, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
            title={t("Zurück zu den Übungsblättern")}
            aria-label={t("Zurück zu den Übungsblättern")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {t("Übungen verwalten & bearbeiten")}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {exerciseTitle ? `${exerciseTitle} • ` : ''}
              {t("Reihenfolge anpassen, neue Übungen erstellen oder bestehende bearbeiten")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEditAssignment(null)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition shadow-xs cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>{t("Neue Übung erstellen")}</span>
          </button>
        </div>
      </div>

      {/* Notifications & Banners */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {saveSuccessMsg && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Unsaved Order Changes Banner */}
      {hasUnsavedOrder && (
        <div className="sticky top-4 z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-amber-500/10 dark:bg-amber-950/40 border-2 border-amber-500/30 text-amber-900 dark:text-amber-200 shadow-md backdrop-blur-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="text-xs">
              <span className="font-bold">{t("Ungespeicherte Reihenfolge:")}</span> {t("Die Reihenfolge der Übungen wurde geändert.")}
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={handleResetOrder}
              disabled={isSavingOrder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium transition cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{t("Zurücksetzen")}</span>
            </button>
            <button
              type="button"
              onClick={handleSaveOrder}
              disabled={isSavingOrder}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
            >
              {isSavingOrder ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>{t("Reihenfolge speichern")}</span>
            </button>
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder={t("Übungen durchsuchen...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
          {filteredAssignments.length} {t("von")} {assignments.length} {t("Übungen")}
        </div>
      </div>

      {/* Main List Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-indigo-500" />
            <p className="text-sm font-medium">{t("Übungen werden geladen...")}</p>
          </div>
        ) : filteredAssignments.length === 0 ? (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            <FileText className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">{t("Keine Übungen gefunden.")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4 w-28 text-center">{t("Reihenfolge")}</th>
                  <th className="py-3 px-4">{t("Titel & Art")}</th>
                  <th className="py-3 px-4">{t("Startzeit")}</th>
                  <th className="py-3 px-4">{t("Abgabetermin")}</th>
                  <th className="py-3 px-4 text-center">{t("Pflicht")}</th>
                  <th className="py-3 px-4 text-center">{t("Dateien")}</th>
                  <th className="py-3 px-4 text-right">{t("Aktionen")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredAssignments.map((assignment, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === filteredAssignments.length - 1;

                  return (
                    <tr
                      key={assignment.ass_id}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Order Controls */}
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleMove(idx, 'up')}
                            disabled={isFirst || searchQuery.length > 0}
                            className={`p-1 rounded-md transition ${
                              isFirst || searchQuery.length > 0
                                ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer'
                            }`}
                            title={t("Nach oben verschieben")}
                            aria-label={t("Nach oben verschieben")}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>

                          <input
                            type="number"
                            value={assignment.order_val}
                            onChange={(e) =>
                              handleOrderInputChange(assignment.ass_id, e.target.value)
                            }
                            onBlur={handleSortByOrderInput}
                            className="w-12 text-center py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                            title={t("Reihenfolgenummer eingeben")}
                            aria-label={t("Reihenfolge für {p0}", { p0: assignment.title })}
                          />

                          <button
                            type="button"
                            onClick={() => handleMove(idx, 'down')}
                            disabled={isLast || searchQuery.length > 0}
                            className={`p-1 rounded-md transition ${
                              isLast || searchQuery.length > 0
                                ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer'
                            }`}
                            title={t("Nach unten verschieben")}
                            aria-label={t("Nach unten verschieben")}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* Title & Type */}
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onEditAssignment(assignment.ass_id, assignment.type_id)}
                          className="font-semibold text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition text-left cursor-pointer flex items-center gap-1.5"
                        >
                          <span>{assignment.title}</span>
                        </button>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {assignment.type_id === 4 ? (
                              <Users className="h-2.5 w-2.5 text-indigo-500" />
                            ) : (
                              <FileText className="h-2.5 w-2.5 text-slate-500" />
                            )}
                            <span>{assignment.type_name}</span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {t("ID:")} {assignment.ass_id}
                          </span>
                        </div>
                      </td>

                      {/* Start Time */}
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {assignment.start_time ? (
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span>{assignment.start_time}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Deadline */}
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {assignment.deadline ? (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span>{assignment.deadline}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">{t("Keine")}</span>
                        )}
                      </td>

                      {/* Mandatory */}
                      <td className="py-3 px-4 text-center">
                        {assignment.mandatory ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>{t("Ja")}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">{t("Nein")}</span>
                        )}
                      </td>

                      {/* Work Instructions & Files */}
                      <td className="py-3 px-4 text-center">
                        {assignment.instruction_files_count > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/60">
                            <Paperclip className="h-3 w-3" />
                            <span>{assignment.instruction_files_count}</span>
                          </span>
                        ) : assignment.has_work_instructions ? (
                          <span className="text-slate-500 dark:text-slate-400" title={t("Text vorhanden")}>
                            <FileText className="h-3.5 w-3.5 inline opacity-60" />
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onEditAssignment(assignment.ass_id, assignment.type_id)}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
                            title={t("Übung bearbeiten")}
                            aria-label={t("Übung {p0} bearbeiten", { p0: assignment.title })}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(assignment)}
                            className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition cursor-pointer"
                            title={t("Übung löschen")}
                            aria-label={t("Übung {p0} löschen", { p0: assignment.title })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400 mb-4">
              <div className="p-2.5 rounded-xl bg-rose-100 dark:bg-rose-950/50">
                <Trash2 className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {t("Übung unwiderruflich löschen?")}
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
              {t("Möchten Sie die Übung")}{' '}
              <strong className="text-slate-900 dark:text-slate-100 font-semibold">
                &ldquo;{deleteTarget.title}&rdquo;
              </strong>{' '}
              {t("wirklich löschen? Alle zugehörigen Einreichungen und Dateien in ILIAS werden gelöscht.")}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                {t("Abbrechen")}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                <span>{t("Übung endgültig löschen")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

