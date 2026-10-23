import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Users,
  Calendar,
  Clock,
  Paperclip,
  Upload,
  Trash2,
  Download,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  RotateCcw,
} from 'lucide-react';
import { api } from '../lib/api';
import { TAAssignmentDetailResponse, TAInstructionFileItem, SaveTAAssignmentRequest } from '../types';

interface TAExerciseEditorViewProps {
  exerciseRefId: string;
  assId: string | null;
  initialTypeId?: number;
  onBack: () => void;
  onSaved: (savedAssId: string) => void;
}

export const TAExerciseEditorView: React.FC<TAExerciseEditorViewProps> = ({
  exerciseRefId,
  assId,
  initialTypeId = 1,
  onBack,
  onSaved,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [typeId, setTypeId] = useState<number>(initialTypeId);
  const [mandatory, setMandatory] = useState(true);
  const [instructionHtml, setInstructionHtml] = useState('');
  const [startTime, setStartTime] = useState('');
  const [deadlineMode, setDeadlineMode] = useState<number>(1);
  const [deadline, setDeadline] = useState('');
  const [hasGracePeriod, setHasGracePeriod] = useState(false);
  const [deadline2, setDeadline2] = useState('');
  const [maxFileEnabled, setMaxFileEnabled] = useState(false);
  const [maxFile, setMaxFile] = useState<number | null>(null);

  // Instruction files state
  const [instructionFiles, setInstructionFiles] = useState<TAInstructionFileItem[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isDeletingFileId, setIsDeletingFileId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rich Text Editor reference
  const editorRef = useRef<HTMLDivElement>(null);

  // Load existing assignment details
  const loadDetail = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data: TAAssignmentDetailResponse = await api.getTAAssignmentDetail(
        exerciseRefId,
        assId,
        typeId
      );
      setTitle(data.title || '');
      setTypeId(data.type_id || initialTypeId);
      setMandatory(data.mandatory);
      setInstructionHtml(data.instruction_html || '');
      setStartTime(data.start_time || '');
      setDeadlineMode(data.deadline_mode ?? 1);
      setDeadline(data.deadline || '');
      setHasGracePeriod(data.has_grace_period || false);
      setDeadline2(data.deadline2 || '');
      setMaxFileEnabled(data.max_file_enabled || false);
      setMaxFile(data.max_file ?? null);
      setInstructionFiles(data.instruction_files || []);

      if (editorRef.current) {
        editorRef.current.innerHTML = data.instruction_html || '';
      }
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Laden der Übungsdetails');
    } finally {
      setIsLoading(false);
    }
  }, [exerciseRefId, assId, typeId, initialTypeId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Sync editor content
  const handleEditorInput = () => {
    if (editorRef.current) {
      setInstructionHtml(editorRef.current.innerHTML);
    }
  };

  const executeEditorCommand = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setInstructionHtml(editorRef.current.innerHTML);
    }
  };

  const handleInsertLink = () => {
    const url = prompt('URL für den Link eingeben:', 'https://');
    if (url) {
      executeEditorCommand('createLink', url);
    }
  };

  // Save assignment
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Bitte geben Sie einen Titel für die Übung an.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMsg(null);

    const payload: SaveTAAssignmentRequest = {
      ass_id: assId,
      title: title.trim(),
      type_id: typeId,
      mandatory,
      instruction_html: instructionHtml,
      start_time: startTime || null,
      deadline_mode: deadlineMode,
      deadline: deadlineMode === 1 && deadline ? deadline : null,
      has_grace_period: hasGracePeriod,
      deadline2: hasGracePeriod && deadline2 ? deadline2 : null,
      max_file_enabled: maxFileEnabled,
      max_file: maxFileEnabled && maxFile ? maxFile : null,
    };

    try {
      const res = await api.saveTAAssignment(exerciseRefId, payload);
      setSuccessMsg('Übung erfolgreich gespeichert.');
      setTimeout(() => setSuccessMsg(null), 3000);
      if (res.ass_id) {
        onSaved(res.ass_id);
      }
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Speichern der Übung');
    } finally {
      setIsSaving(false);
    }
  };

  // Upload instruction file
  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!assId) {
      setError('Bitte speichern Sie die Übung zuerst einmal ab, bevor Sie Dateien anhängen.');
      return;
    }

    setIsUploadingFile(true);
    setError(null);
    try {
      let updatedList = instructionFiles;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        updatedList = await api.uploadTAInstructionFile(exerciseRefId, assId, file);
      }
      setInstructionFiles(updatedList);
      setSuccessMsg('Anweisungsdatei(en) erfolgreich hochgeladen.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Hochladen der Datei');
    } finally {
      setIsUploadingFile(false);
    }
  };

  // Delete instruction file
  const handleDeleteFile = async (fileId: string) => {
    if (!assId) return;
    if (!confirm('Möchten Sie diese Anweisungsdatei wirklich entfernen?')) return;

    setIsDeletingFileId(fileId);
    setError(null);
    try {
      await api.deleteTAInstructionFile(exerciseRefId, assId, fileId);
      setInstructionFiles((prev) => prev.filter((f) => f.file_id !== fileId));
      setSuccessMsg('Datei erfolgreich gelöscht.');
      setTimeout(() => setSuccessMsg(null), 2500);
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Löschen der Datei');
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

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
            title="Zurück zur Übungsverwaltung"
            aria-label="Zurück zur Übungsverwaltung"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {assId ? `Übung bearbeiten` : `Neue Übung erstellen`}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {assId ? `ID: ${assId} • ` : ''}
              Konfigurieren Sie Titel, Art der Einreichung, Termine und Arbeitsanweisungen
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition cursor-pointer"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>{assId ? 'Änderungen speichern' : 'Übung erstellen'}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-sm">
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
          <p className="text-sm font-medium text-slate-500">Übungsdetails werden geladen...</p>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          {/* Section 1: Grunddaten */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <FileText className="h-4 w-4 text-indigo-500" />
              <span>Grunddaten</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Titel */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>Titel der Übung *</span>
                  <span className="text-[11px] text-slate-400">Erforderlich</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="z.B. Übungsblatt 01: Einführung in Algorithmen"
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>

              {/* Art der Einreichung (Selectable!) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Art der Einreichung
                </label>
                <select
                  value={typeId}
                  onChange={(e) => setTypeId(parseInt(e.target.value, 10))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium cursor-pointer"
                >
                  <option value={1}>Datei-Upload (Einzelabgabe)</option>
                  <option value={4}>Team-Upload (Gruppenarbeit)</option>
                  <option value={2}>Blog</option>
                  <option value={3}>Portfolio</option>
                </select>
                <p className="text-[11px] text-slate-400">
                  Kann hier direkt für neue oder bearbeitete Übungen gewählt werden.
                </p>
              </div>

              {/* Pflichtabgabe */}
              <div className="space-y-1.5 flex flex-col justify-center">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Verpflichtung
                </label>
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mandatory}
                    onChange={(e) => setMandatory(e.target.checked)}
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    Verpflichtende Übung (Teilnahme erforderlich)
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Section 2: Termine & Fristen */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <Calendar className="h-4 w-4 text-indigo-500" />
              <span>Termine & Fristen</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Startzeit */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <span>Startzeit (Ab wann bearbeitbar)</span>
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>

              {/* Deadline Mode */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Abgabetermin-Modus
                </label>
                <div className="flex items-center gap-3 pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="deadline_mode"
                      value={0}
                      checked={deadlineMode === 0}
                      onChange={() => setDeadlineMode(0)}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Kein Abgabetermin</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="deadline_mode"
                      value={1}
                      checked={deadlineMode === 1}
                      onChange={() => setDeadlineMode(1)}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Festes Abgabedatum</span>
                  </label>
                </div>
              </div>

              {/* Deadline DateTime */}
              {deadlineMode === 1 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>Abgabetermin (Deadline)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
                  />
                </div>
              )}

              {/* Grace Period (Nachfrist) */}
              {deadlineMode === 1 && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasGracePeriod}
                      onChange={(e) => setHasGracePeriod(e.target.checked)}
                      className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                    />
                    <span>Nachfrist gewähren</span>
                  </label>
                  {hasGracePeriod && (
                    <input
                      type="datetime-local"
                      value={deadline2}
                      onChange={(e) => setDeadline2(e.target.value)}
                      placeholder="Nachfrist bis..."
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
                    />
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
                  <span>Maximale Anzahl an Einreichungsdateien begrenzen</span>
                </label>
                {maxFileEnabled && (
                  <div className="max-w-xs">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={maxFile ?? ''}
                      onChange={(e) =>
                        setMaxFile(e.target.value ? parseInt(e.target.value, 10) : null)
                      }
                      placeholder="z.B. 1 oder 5"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
                    />
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
                <span>Arbeitsanweisungen</span>
              </h2>
              <span className="text-[11px] text-slate-400">
                Wird als formatiertes HTML in ILIAS gespeichert
              </span>
            </div>

            {/* Formatting Toolbar */}
            <div className="flex items-center gap-1 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/80 flex-wrap">
              <button
                type="button"
                onClick={() => executeEditorCommand('bold')}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
                title="Fett"
                aria-label="Fett formatieren"
              >
                <Bold className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => executeEditorCommand('italic')}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
                title="Kursiv"
                aria-label="Kursiv formatieren"
              >
                <Italic className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => executeEditorCommand('underline')}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
                title="Unterstrichen"
                aria-label="Unterstrichen formatieren"
              >
                <UnderlineIcon className="h-4 w-4" />
              </button>
              <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-1" />
              <button
                type="button"
                onClick={() => executeEditorCommand('insertUnorderedList')}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
                title="Aufzählungsliste"
                aria-label="Aufzählung einfügen"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => executeEditorCommand('insertOrderedList')}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
                title="Nummerierte Liste"
                aria-label="Nummerierte Liste einfügen"
              >
                <ListOrdered className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleInsertLink}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
                title="Link einfügen"
                aria-label="Link einfügen"
              >
                <LinkIcon className="h-4 w-4" />
              </button>
              <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-1" />
              <button
                type="button"
                onClick={() => executeEditorCommand('removeFormat')}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
                title="Formatierung entfernen"
                aria-label="Formatierung entfernen"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>

            {/* Editable Content Container */}
            <div
              ref={editorRef}
              contentEditable
              onInput={handleEditorInput}
              role="textbox"
              aria-multiline="true"
              aria-label="Arbeitsanweisungen formatierter Text"
              className="min-h-[160px] p-4 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed font-normal"
            />
          </div>

          {/* Section 4: Instruction Files (Arbeitsanweisungs-Dateien direkt auf dieser Seite!) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-indigo-500" />
                  <span>Arbeitsanweisungs-Dateien (Anhänge für Studierende)</span>
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Begleitmaterialien, Vorlagen oder Aufgabenbeschreibungen direkt anheften
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                {instructionFiles.length} {instructionFiles.length === 1 ? 'Datei' : 'Dateien'}
              </span>
            </div>

            {/* List of existing instruction files */}
            {instructionFiles.length > 0 && (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
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
                          title="Datei herunterladen"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(f.file_id)}
                        disabled={isDeletingFileId === f.file_id}
                        className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition cursor-pointer"
                        title="Datei entfernen"
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
                  <p className="text-xs font-semibold">Anweisungsdatei wird hochgeladen...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Dateien hierher ziehen oder <span className="text-indigo-600 dark:text-indigo-400 underline">durchsuchen</span>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      PDF, ZIP, Word oder andere Anweisungsdateien anhängen
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
              onClick={onBack}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition cursor-pointer"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span>{assId ? 'Änderungen speichern' : 'Übung erstellen'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
