import { ErrorNotice } from './ErrorNotice';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, Users, ArrowUp, ArrowDown, CheckCircle, AlertTriangle, Loader2, Download } from 'lucide-react';
import { t } from '../lib/i18n';
import { SubmissionItem, TAInfo, ApplyAllocationRequest } from '../types';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { allocationDefaultsKey, loadAllocationDefaults, saveAllocationDefaults, allocationNotice, validAssistant, MAX_ASSISTANTS } from '../lib/taAllocation';

interface DistributeWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
  exerciseRefId: string;
  courseRefId?: string;
  assId: string;
  submissions: SubmissionItem[];
  fingerprint?: string;
  onDistributionComplete: () => void;
}

// Unit representing either a team or an individual student
interface CanonicalUnit {
  unitId: string;
  representativeMemberId: string;
  displayName: string;
  teamId?: string;
  submissionTime?: string;
  memberIds: string[];
  members: SubmissionItem[];
}

export const DistributeWorkModal: React.FC<DistributeWorkModalProps> = (props) => {
  if (!props.isOpen) return null;
  const scope = allocationDefaultsKey(cache.getSessionId(), props.courseRefId, props.exerciseRefId);
  return <DistributeWorkEditor key={`${scope || 'temporary'}:${props.assId}`} {...props} scope={scope} />;
};

const DistributeWorkEditor: React.FC<DistributeWorkModalProps & { scope: string | null }> = ({
  onClose,
  courseRefId,
  scope,
  exerciseRefId,
  assId,
  submissions,
  fingerprint,
  onDistributionComplete,
}) => {
  const [preferences, setPreferences] = useState(() => loadAllocationDefaults(scope, number => t('allocation.default_ta', { number })));
  const { assistants, priorityOrder } = preferences;
  const [defaultsStored, setDefaultsStored] = useState(true);
  const [sortMethod, setSortMethod] = useState<'native' | 'team' | 'time' | 'random'>('native');
  const [randomSeed, setRandomSeed] = useState<number>(() => Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    const dialog = dialogRef.current!;
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (scope) setDefaultsStored(saveAllocationDefaults(scope, preferences));
  }, [scope, preferences]);

  // Group submissions by unit_id to treat teams as single indivisible units
  const canonicalUnits = useMemo(() => {
    const unitsMap = new Map<string, CanonicalUnit>();

    submissions.forEach((s) => {
      const isEligible = s.submission_status === 'submitted' || s.submission_status === 'late' || Boolean(s.files?.length);
      if (!isEligible) return;

      const unitId = s.team_id ? `team:${s.team_id}` : `user:${s.member_id}`;
      if (!unitsMap.has(unitId)) {
        unitsMap.set(unitId, {
          unitId,
          representativeMemberId: s.member_id,
          displayName: s.team_name ? `${s.team_name} (${s.student_name})` : s.student_name,
          teamId: s.team_id,
          submissionTime: s.submission_time,
          memberIds: [s.member_id],
          members: [s],
        });
      } else {
        const u = unitsMap.get(unitId)!;
        if (!u.memberIds.includes(s.member_id)) {
          u.memberIds.push(s.member_id);
          u.members.push(s);
        }
      }
    });

    return Array.from(unitsMap.values());
  }, [submissions]);

  // Handle priority reordering
  const movePriority = (idx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= priorityOrder.length) return;
    const newOrder = [...priorityOrder];
    const temp = newOrder[idx];
    newOrder[idx] = newOrder[targetIdx];
    newOrder[targetIdx] = temp;
    setPreferences(prev => ({ ...prev, priorityOrder: newOrder }));
  };

  // Add assistant using monotonically unique IDs
  const addAssistant = () => {
    if (assistants.length >= MAX_ASSISTANTS) return;
    setPreferences(prev => {
      const newId = `ta${prev.nextId}`;
      return { ...prev, nextId: prev.nextId + 1,
        assistants: [...prev.assistants, { id: newId, name: t('allocation.default_ta', { number: prev.nextId }) }],
        priorityOrder: [...prev.priorityOrder, newId] };
    });
  };

  const removeAssistant = (id: string) => {
    if (assistants.length <= 1) return;
    setPreferences(prev => ({ ...prev, assistants: prev.assistants.filter(a => a.id !== id), priorityOrder: prev.priorityOrder.filter(pid => pid !== id) }));
  };

  const updateAssistantName = (id: string, name: string) => {
    setPreferences(prev => ({ ...prev, assistants: prev.assistants.map(a => a.id === id ? { ...a, name } : a) }));
  };



  // Preview distribution calculation
  const distributionPlan = useMemo(() => {
    const M = canonicalUnits.length;
    const N = assistants.length;
    if (N === 0) return { quotas: {}, assignedUnits: [], memberUpdates: [], conflicts: [] };

    // Sort units based on chosen method
    const sorted = [...canonicalUnits];
    if (sortMethod === 'team') {
      sorted.sort((a, b) => Number(a.teamId || 0) - Number(b.teamId || 0));
    } else if (sortMethod === 'time') {
      sorted.sort((a, b) => {
        const timeA = a.submissionTime ? Date.parse(a.submissionTime) : 0;
        const timeB = b.submissionTime ? Date.parse(b.submissionTime) : 0;
        return timeB - timeA;
      });
    } else if (sortMethod === 'random') {
      // Seeded pseudorandom shuffle
      let seed = randomSeed;
      const pseudoRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(pseudoRandom() * (i + 1));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
    }

    const baseQuota = Math.floor(M / N);
    const remainder = M % N;

    const quotas: Record<string, number> = {};
    const asstMap = new Map(assistants.map((a) => [a.id, a]));
    const orderedTAs = priorityOrder.map((id) => asstMap.get(id)!).filter(Boolean);

    orderedTAs.forEach((ta, idx) => {
      quotas[ta.id] = baseQuota + (idx < remainder ? 1 : 0);
    });

    const assignedUnits: Array<{
      unitId: string;
      displayName: string;
      assigned_ta_id: string;
      assigned_ta_name: string;
    }> = [];

    const memberUpdates: Array<{ member_id: string; notice: string }> = [];
    const conflicts: Array<{ memberId: string; name: string; length: number }> = [];

    let currentItemIdx = 0;
    for (const ta of orderedTAs) {
      const q = quotas[ta.id] || 0;
      for (let i = 0; i < q; i++) {
        if (currentItemIdx < sorted.length) {
          const unit = sorted[currentItemIdx];
          assignedUnits.push({
            unitId: unit.unitId,
            displayName: unit.displayName,
            assigned_ta_id: ta.id,
            assigned_ta_name: ta.name,
          });

          // Propagate notice marker to all members of this unit with 200-character budget guard
          unit.members.forEach((m) => {
            const result = allocationNotice(m.notice || '', ta);
            if (result.exceedsLimit) conflicts.push({ memberId: m.member_id, name: m.student_name, length: result.length });
            memberUpdates.push({
              member_id: m.member_id,
              notice: result.notice,
            });
          });

          currentItemIdx++;
        }
      }
    }

    return { quotas, assignedUnits, memberUpdates, conflicts };
  }, [canonicalUnits, assistants, priorityOrder, sortMethod, randomSeed]);
  const invalidNames = assistants.some(ta => !validAssistant(ta));
  const hasFingerprint = Boolean(fingerprint && /^[a-f0-9]{16}$/.test(fingerprint));
  const canApply = canonicalUnits.length > 0 && !invalidNames && !distributionPlan.conflicts.length && hasFingerprint;

  const exportAllocationCsv = () => {
    const headers = ['Unit ID', 'Typ', 'Name/Team', 'Zugewiesener TA', 'Abgabestatus', 'Abgabezeitpunkt'];
    const rows = distributionPlan.assignedUnits.map((item) => {
      const canonical = canonicalUnits.find((u) => u.unitId === item.unitId);
      return [
        item.unitId,
        canonical?.teamId ? 'Team' : 'Einzeln',
        `"${(item.displayName || '').replace(/"/g, '""')}"`,
        `"${(item.assigned_ta_name || '').replace(/"/g, '""')}"`,
        canonical?.members[0]?.submission_status || '',
        canonical?.submissionTime || '',
      ];
    });
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TA_Zuweisung_${assId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleApply = async () => {
    if (!canApply || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const payload: ApplyAllocationRequest = {
        exercise_ref_id: exerciseRefId,
        ass_id: assId,
        fingerprint: fingerprint || '',
        items: distributionPlan.memberUpdates,
      };

      const res = await api.applyTAAllocation(exerciseRefId, assId, payload);
      if (!mounted.current) return;
      if (res.success) {
        onDistributionComplete();
        onClose();
      } else {
        setError(res.message || t("Fehler beim Speichern der Verteilung"));
      }
    } catch (err: any) {
      if (mounted.current) setError(err?.message || t("Netzwerkfehler beim Anwenden der Verteilung"));
    } finally {
      if (mounted.current) setIsSubmitting(false);
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="allocation-title" aria-busy={isSubmitting}
      onCancel={event => { event.preventDefault(); if (!isSubmitting) onClose(); }}
      onClick={event => { if (event.target === event.currentTarget && !isSubmitting) onClose(); }}
      className="m-auto open:flex flex-col w-[calc(100%-1.5rem)] max-w-2xl p-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl backdrop:bg-slate-900/60 backdrop:backdrop-blur-xs">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 dark:border-slate-800/80 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 id="allocation-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t("Arbeit verteilen")}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("{p0} eingereichte Abgaben gleichmässig aufteilen", { p0: canonicalUnits.length })}
              </p>
            </div>
          </div>
          <button
            type="button"
            ref={closeRef}
            aria-label={t('Schliessen')}
            disabled={isSubmitting}
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <fieldset disabled={isSubmitting} className="min-w-0 space-y-5 border-0 p-0 m-0">
          <p className="text-xs text-slate-500 dark:text-slate-400">{courseRefId ? t('allocation.defaults_course') : t('allocation.defaults_exercise')}</p>
          {!defaultsStored && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t('allocation.storage_unavailable')}</p>}
          {!hasFingerprint && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t('allocation.refresh_required')}</p>}
          {invalidNames && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{t('allocation.invalid_name')}</p>}
          {distributionPlan.conflicts.length > 0 && <div role="alert" className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300">
            <p>{t('allocation.notice_conflicts', { count: distributionPlan.conflicts.length })}</p>
            <ul className="mt-2 space-y-1">{distributionPlan.conflicts.map(item => <li key={item.memberId} className="[overflow-wrap:anywhere]">{item.name}: {item.length}/200</li>)}</ul>
          </div>}
          {error && <ErrorNotice message={error} connectionInline />}

          {/* Section: TA Roster & Priority */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t("Tutoren & Priorität (Restverteilung)")}
              </label>
              <button
                type="button"
                onClick={addAssistant}
                disabled={assistants.length >= MAX_ASSISTANTS}
                className="min-h-11 px-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer disabled:opacity-40"
              >
                + {t("Tutor hinzufügen")}
              </button>
            </div>

            <div className="space-y-2">
              {priorityOrder.map((taId, idx) => {
                const ta = assistants.find((a) => a.id === taId);
                if (!ta) return null;
                const quota = distributionPlan.quotas[taId] ?? 0;

                return (
                  <div
                    key={taId}
                    className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-2.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-700 font-bold text-slate-700 dark:text-slate-200 text-[11px]">
                      {idx + 1}
                    </span>

                    <input
                      type="text"
                      aria-label={t('allocation.assistant_name', { number: idx + 1 })}
                      maxLength={100}
                      value={ta.name}
                      onChange={(e) => updateAssistantName(taId, e.target.value)}
                      className="min-w-0 min-h-11 flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-base sm:text-xs font-medium text-slate-800 dark:text-slate-200"
                    />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 font-bold text-indigo-700 dark:text-indigo-300">
                      {quota} {t("Abgaben")}
                    </span>

                    <div className="flex items-center">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => movePriority(idx, 'up')}
                        aria-label={t("Nach oben verschieben")}
                        className="flex h-11 w-11 items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === priorityOrder.length - 1}
                        onClick={() => movePriority(idx, 'down')}
                        aria-label={t("Nach unten verschieben")}
                        className="flex h-11 w-11 items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    {assistants.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeAssistant(taId)}
                        aria-label={t('allocation.remove_assistant', { name: ta.name })}
                        className="flex h-11 w-11 items-center justify-center text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section: Sorting Method */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t("Sortierung vor Aufteilung")}
              </label>
              {sortMethod === 'random' && (
                <button
                  type="button"
                  onClick={() => setRandomSeed(Date.now())}
                  className="min-h-11 px-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  {t("Neu mischen")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { id: 'native', label: t("ILIAS-Reihenfolge") },
                  { id: 'team', label: t("Teamnummer") },
                  { id: 'time', label: t("Abgabezeit") },
                  { id: 'random', label: t("Zufällig") },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSortMethod(m.id)}
                  className={`min-h-11 px-3 py-2 rounded-xl text-xs font-semibold border transition text-center cursor-pointer ${
                    sortMethod === m.id
                      ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 dark:bg-indigo-950/60 dark:border-indigo-500 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Section: Preview Table */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2">
              {t("Vorschau der Zuweisung")}
            </label>
            <div role="region" aria-label={t("Vorschau der Zuweisung")} tabIndex={0} className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full table-fixed text-left text-xs [overflow-wrap:anywhere]">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
                  <tr>
                    <th className="py-2 px-3">{t("Student / Team")}</th>
                    <th className="py-2 px-3">{t("Zugewiesener Tutor")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {distributionPlan.assignedUnits.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                        {item.displayName}
                      </td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 font-semibold text-indigo-700 dark:text-indigo-300">
                          {item.assigned_ta_name}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </fieldset>
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 px-4 sm:px-5 py-3.5 bg-slate-50 dark:bg-slate-900 grid grid-cols-2 sm:flex sm:items-center sm:justify-between gap-2">
          <button
            type="button"
            onClick={exportAllocationCsv}
            disabled={isSubmitting || distributionPlan.assignedUnits.length === 0}
            className="flex min-h-11 items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5 text-slate-500" />
            <span>{t("CSV exportieren")}</span>
          </button>
          <div className="contents sm:flex sm:items-center sm:gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-11 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          >
            {t("Abbrechen")}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isSubmitting || !canApply}
            className="col-span-2 flex min-h-11 items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer shadow-xs"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{t("Verteilung in ILIAS speichern")}</span>
          </button>
          </div>
        </div>
    </dialog>
  );
};
