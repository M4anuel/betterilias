import { t, useLanguage } from '../lib/i18n';
import { navigationGuard, useNavigationGuard } from '../lib/navigationGuard';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  Loader2,
  AlertCircle,
  Info,
  CheckCircle2,
  FileText,
  Users,
  Calendar,
  Clock,
  Paperclip,
  Upload,
  Trash2,
  Download,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { cache, TA_ASSIGNMENT_DETAIL_CACHE_PREFIX } from '../lib/cache';
import { InstructionEditor } from './InstructionEditor';
import { TAAssignmentDetailResponse, TAInstructionFileItem, SaveTAAssignmentRequest } from '../types';

type AssignmentField = 'title' | 'startTime' | 'deadline' | 'deadline2' | 'maxFile';
const fieldIds: Record<AssignmentField, string> = {
  title: 'assignment-title', startTime: 'assignment-start', deadline: 'assignment-deadline',
  deadline2: 'assignment-grace-end', maxFile: 'assignment-file-limit',
};
const invalidFieldStyle = 'aria-invalid:border-rose-500 dark:aria-invalid:border-rose-400 aria-invalid:ring-2 aria-invalid:ring-rose-500/30';

interface TAExerciseEditorViewProps {
  exerciseRefId: string;
  assId: string | null;
  initialTypeId?: number;
  onBack: () => void;
  onSaved: (savedAssId: string, result: { created: boolean; title: string }) => void;
}

export const TAExerciseEditorView: React.FC<TAExerciseEditorViewProps> = ({
  exerciseRefId,
  assId,
  initialTypeId = 1,
  onBack,
  onSaved,
}) => {
  const language = useLanguage();
  const [savedResult, setSavedResult] = useState<{ id: string; created: boolean; title: string } | null>(null);
  const [currentAssId, setCurrentAssId] = useState<string | null>(assId);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [typeId, setTypeId] = useState<number>(initialTypeId);
  const [availableTypes, setAvailableTypes] = useState<Record<string, string>>({ '1': 'Upload', '4': 'Team Upload' });
  const [mandatory, setMandatory] = useState(true);
  const [instructionHtml, setInstructionHtml] = useState('');
  const [startTime, setStartTime] = useState('');
  // In ILIAS: 0 = Fixed Date, -1 = No Deadline
  const [deadlineMode, setDeadlineMode] = useState<number>(0);
  const [deadline, setDeadline] = useState('');
  const [hasGracePeriod, setHasGracePeriod] = useState(false);
  const [deadline2, setDeadline2] = useState('');
  const [maxFileEnabled, setMaxFileEnabled] = useState(false);
  const [maxFile, setMaxFile] = useState<number | null>(null);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AssignmentField, string>>>({});
  const fieldRefs = useRef<Partial<Record<AssignmentField, HTMLInputElement | null>>>({});

  const validateFields = useCallback(() => {
    const errors: Partial<Record<AssignmentField, string>> = {};
    if (!title.trim()) errors.title = t('Bitte geben Sie einen Titel für die Übung an.');
    else if (title.trim().length > 200) errors.title = t('editor.title_too_long');
    if (deadlineMode === 0) {
      if (!deadline.trim()) errors.deadline = t('Bitte wählen Sie ein Abgabedatum aus oder stellen Sie den Modus auf "Kein Abgabetermin".');
      if (startTime && deadline && startTime > deadline) errors.startTime = t('Die Startzeit darf nicht nach dem Abgabetermin liegen.');
      if (hasGracePeriod) {
        if (!deadline2.trim()) errors.deadline2 = t('editor.grace_required');
        else if (deadline && deadline2 < deadline) errors.deadline2 = t('Die Nachfrist darf nicht vor dem regulären Abgabetermin liegen.');
      }
    }
    if (maxFileEnabled && (maxFile === null || !Number.isInteger(maxFile) || maxFile < 1 || maxFile > 100)) {
      errors.maxFile = t('editor.file_limit_range');
    }
    return errors;
  }, [title, deadlineMode, deadline, startTime, hasGracePeriod, deadline2, maxFileEnabled, maxFile, language]);

  useEffect(() => {
    if (validationAttempted) setFieldErrors(validateFields());
  }, [validationAttempted, validateFields]);

  const fieldAttributes = (field: AssignmentField) => ({
    id: fieldIds[field],
    ref: (node: HTMLInputElement | null) => { fieldRefs.current[field] = node; },
    'aria-invalid': Boolean(fieldErrors[field]),
    'aria-describedby': fieldErrors[field] ? `${fieldIds[field]}-error` : undefined,
  });
  const fieldError = (field: AssignmentField) => fieldErrors[field] && (
    <p id={`${fieldIds[field]}-error`} role="alert" className="text-xs font-medium text-rose-700 dark:text-rose-300">{fieldErrors[field]}</p>
  );

  // Instruction files state
  const [instructionFiles, setInstructionFiles] = useState<TAInstructionFileItem[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isDeletingFileId, setIsDeletingFileId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(() => {
    if (!assId) {
      return JSON.stringify({
        title: '',
        typeId: initialTypeId,
        mandatory: true,
        instructionHtml: '',
        startTime: '',
        deadlineMode: 0,
        deadline: '',
        hasGracePeriod: false,
        deadline2: '',
        maxFileEnabled: false,
        maxFile: null,
      });
    }
    return null;
  });


  // Track if initial load happened so typeId changes don't wipe user inputs
  const loadedAssIdRef = useRef<string | null | undefined>(undefined);

  // Read the native type catalogue without creating anything or resetting the draft.
  useEffect(() => {
    if (assId) return;
    let active = true;
    api.getTAAssignments(exerciseRefId).then((data) => {
      if (active && data.available_types && Object.keys(data.available_types).length) {
        setAvailableTypes(data.available_types);
        setTypeId((selected) => Object.hasOwn(data.available_types!, String(selected)) ? selected : Number(Object.keys(data.available_types!)[0]));
      }
    }).catch((err) => { if (active) setError(err?.message || t('Fehler beim Laden der Übungsliste')); });
    return () => { active = false; };
  }, [exerciseRefId, assId]);

  // Load existing assignment details
  const loadDetail = useCallback(async () => {
    if (loadedAssIdRef.current === assId) return;
    loadedAssIdRef.current = assId;

    if (!assId) {
      setIsLoading(false);
      return;
    }

    const cached = cache.getCachedTAAssignmentDetail(exerciseRefId, assId);
    if (cached) {
      setTitle(cached.title || '');
      setTypeId(cached.type_id || initialTypeId);
      if (cached.available_types && Object.keys(cached.available_types).length) {
        setAvailableTypes({ ...cached.available_types, [cached.type_id]: cached.type_name });
      }
      setMandatory(cached.mandatory);
      setInstructionHtml(cached.instruction_html || '');
      setStartTime(cached.start_time || '');
      setDeadlineMode(cached.deadline_mode === -1 ? -1 : 0);
      setDeadline(cached.deadline || '');
      setHasGracePeriod(cached.has_grace_period || false);
      setDeadline2(cached.deadline2 || '');
      setMaxFileEnabled(cached.max_file_enabled || false);
      setMaxFile(cached.max_file ?? null);
      setInstructionFiles(cached.instruction_files || []);
      setInitialSnapshot(JSON.stringify({
        title: cached.title || '',
        typeId: cached.type_id || initialTypeId,
        mandatory: cached.mandatory,
        instructionHtml: cached.instruction_html || '',
        startTime: cached.start_time || '',
        deadlineMode: cached.deadline_mode === -1 ? -1 : 0,
        deadline: cached.deadline || '',
        hasGracePeriod: cached.has_grace_period || false,
        deadline2: cached.deadline2 || '',
        maxFileEnabled: cached.max_file_enabled || false,
        maxFile: cached.max_file ?? null,
      }));
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    const storageKey = `${TA_ASSIGNMENT_DETAIL_CACHE_PREFIX}${exerciseRefId}_${assId}`;
    if (cached && cache.isIliasSaverFresh(storageKey)) {
      return;
    }

    setIsRevalidating(true);
    setError(null);
    try {
      const data: TAAssignmentDetailResponse = await api.getTAAssignmentDetail(
        exerciseRefId,
        assId,
        typeId
      );
      cache.setCachedTAAssignmentDetail(exerciseRefId, assId, data);
      setTitle(data.title || '');
      setTypeId(data.type_id || initialTypeId);
      if (data.available_types && Object.keys(data.available_types).length) {
        setAvailableTypes({ ...data.available_types, [data.type_id]: data.type_name });
      }
      setMandatory(data.mandatory);
      setInstructionHtml(data.instruction_html || '');
      setStartTime(data.start_time || '');
      setDeadlineMode(data.deadline_mode === -1 ? -1 : 0);
      setDeadline(data.deadline || '');
      setHasGracePeriod(data.has_grace_period || false);
      setDeadline2(data.deadline2 || '');
      setMaxFileEnabled(data.max_file_enabled || false);
      setMaxFile(data.max_file ?? null);
      setInstructionFiles(data.instruction_files || []);
      setInitialSnapshot(JSON.stringify({
        title: data.title || '',
        typeId: data.type_id || initialTypeId,
        mandatory: data.mandatory,
        instructionHtml: data.instruction_html || '',
        startTime: data.start_time || '',
        deadlineMode: data.deadline_mode === -1 ? -1 : 0,
        deadline: data.deadline || '',
        hasGracePeriod: data.has_grace_period || false,
        deadline2: data.deadline2 || '',
        maxFileEnabled: data.max_file_enabled || false,
        maxFile: data.max_file ?? null,
      }));

    } catch (err: any) {
      if (!cached) {
        setError(err?.message || t("Fehler beim Laden der Übungsdetails"));
      }
    } finally {
      setIsLoading(false);
      setIsRevalidating(false);
    }
  }, [exerciseRefId, assId, typeId, initialTypeId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Format file size helper
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Save assignment
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isUploadingFile) return;
    setError(null);
    setSuccessMsg(null);
    setValidationAttempted(true);
    const errors = validateFields();
    setFieldErrors(errors);
    const firstInvalid = (Object.keys(fieldIds) as AssignmentField[]).find(field => errors[field]);
    if (firstInvalid) {
      const input = fieldRefs.current[firstInvalid];
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMsg(null);

    const payload: SaveTAAssignmentRequest = {
      ass_id: currentAssId,
      title: title.trim(),
      type_id: typeId,
      mandatory,
      instruction_html: instructionHtml,
      start_time: startTime || null,
      deadline_mode: deadlineMode,
      deadline: deadlineMode === 0 && deadline ? deadline : null,
      has_grace_period: hasGracePeriod,
      deadline2: hasGracePeriod && deadline2 ? deadline2 : null,
      max_file_enabled: maxFileEnabled,
      max_file: maxFileEnabled && maxFile ? maxFile : null,
    };

    try {
      const res = await api.saveTAAssignment(exerciseRefId, payload);
      const newAssId = res.ass_id || currentAssId;
      if (newAssId) {
        setCurrentAssId(newAssId);
      }

      // If there were pending files queued during creation, upload them now!
      if (pendingFiles.length > 0 && newAssId) {
        setIsUploadingFile(true);
        let updatedList = res.instruction_files || instructionFiles;
        const remaining: File[] = [];
        let uploadError: unknown;
        for (const file of pendingFiles) {
          try {
            updatedList = await api.uploadTAInstructionFile(exerciseRefId, newAssId, file);
            setInstructionFiles(updatedList);
          } catch (err) {
            remaining.push(file);
            uploadError = err;
          }
        }
        setPendingFiles(remaining);
        setIsUploadingFile(false);
        if (remaining.length) {
          setError(t('editor.attachments_failed') + ' ' + (uploadError instanceof Error ? uploadError.message : ''));
          return;
        }
      } else if (res.instruction_files) {
        setInstructionFiles(res.instruction_files);
      }

      setInitialSnapshot(JSON.stringify({
        title,
        typeId,
        mandatory,
        instructionHtml,
        startTime,
        deadlineMode,
        deadline,
        hasGracePeriod,
        deadline2,
        maxFileEnabled,
        maxFile,
      }));
      setSuccessMsg(t("Übung erfolgreich gespeichert."));
      setTimeout(() => setSuccessMsg(null), 3000);
      if (newAssId) {
        setSavedResult({ id: newAssId, created: !assId, title: title.trim() });
      }
    } catch (err: any) {
      setError(err?.message || t("Fehler beim Speichern der Übung"));
    } finally {
      setIsSaving(false);
    }
  };

  // Upload or queue instruction files
  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    if (!currentAssId) {
      // Creation mode: queue the files locally to be uploaded as soon as the exercise is saved
      const newFiles: File[] = [];
      for (let i = 0; i < files.length; i++) {
        newFiles.push(files[i]);
      }
      setPendingFiles((prev) => [...prev, ...newFiles]);
      setSuccessMsg(t("{p0} Datei(en) hinzugefügt. Sie werden beim Erstellen der Übung hochgeladen.", { p0: newFiles.length }));
      setTimeout(() => setSuccessMsg(null), 3000);
      return;
    }

    // Existing assignment: upload immediately to ILIAS
    setIsUploadingFile(true);
    setError(null);
    try {
      let updatedList = instructionFiles;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        updatedList = await api.uploadTAInstructionFile(exerciseRefId, currentAssId, file);
        setInstructionFiles(updatedList);
      }
      setInstructionFiles(updatedList);
      setSuccessMsg(t("Anweisungsdatei(en) erfolgreich hochgeladen."));
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.message || t("Fehler beim Hochladen der Datei"));
    } finally {
      setIsUploadingFile(false);
    }
  };

  // Remove a pending file before saving
  const handleRemovePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Delete an existing instruction file
  const handleDeleteFile = async (fileId: string) => {
    if (!currentAssId) return;
    if (!confirm(t("Möchten Sie diese Anweisungsdatei wirklich entfernen?"))) return;

    setIsDeletingFileId(fileId);
    setError(null);
    try {
      await api.deleteTAInstructionFile(exerciseRefId, currentAssId, fileId);
      setInstructionFiles((prev) => prev.filter((f) => f.file_id !== fileId));
      setSuccessMsg(t("Datei erfolgreich gelöscht."));
      setTimeout(() => setSuccessMsg(null), 2500);
    } catch (err: any) {
      setError(err?.message || t("Fehler beim Löschen der Datei"));
    } finally {
      setIsDeletingFileId(null);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  const totalFilesCount = instructionFiles.length + pendingFiles.length;

  const currentSnapshot = JSON.stringify({
    title,
    typeId,
    mandatory,
    instructionHtml,
    startTime,
    deadlineMode,
    deadline,
    hasGracePeriod,
    deadline2,
    maxFileEnabled,
    maxFile,
  });
  const isDirty = (initialSnapshot !== null && initialSnapshot !== currentSnapshot) || pendingFiles.length > 0;

  useNavigationGuard({
    isDirty,
    isPending: isSaving || isUploadingFile || Boolean(isDeletingFileId),
    message: t("Sie haben ungespeicherte Änderungen. Möchten Sie die Seite wirklich verlassen und Ihre Änderungen verwerfen?"),
  });

  // Navigate only after React has committed the clean draft and finished saving.
  // Otherwise the navigation guard can reject a successful save on slower devices.
  useEffect(() => {
    if (!savedResult || isSaving || isUploadingFile || isDirty) return;
    setSavedResult(null);
    if (savedResult.id) {
      cache.invalidateCachedTAAssignmentDetail(exerciseRefId, savedResult.id);
    }
    cache.invalidateCachedTAAssignments(exerciseRefId);
    onSaved(savedResult.id, { created: savedResult.created, title: savedResult.title });
  }, [savedResult, isSaving, isUploadingFile, isDirty, onSaved]);

  const handleSafeBack = () => {
    if (navigationGuard.confirmNavigation()) {
      onBack();
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="ta-editor-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSafeBack}
            className="flex items-center justify-center p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
            title={t("Zurück zur Übungsverwaltung")}
            aria-label={t("Zurück zur Übungsverwaltung")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {currentAssId ? t("Übung bearbeiten") : t("Neue Übung erstellen")}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {currentAssId ? `ID: ${currentAssId} • ` : ''}
              {t("Konfigurieren Sie Titel, Art der Einreichung, Termine und Arbeitsanweisungen")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSafeBack}
            className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition cursor-pointer"
          >
            {t("Abbrechen")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoading || isUploadingFile}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>{currentAssId ? t("Änderungen speichern") : t("Übung erstellen")}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div role="alert" className="flex items-center gap-3 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-16 text-center border border-slate-200 dark:border-slate-800">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-indigo-500" />
          <p className="text-sm font-medium text-slate-500">{t("Übungsdetails werden geladen...")}</p>
        </div>
      ) : (
        <form noValidate onSubmit={handleSave} className="space-y-6">
          {/* Section 1: Grunddaten */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <FileText className="h-4 w-4 text-indigo-500" />
              <span>{t("Grunddaten")}</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Titel */}
              <div className="space-y-1.5 md:col-span-2">
                <label htmlFor={fieldIds.title} className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>{t("Titel der Übung *")}</span>
                  <span className="text-[11px] text-slate-400">{t("Erforderlich")}</span>
                </label>
                <input {...fieldAttributes('title')}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("z.B. Übungsblatt 01: Einführung in Algorithmen")}
                  required
                  className={`w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium ${invalidFieldStyle}`}
                />
                {fieldError('title')}
              </div>

              {/* Art der Einreichung (Selectable without wiping other keys!) */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="assignment-type" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t("Art der Einreichung")}
                  </label>
                  {currentAssId && <span className="relative group inline-flex">
                    <button type="button" aria-label={t('editor.type_fixed')} aria-describedby="assignment-type-info"
                      className="rounded-full text-slate-500 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-300 focus-visible:outline-2 focus-visible:outline-teal-500">
                      <Info className="h-3.5 w-3.5" />
                    </button>
                    <span id="assignment-type-info" role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-60 -translate-x-1/2 rounded-lg bg-slate-900 p-2 text-xs text-white shadow-lg dark:bg-slate-700 group-hover:block group-focus-within:block">
                      {t('editor.type_fixed')}
                    </span>
                  </span>}
                </div>
                <select
                  id="assignment-type"
                  value={typeId}
                  disabled={Boolean(currentAssId)}
                  onChange={(e) => setTypeId(parseInt(e.target.value, 10))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {Object.entries(availableTypes).map(([id, label]) => (
                    <option key={id} value={id}>
                      {id === '1' ? t('Datei-Upload (Einzelabgabe)') : id === '4' ? t('Team-Upload (Gruppenarbeit)') : label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Pflichtabgabe */}
              <div className="space-y-1.5 flex flex-col justify-center">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t("Verpflichtung")}
                </label>
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mandatory}
                    onChange={(e) => setMandatory(e.target.checked)}
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    {t("Verpflichtende Übung (Teilnahme erforderlich)")}
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Section 2: Termine & Fristen */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <Calendar className="h-4 w-4 text-indigo-500" />
              <span>{t("Termine & Fristen")}</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Startzeit */}
              <div className="space-y-1.5">
                <label htmlFor={fieldIds.startTime} className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <span>{t("Startzeit (Ab wann bearbeitbar)")}</span>
                </label>
                <input {...fieldAttributes('startTime')}
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={`w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium ${invalidFieldStyle}`}
                />
                {fieldError('startTime')}
              </div>

              {/* Deadline Mode (0 = Fixed Date, -1 = No Deadline) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t("Abgabetermin-Modus")}
                </label>
                <div className="flex items-center gap-3 pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="deadline_mode"
                      value={-1}
                      checked={deadlineMode === -1}
                      onChange={() => setDeadlineMode(-1)}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>{t("Kein Abgabetermin")}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="deadline_mode"
                      value={0}
                      checked={deadlineMode === 0}
                      onChange={() => setDeadlineMode(0)}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>{t("Festes Abgabedatum")}</span>
                  </label>
                </div>
              </div>

              {/* Deadline DateTime */}
              {deadlineMode === 0 && (
                <div className="space-y-1.5">
                  <label htmlFor="assignment-deadline" className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>{t("Abgabetermin (Deadline)")}</span>
                  </label>
                  <input {...fieldAttributes('deadline')}
                    type="datetime-local"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className={`w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium ${invalidFieldStyle}`}
                  />
                  {fieldError('deadline')}
                </div>
              )}

              {/* Grace Period (Nachfrist) */}
              {deadlineMode === 0 && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasGracePeriod}
                      onChange={(e) => setHasGracePeriod(e.target.checked)}
                      className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                    />
                    <span>{t("Nachfrist gewähren")}</span>
                  </label>
                  {hasGracePeriod && (
                    <div className="space-y-1.5">
                      <input {...fieldAttributes('deadline2')} aria-label={t('editor.grace_end')} required
                        type="datetime-local"
                        value={deadline2}
                        onChange={(e) => setDeadline2(e.target.value)}
                        placeholder={t("Nachfrist bis...")}
                        className={`w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium ${invalidFieldStyle}`}
                      />
                      {fieldError('deadline2')}
                    </div>
                  )}
                </div>
              )}

              {/* Max Files Limit */}
              <div className="space-y-2 md:col-span-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={maxFileEnabled}
                    onChange={(e) => setMaxFileEnabled(e.target.checked)}
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span>{t("Maximale Anzahl an Einreichungsdateien begrenzen")}</span>
                </label>
                {maxFileEnabled && (
                  <div className="max-w-xs">
                    <input {...fieldAttributes('maxFile')} aria-label={t('editor.file_limit')} required
                      type="number"
                      min={1}
                      max={100}
                      value={maxFile ?? ''}
                      onChange={(e) =>
                        setMaxFile(e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder={t("z.B. 1 oder 5")}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium ${invalidFieldStyle}`}
                    />
                    {fieldError('maxFile')}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Arbeitsanweisungen (Work Instructions with Rich Text Formatting) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-500" />
                <span>{t("Arbeitsanweisungen")}</span>
              </h2>
              <span className="text-[11px] text-slate-400">
                {t("Wird als formatiertes HTML in ILIAS gespeichert")}
              </span>
            </div>

            <InstructionEditor value={instructionHtml} onChange={setInstructionHtml} />
          </div>

          {/* Section 4: Instruction Files (Arbeitsanweisungs-Dateien direkt auf dieser Seite!) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-indigo-500" />
                  <span>{t("Arbeitsanweisungs-Dateien (Anhänge für Studierende)")}</span>
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {t("Begleitmaterialien, Vorlagen oder Aufgabenbeschreibungen direkt anheften (bleibt auf dieser Seite!)")}
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                {totalFilesCount} {totalFilesCount === 1 ? t("Datei") : t("Dateien")}
              </span>
            </div>

            {/* List of files (server-uploaded + pending creation files) */}
            {(instructionFiles.length > 0 || pendingFiles.length > 0) && (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                {/* Existing uploaded files */}
                {instructionFiles.map((f) => (
                  <div
                    key={f.file_id}
                    className="flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-800/40 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Paperclip className="h-4 w-4 text-indigo-500 shrink-0" />
                      <div className="truncate">
                        <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {f.filename}
                        </p>
                        {f.file_size && (
                          <p className="text-[10px] text-slate-400">{f.file_size}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {f.download_url && (
                        <a
                          href={f.download_url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 transition"
                          title={t("Datei herunterladen")}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(f.file_id)}
                        disabled={isDeletingFileId === f.file_id}
                        className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition cursor-pointer"
                        title={t("Datei entfernen")}
                      >
                        {isDeletingFileId === f.file_id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}

                {/* Staged pending files (for new assignment creation) */}
                {pendingFiles.map((pf, idx) => (
                  <div
                    key={`pending-${idx}`}
                    className="flex items-center justify-between p-3 bg-amber-50/50 dark:bg-amber-950/20 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Paperclip className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <div className="truncate">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {pf.name}
                          </p>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                            {t("Wird beim Speichern hochgeladen")}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">{formatFileSize(pf.size)}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemovePendingFile(idx)}
                      className="p-1.5 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition cursor-pointer"
                      title={t("Aus Warteschlange entfernen")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Drag & Drop Upload Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                isDraggingOver
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/40 dark:bg-slate-800/20'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => handleUploadFiles(e.target.files)}
                className="hidden"
              />
              {isUploadingFile ? (
                <div className="flex flex-col items-center gap-2 text-indigo-600 dark:text-indigo-400">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-xs font-semibold">{t("Anweisungsdatei(en) werden hochgeladen...")}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {t("Dateien hierher ziehen oder")} <span className="text-indigo-600 dark:text-indigo-400 underline">{t("durchsuchen")}</span>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {t("PDF, ZIP, Word oder andere Anweisungsdateien anhängen")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Save Bar */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleSafeBack}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition cursor-pointer"
            >
              {t("Abbrechen")}
            </button>
            <button
              type="submit"
              disabled={isSaving || isRevalidating}
              title={isRevalidating ? t("Aktualisierung läuft... Bitte warten") : undefined}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span>{currentAssId ? t("Änderungen speichern") : t("Übung erstellen")}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
