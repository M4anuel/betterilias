import React, { useState, useMemo } from 'react';
import { X, Users, ArrowUp, ArrowDown, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { t } from '../lib/i18n';
import { SubmissionItem, TAInfo, ApplyAllocationRequest } from '../types';
import { api } from '../lib/api';

interface DistributeWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
  exerciseRefId: string;
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

export const DistributeWorkModal: React.FC<DistributeWorkModalProps> = ({
  isOpen,
  onClose,
  exerciseRefId,
  assId,
  submissions,
  fingerprint,
  onDistributionComplete,
}) => {
  const [assistants, setAssistants] = useState<TAInfo[]>([
    { id: 'ta1', name: 'TA 1' },
    { id: 'ta2', name: 'TA 2' },
  ]);
  const [priorityOrder, setPriorityOrder] = useState<string[]>(['ta1', 'ta2']);
  const [sortMethod, setSortMethod] = useState<'native' | 'team' | 'time' | 'random'>('native');
  const [randomSeed, setRandomSeed] = useState<number>(() => Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setPriorityOrder(newOrder);
  };

  // Add assistant using monotonically unique IDs
  const addAssistant = () => {
    let nextNum = 1;
    const existingNums = assistants
      .map((a) => {
        const m = a.id.match(/^ta(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => !isNaN(n));

    if (existingNums.length > 0) {
      nextNum = Math.max(...existingNums) + 1;
    }

    const newId = `ta${nextNum}`;
    const newTA: TAInfo = { id: newId, name: `TA ${nextNum}` };
    setAssistants((prev) => [...prev, newTA]);
    setPriorityOrder((prev) => [...prev, newId]);
  };

  const removeAssistant = (id: string) => {
    if (assistants.length <= 1) return;
    setAssistants((prev) => prev.filter((a) => a.id !== id));
    setPriorityOrder((prev) => prev.filter((pid) => pid !== id));
  };

  const updateAssistantName = (id: string, name: string) => {
    setAssistants((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)));
  };



  // Preview distribution calculation
  const distributionPlan = useMemo(() => {
    const M = canonicalUnits.length;
    const N = assistants.length;
    if (N === 0) return { quotas: {}, assignedUnits: [], memberUpdates: [] };

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

          // Propagate notice marker to all members of this unit
          unit.members.forEach((m) => {
            const cleanNotice = (m.notice || '').replace(/\[BI:[^\]]+\]/g, '').trim();
            const marker = `[BI:${ta.id}|${ta.name}]`;
            const newNotice = cleanNotice ? `${cleanNotice} ${marker}` : marker;
            memberUpdates.push({
              member_id: m.member_id,
              notice: newNotice,
            });
          });

          currentItemIdx++;
        }
      }
    }

    return { quotas, assignedUnits, memberUpdates };
  }, [canonicalUnits, assistants, priorityOrder, sortMethod, randomSeed]);

  const handleApply = async () => {
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
      if (res.success) {
        onDistributionComplete();
        onClose();
      } else {
        setError(res.message || t("Fehler beim Speichern der Verteilung"));
      }
    } catch (err: any) {
      setError(err?.message || t("Netzwerkfehler beim Anwenden der Verteilung"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden transition-all">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t("Arbeit verteilen")}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("{p0} eingereichte Abgaben gleichmäßig aufteilen", { p0: canonicalUnits.length })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Section: TA Roster & Priority */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t("Tutoren & Priorität (Restverteilung)")}
              </label>
              <button
                type="button"
                onClick={addAssistant}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
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
                    className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-2.5 text-xs"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-700 font-bold text-slate-700 dark:text-slate-200 text-[11px]">
                      {idx + 1}
                    </span>

                    <input
                      type="text"
                      value={ta.name}
                      onChange={(e) => updateAssistantName(taId, e.target.value)}
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-medium text-slate-800 dark:text-slate-200"
                    />

                    <span className="shrink-0 rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 font-bold text-indigo-700 dark:text-indigo-300">
                      {quota} {t("Abgaben")}
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => movePriority(idx, 'up')}
                        aria-label={t("Nach oben verschieben")}
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === priorityOrder.length - 1}
                        onClick={() => movePriority(idx, 'down')}
                        aria-label={t("Nach unten verschieben")}
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {assistants.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeAssistant(taId)}
                        className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
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
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
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
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition text-center cursor-pointer ${
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
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 sticky top-0">
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
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-3.5 bg-slate-50 dark:bg-slate-900 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
          >
            {t("Abbrechen")}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isSubmitting || canonicalUnits.length === 0}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer shadow-xs"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{t("Verteilung in ILIAS speichern")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
