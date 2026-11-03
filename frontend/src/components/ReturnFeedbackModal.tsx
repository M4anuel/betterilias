import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  X,
  Upload,
  FileArchive,
  FolderUp,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileText,
  Users,
  User,
  ArrowRight,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes } from '../lib/downloadManager';
import { SearchableUnitSelect, AssignmentUnitOption } from './SearchableUnitSelect';
import { t } from '../lib/i18n';
import {
  FeedbackImportPreviewResponse,
  FeedbackImportCommitResponse,
  FeedbackUnitImportPreview,
  SubmissionItem,
} from '../types';

interface ReturnFeedbackModalProps {
  exerciseRefId: string;
  assId: string;
  assignmentTitle: string;
  submissions?: SubmissionItem[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ModalStep = 'select' | 'inspecting' | 'preview' | 'committing' | 'completed';

export const ReturnFeedbackModal: React.FC<ReturnFeedbackModalProps> = ({
  exerciseRefId,
  assId,
  assignmentTitle,
  submissions,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<ModalStep>('select');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<FeedbackImportPreviewResponse | null>(null);
  const [conflictActions, setConflictActions] = useState<Record<string, 'overwrite' | 'skip' | 'keep_both'>>({});
  const [manualMappings, setManualMappings] = useState<Record<string, string>>({});
  const [commitResult, setCommitResult] = useState<FeedbackImportCommitResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const isGroupExercise = useMemo(() => {
    return (submissions || []).some((s) => Boolean(s.team_id));
  }, [submissions]);

  const availableUnits = useMemo<AssignmentUnitOption[]>(() => {
    const unitsMap = new Map<string, AssignmentUnitOption>();

    (submissions || []).forEach((s) => {
      const isSub = s.submission_status === 'submitted' || s.submission_status === 'late' || Boolean(s.files && s.files.length > 0);
      if (s.team_id) {
        const uId = `team:${s.team_id}`;
        if (!unitsMap.has(uId)) {
          unitsMap.set(uId, {
            unitId: uId,
            isTeam: true,
            teamId: s.team_id,
            hasSubmitted: isSub,
            memberNames: s.student_name ? [s.student_name] : [],
            primaryLabel: s.team_name || `Team ${s.team_id}`,
            secondaryLabel: s.student_name || '',
          });
        } else {
          const existing = unitsMap.get(uId)!;
          if (s.student_name && !existing.memberNames.includes(s.student_name)) {
            existing.memberNames.push(s.student_name);
            existing.secondaryLabel = existing.memberNames.join(', ');
          }
          if (isSub) {
            existing.hasSubmitted = true;
          }
        }
      } else {
        const uId = `user:${s.member_id}`;
        if (!unitsMap.has(uId)) {
          unitsMap.set(uId, {
            unitId: uId,
            isTeam: false,
            hasSubmitted: isSub,
            memberNames: s.student_name ? [s.student_name] : [],
            primaryLabel: s.student_name || `User ${s.member_id}`,
            secondaryLabel: s.member_id ? `ID: ${s.member_id}` : undefined,
          });
        }
      }
    });

    const list = Array.from(unitsMap.values());

    // Priority sort:
    // If group exercise:
    // 1. Submitted groups (isTeam && hasSubmitted)
    // 2. Submitted individuals (!isTeam && hasSubmitted)
    // 3. Unsubmitted groups (isTeam && !hasSubmitted)
    // 4. Unsubmitted individuals (!isTeam && !hasSubmitted)
    // If individual exercise:
    // 1. Submitted individuals (hasSubmitted)
    // 2. Unsubmitted individuals (!hasSubmitted)
    list.sort((a, b) => {
      if (isGroupExercise) {
        const scoreA = (a.isTeam ? 2 : 0) + (a.hasSubmitted ? 4 : 0);
        const scoreB = (b.isTeam ? 2 : 0) + (b.hasSubmitted ? 4 : 0);
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
      } else {
        if (a.hasSubmitted !== b.hasSubmitted) {
          return a.hasSubmitted ? -1 : 1;
        }
      }
      const numA = a.teamId ? parseInt(a.teamId, 10) : NaN;
      const numB = b.teamId ? parseInt(b.teamId, 10) : NaN;
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.primaryLabel.localeCompare(b.primaryLabel);
    });

    return list;
  }, [submissions, isGroupExercise]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setStep('select');
      setSelectedFile(null);
      setPreviewData(null);
      setConflictActions({});
      setManualMappings({});
      setCommitResult(null);
      setErrorMessage(null);
      setShowSkipped(false);
      setShowUnmatched(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileSelected = async (file: File) => {
    setSelectedFile(file);
    setErrorMessage(null);
    setStep('inspecting');

    try {
      const preview = await api.previewFeedbackImport(exerciseRefId, assId, file);
      setPreviewData(preview);

      // Initialize default conflict actions
      const initialActions: Record<string, 'overwrite' | 'skip' | 'keep_both'> = {};
      for (const unit of preview.units) {
        for (const f of unit.files) {
          if (f.is_conflict) {
            initialActions[`${unit.unit_id}:${f.filename}`] = 'overwrite';
          }
        }
      }
      setConflictActions(initialActions);
      setStep('preview');
    } catch (err: any) {
      setErrorMessage(err.message || t("Fehler bei der Vorprüfung des Feedback-Archivs"));
      setStep('select');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleCommit = async () => {
    if (!previewData) return;
    setErrorMessage(null);
    setStep('committing');

    try {
      const res = await api.commitFeedbackImport(exerciseRefId, assId, {
        staged_import_id: previewData.staged_import_id,
        snapshot_token: previewData.snapshot_token,
        conflict_actions: conflictActions,
        manual_mappings: manualMappings,
      });
      setCommitResult(res);
      setStep('completed');
      onSuccess();
    } catch (err: any) {
      setErrorMessage(err.message || t("Fehler beim Hochladen der Feedback-Dateien"));
      setStep('preview');
    }
  };

  const hasBlockers = (previewData?.blockers && previewData.blockers.length > 0) || false;
  const manualMappedCount = Object.keys(manualMappings).filter((k) => manualMappings[k]).length;
  const totalUnits = (previewData?.units.length || 0) + (manualMappedCount > 0 ? 1 : 0);
  const totalFiles = (previewData?.total_files || 0) + manualMappedCount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-feedback-title"
    >
      <div className="relative w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4 shrink-0">
          <div className="min-w-0 pr-3">
            <h2 id="return-feedback-title" className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
              {t("Feedback-Dateien hochladen")}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {assignmentTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={step === 'committing'}
            className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0 disabled:opacity-40"
            title={t("Schliessen")}
            aria-label={t("Schliessen")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMessage && (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 p-4 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-3 animate-in fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <div className="min-w-0 flex-1">{errorMessage}</div>
            </div>
          )}

          {/* STEP 1: Select Archive / Dropzone */}
          {step === 'select' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center p-8 sm:p-10 border-2 border-dashed rounded-3xl transition cursor-pointer text-center ${
                  isDragging
                    ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/20'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/70'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileSelected(e.target.files[0]);
                    }
                  }}
                />

                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400 mb-3 shadow-2xs">
                  <FileArchive className="h-7 w-7" />
                </span>

                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">
                  {t("ZIP-Archiv auswählen oder hier ablegen")}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                  {t("Klicken zum Durchsuchen oder ZIP-Datei direkt in dieses Feld ziehen.")}
                </p>
              </div>

              {/* Supported Formats Card */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-2 text-xs">
                <p className="font-bold text-slate-800 dark:text-slate-200">
                  {t("Unterstützte Archivstrukturen:")}
                </p>
                <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 list-disc list-inside">
                  <li>
                    <span className="font-semibold text-slate-800 dark:text-slate-300">
                      {t("BetterIlias-Paket:")}
                    </span>{' '}
                    {t("ZIP mit betterilias-feedback.json und feedback/team-123/ bzw. feedback/user-456/ Ordnern.")}
                  </li>
                  <li>
                    <span className="font-semibold text-slate-800 dark:text-slate-300">
                      {t("Direkte ID-Ordner:")}
                    </span>{' '}
                    {t("ZIP mit team-<id>/ oder user-<id>/ Ordnern (z. B. team-12/korrektur.pdf).")}
                  </li>
                  <li>
                    <span className="font-semibold text-slate-800 dark:text-slate-300">
                      {t("ILIAS-Multi-Feedback:")}
                    </span>{' '}
                    {t("Natives ILIAS-Archiv mit Unterordnern pro Teilnehmer-ID.")}
                  </li>
                </ul>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">
                  {t("Hinweis: Eingereichte Originalabgaben im submissions/-Ordner werden automatisch ignoriert und nicht erneut hochgeladen.")}
                </p>
              </div>
            </div>
          )}

          {/* STEP 2: Inspecting / Preflight Loading */}
          {step === 'inspecting' && (
            <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-teal-600 dark:text-teal-400" />
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {t("Archiv wird analysiert...")}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {t("Prüfe Integrität, binde Empfänger an ILIAS und ermittle bestehende Dateien.")}
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: Preview & Mapping Confirmation */}
          {step === 'preview' && previewData && (
            <div className="space-y-4">
              {/* Blocker alert if fatal validation failure */}
              {hasBlockers && (
                <div className="rounded-2xl border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/60 p-4 space-y-1.5 text-xs text-rose-900 dark:text-rose-100">
                  <div className="flex items-center gap-2 font-bold text-rose-700 dark:text-rose-300">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span>{t("Upload blockiert")}</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1">
                    {previewData.blockers.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Overview Metrics Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3">
                  <p className="text-lg font-bold text-teal-700 dark:text-teal-400">{totalFiles}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("Dateien")}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3">
                  <p className="text-lg font-bold text-indigo-700 dark:text-indigo-400">{totalUnits}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("Empfänger")}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3">
                  <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{formatBytes(previewData.total_size_bytes)}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("Gesamtgrösse")}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3">
                  <p className={`text-lg font-bold ${previewData.has_conflicts ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {previewData.has_conflicts ? t("Vorhanden") : t("Keine")}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("Konflikte")}</p>
                </div>
              </div>

              {/* Unmatched Files Section */}
              {previewData.unmatched_files.length > 0 && (
                <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 p-3.5 text-xs space-y-2.5">
                  <div
                    onClick={() => setShowUnmatched(!showUnmatched)}
                    className="flex items-center justify-between cursor-pointer font-bold text-amber-800 dark:text-amber-300"
                  >
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{t("{p0} Dateien konnten keinem Empfänger zugeordnet werden", { p0: previewData.unmatched_files.length })}</span>
                    </span>
                    {showUnmatched ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                  {showUnmatched && (
                    <div className="space-y-2 pt-1">
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        {t("Sie können nicht zugeordnete Dateien hier manuell einem Teilnehmer oder Team zuweisen:")}
                      </p>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {previewData.unmatched_files.map((filePath, idx) => {
                          const mappedUnitId = manualMappings[filePath] || '';
                          return (
                            <div
                              key={idx}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-amber-200/60 dark:border-amber-900/40 text-[11px]"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate" title={filePath}>
                                  {filePath.split('/').pop()}
                                </span>
                              </div>
                              <div className="shrink-0">
                                <SearchableUnitSelect
                                  selectedUnitId={mappedUnitId}
                                  onSelect={(unitId) => {
                                    setManualMappings((prev) => ({
                                      ...prev,
                                      [filePath]: unitId,
                                    }));
                                  }}
                                  onClear={() => {
                                    setManualMappings((prev) => {
                                      const copy = { ...prev };
                                      delete copy[filePath];
                                      return copy;
                                    });
                                  }}
                                  units={availableUnits}
                                  isGroupExercise={isGroupExercise}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Skipped Metadata Info */}
              {previewData.skipped_files.length > 0 && (
                <div className="rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>{t("{p0} Metadateien/Systemdateien wurden ignoriert", { p0: previewData.skipped_files.length })}</span>
                  <button
                    type="button"
                    onClick={() => setShowSkipped(!showSkipped)}
                    className="text-teal-600 dark:text-teal-400 font-semibold hover:underline cursor-pointer"
                  >
                    {showSkipped ? t("Ausblenden") : t("Details")}
                  </button>
                </div>
              )}

              {showSkipped && previewData.skipped_files.length > 0 && (
                <ul className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-2 text-[10px] text-slate-400 space-y-0.5 max-h-24 overflow-y-auto">
                  {previewData.skipped_files.map((s, idx) => (
                    <li key={idx} className="truncate">{s}</li>
                  ))}
                </ul>
              )}

              {/* Mapped Units Table */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {t("Zugeordnete Feedback-Dateien:")}
                </p>

                {previewData.units.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1 bg-slate-50/50 dark:bg-slate-900/50">
                    <p className="font-semibold text-slate-700 dark:text-slate-300">
                      {t("Keine neuen Feedback-Dateien gefunden")}
                    </p>
                    <p>
                      {t("Bitte legen Sie Ihre Feedback-Dateien in die jeweiligen Ordner unter feedback/ ab.")}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden max-h-72 overflow-y-auto">
                    {previewData.units.map((unit) => {
                    const isTeam = Boolean(unit.team_id);
                    return (
                      <div key={unit.unit_id} className="p-3 space-y-2 text-xs">
                        {/* Recipient Header */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100 truncate">
                            {isTeam ? (
                              <Users className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                            ) : (
                              <User className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                            )}
                            <span className="truncate">{unit.recipient_name}</span>
                          </span>
                          {unit.assigned_ta_name && (
                            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 shrink-0">
                              {unit.assigned_ta_name}
                            </span>
                          )}
                        </div>

                        {/* Files for this unit */}
                        <div className="space-y-1.5 pl-5">
                          {unit.files.map((f, idx) => {
                            const conflictKey = `${unit.unit_id}:${f.filename}`;
                            const action = conflictActions[conflictKey] || (f.is_conflict ? 'overwrite' : 'upload');

                            return (
                              <div
                                key={idx}
                                className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2 text-[11px]"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                  <span className="font-semibold text-slate-800 dark:text-slate-200 truncate" title={f.filename}>
                                    {f.filename}
                                  </span>
                                  <span className="text-slate-400 font-mono text-[10px] shrink-0">
                                    {formatBytes(f.size_bytes)}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {f.is_conflict ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                        {t("Existiert bereits")}
                                      </span>
                                      <select
                                        value={action}
                                        onChange={(e) => {
                                          const val = e.target.value as 'overwrite' | 'skip' | 'keep_both';
                                          setConflictActions((prev) => ({
                                            ...prev,
                                            [conflictKey]: val,
                                          }));
                                        }}
                                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-semibold text-slate-700 dark:text-slate-200 px-2 py-1"
                                      >
                                        <option value="overwrite">{t("Ersetzen")}</option>
                                        <option value="skip">{t("Überspringen")}</option>
                                      </select>
                                    </div>
                                  ) : (
                                    <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                      <CheckCircle2 className="h-3 w-3" />
                                      <span>{t("Neu")}</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: Committing In Progress */}
          {step === 'committing' && (
            <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-indigo-600 dark:text-indigo-400" />
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {t("Dateien werden auf ILIAS veröffentlicht...")}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {t("Lade Feedback-Dateien über Dropzone für die jeweiligen Teilnehmer/Teams hoch.")}
                </p>
              </div>
            </div>
          )}

          {/* STEP 5: Completed Summary */}
          {step === 'completed' && commitResult && (
            <div className="space-y-4 py-4">
              <div className="flex flex-col items-center text-center space-y-2">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {t("Feedback-Dateien erfolgreich zurückgegeben!")}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                  {commitResult.message}
                </p>
              </div>

              {/* Status details */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-slate-500 dark:text-slate-400">{t("Erfolgreich hochgeladen:")}</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{commitResult.uploaded_count}</span>
                </div>
                {commitResult.skipped_count > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-700/60">
                    <span className="text-slate-500 dark:text-slate-400">{t("Übersprungen:")}</span>
                    <span className="font-bold text-slate-600 dark:text-slate-400">{commitResult.skipped_count}</span>
                  </div>
                )}
                {commitResult.failed_count > 0 && (
                  <div className="flex justify-between py-1 text-rose-600 dark:text-rose-400">
                    <span>{t("Fehlgeschlagen:")}</span>
                    <span className="font-bold">{commitResult.failed_count}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-4 shrink-0 flex items-center justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
          {step === 'select' && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              {t("Abbrechen")}
            </button>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => setStep('select')}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                {t("Zurück")}
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={hasBlockers || totalFiles === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white text-xs font-bold transition shadow-2xs cursor-pointer disabled:cursor-not-allowed"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{t("Feedback auf ILIAS veröffentlichen")}</span>
              </button>
            </>
          )}

          {step === 'completed' && (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition shadow-2xs cursor-pointer"
            >
              {t("Fertig")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

