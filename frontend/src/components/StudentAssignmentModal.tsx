import React, { useEffect, useState } from 'react';
import {
  X,
  FileText,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  Calendar,
  Users,
  ExternalLink,
  Award,
  RefreshCw,
  PlusCircle,
  Upload,
  Trash2,
} from 'lucide-react';
import { StudentAssignmentDetail } from '../types';
import { api } from '../lib/api';
import { cache } from '../lib/cache';

interface StudentAssignmentModalProps {
  exerciseRefId: string;
  assId: string;
  assignmentTitle: string;
  onClose: () => void;
}

export const StudentAssignmentModal: React.FC<StudentAssignmentModalProps> = ({
  exerciseRefId,
  assId,
  assignmentTitle,
  onClose,
}) => {
  const [detail, setDetail] = useState<StudentAssignmentDetail | null>(() => {
    return cache.getCachedStudentAssignment(exerciseRefId, assId);
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    return !cache.getCachedStudentAssignment(exerciseRefId, assId);
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);

  const handleUploadStudentFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadSuccessMessage(null);
    try {
      const updated = await api.uploadStudentAssignmentFile(exerciseRefId, assId, file);
      setDetail(updated);
      cache.setCachedStudentAssignment(exerciseRefId, assId, updated);
      if (updated.submitted_files && updated.submitted_files.length > 0) {
        setUploadSuccessMessage(`"${file.name}" erfolgreich eingereicht.`);
      } else {
        alert('Die Datei wurde übertragen, aber ILIAS hat sie noch nicht in der Übersicht gelistet. Bitte in Kürze erneut prüfen.');
      }
      setTimeout(() => setUploadSuccessMessage(null), 4000);
    } catch (err: any) {
      alert(`Fehler beim Hochladen der Abgabe: ${err.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const [deletingDeliveredId, setDeletingDeliveredId] = useState<string | null>(null);

  const handleDeleteStudentFile = async (deliveredId: string, filename: string) => {
    if (!window.confirm(`Möchtest du die Datei "${filename}" wirklich löschen?`)) {
      return;
    }

    setDeletingDeliveredId(deliveredId);
    try {
      const updated = await api.deleteStudentAssignmentFile(exerciseRefId, assId, deliveredId);
      setDetail(updated);
      cache.setCachedStudentAssignment(exerciseRefId, assId, updated);
      setUploadSuccessMessage(`"${filename}" erfolgreich gelöscht.`);
      setTimeout(() => setUploadSuccessMessage(null), 4000);
    } catch (err: any) {
      alert(`Fehler beim Löschen der Abgabe: ${err.message}`);
    } finally {
      setDeletingDeliveredId(null);
    }
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Fetch assignment presentation detail
  useEffect(() => {
    let active = true;
    const cached = cache.getCachedStudentAssignment(exerciseRefId, assId);
    if (!cached) {
      setIsLoading(true);
    }
    setErrorMessage(null);

    api
      .getStudentAssignment(exerciseRefId, assId)
      .then((data) => {
        if (active) {
          setDetail(data);
          cache.setCachedStudentAssignment(exerciseRefId, assId, data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          if (!cached) {
            setErrorMessage(err.message || 'Übungsdetails konnten nicht geladen werden.');
          }
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [exerciseRefId, assId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="relative w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-8 flex flex-col max-h-[90vh] transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4 bg-slate-50/70 dark:bg-slate-800/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                {detail?.title || assignmentTitle}
              </h2>
              <p className="text-xs text-slate-400 dark:text-slate-500">Übungsblatt & Einreichung</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
            title="Schließen (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading && !detail ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-600" />
              <p className="text-xs font-semibold">Lade Details zur Aufgabe...</p>
            </div>
          ) : errorMessage ? (
            <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/30 p-6 text-center space-y-2">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400 mx-auto" />
              <h3 className="text-sm font-bold text-red-900 dark:text-red-200">Fehler beim Laden</h3>
              <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition"
              >
                Schließen
              </button>
            </div>
          ) : detail ? (
            <>
              {/* Schedule & Fristen Banner */}
              <div className="rounded-2xl border border-indigo-100 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/40 p-4 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-200">
                      Terminplan & Fristen
                    </h3>
                  </div>
                  {detail.time_remaining && (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        detail.is_ended
                          ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                      }`}
                    >
                      {detail.time_remaining}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-indigo-100/70 dark:border-indigo-900/50">
                  {detail.start_time && (
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <Clock className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                      <span>
                        <strong className="text-slate-800 dark:text-slate-100">Start:</strong> {detail.start_time}
                      </span>
                    </div>
                  )}
                  {detail.ended_on && (
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <Clock className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
                      <span>
                        <strong className="text-slate-800 dark:text-slate-100">Abgabefrist:</strong> {detail.ended_on}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Instructions Panel */}
              {detail.instructions && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Arbeitsanweisung
                  </h3>
                  <div
                    className="ilias-rich-content text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans"
                    dangerouslySetInnerHTML={{ __html: detail.instructions }}
                  />
                </div>
              )}

              {/* Exercise Materials Download Panel */}
              {detail.exercise_files && detail.exercise_files.length > 0 && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-2">
                    <Download className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Aufgaben-Materialien & Vorlagen</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {detail.exercise_files.map((file, idx) => (
                      <a
                        key={idx}
                        href={file.download_url}
                        download
                        className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/60 p-3 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/40 hover:border-indigo-200 dark:hover:border-indigo-800 transition group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-800 dark:group-hover:text-indigo-300 truncate block">
                            {file.filename}
                          </span>
                        </div>
                        <Download className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Team Information & Team Creation */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Team & Gruppenmitglieder</span>
                  </h3>

                  {detail.create_team_url && (
                    <a
                      href={detail.create_team_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition border border-indigo-200 dark:border-indigo-800"
                    >
                      <PlusCircle className="h-3.5 w-3.5" />
                      <span>Team erstellen (ILIAS)</span>
                    </a>
                  )}
                </div>

                {detail.team_members && detail.team_members.length > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {detail.team_members.map((member, idx) => (
                      <span
                        key={idx}
                        className="rounded-lg bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 text-xs font-medium text-indigo-800 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 flex items-center gap-1"
                      >
                        <Users className="h-3 w-3 text-indigo-500 dark:text-indigo-400" />
                        <span>{member}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {detail.team_status_text || 'Kein Team zugeordnet oder Einzelabgabe.'}
                  </p>
                )}
              </div>

              {/* Submission Status & Uploaded Files */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Eigene Einreichung
                    </h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        detail.submitted_files && detail.submitted_files.length > 0
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {detail.submitted_files && detail.submitted_files.length > 0
                        ? 'Abgegeben'
                        : detail.submission_status || 'Keine Abgabe'}
                    </span>
                  </div>

                  {/* Upload Submission Button */}
                  {!detail.is_ended && (
                    <div>
                      <label
                        htmlFor={`student-upload-${assId}`}
                        className={`flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 text-xs font-bold transition shadow-2xs cursor-pointer ${
                          isUploading ? 'opacity-60 cursor-wait' : ''
                        }`}
                      >
                        {isUploading ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        <span>{isUploading ? 'Wird hochgeladen...' : 'Abgabe einreichen'}</span>
                      </label>
                      <input
                        id={`student-upload-${assId}`}
                        type="file"
                        className="hidden"
                        disabled={isUploading}
                        onChange={handleUploadStudentFile}
                      />
                    </div>
                  )}
                </div>

                {uploadSuccessMessage && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 font-semibold flex items-center gap-1.5 animate-in fade-in">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>{uploadSuccessMessage}</span>
                  </div>
                )}

                {detail.submitted_files && detail.submitted_files.length > 0 ? (
                  <div className="space-y-2">
                    {detail.last_submission && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                        Letzte Einreichung: {detail.last_submission}
                      </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {detail.submitted_files.map((subFile, idx) => {
                        const downloadTarget = api.getDownloadUrl(exerciseRefId, subFile.download_url);
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 p-3 hover:bg-slate-100/80 dark:hover:bg-slate-800 transition"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 pr-2">
                              <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <div className="min-w-0">
                                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate block">
                                  {subFile.filename}
                                </span>
                                {subFile.upload_time && (
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                                    {subFile.upload_time}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={downloadTarget}
                                download={subFile.filename}
                                className="flex items-center gap-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 hover:text-indigo-700 dark:hover:text-indigo-300 hover:border-indigo-200 dark:hover:border-indigo-700 transition shadow-2xs shrink-0"
                                title="Abgabe direkt herunterladen"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>Download</span>
                              </a>
                              {subFile.delivered_id && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStudentFile(subFile.delivered_id!, subFile.filename)}
                                  disabled={deletingDeliveredId === subFile.delivered_id}
                                  className="flex items-center justify-center rounded-lg bg-white dark:bg-slate-700 border border-rose-200 dark:border-rose-900/60 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:border-rose-300 transition shadow-2xs shrink-0 cursor-pointer disabled:opacity-50"
                                  title="Abgabe löschen"
                                >
                                  {deletingDeliveredId === subFile.delivered_id ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-slate-400 dark:text-slate-500 space-y-1">
                    <p className="font-semibold text-slate-600 dark:text-slate-300">Noch keine Dateien eingereicht</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">Nutzen Sie den Button oben rechts, um Ihre Ausarbeitung einzureichen.</p>
                  </div>
                )}
              </div>

              {/* Tutor Evaluation Feedback Card */}
              <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/30 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                      Bewertung durch Tutor
                    </h3>
                  </div>

                  {detail.passed_status && (
                    <span
                      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        detail.passed_status === 'passed'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                          : detail.passed_status === 'failed'
                          ? 'bg-red-100 text-red-800 border border-red-300 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800'
                          : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {detail.passed_status === 'passed' ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>Bestanden</span>
                        </>
                      ) : detail.passed_status === 'failed' ? (
                        <>
                          <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                          <span>Nicht bestanden</span>
                        </>
                      ) : (
                        <span>Nicht bewertet</span>
                      )}
                    </span>
                  )}
                </div>

                {detail.mark && (
                  <p className="text-xs text-amber-900 dark:text-amber-200 font-semibold">
                    Note / Punkte: <span className="font-mono">{detail.mark}</span>
                  </p>
                )}

                {detail.evaluation_statement ? (
                  <div className="rounded-xl bg-white dark:bg-slate-800 p-3.5 border border-amber-200/80 dark:border-amber-900/60 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed shadow-2xs">
                    {detail.evaluation_statement}
                  </div>
                ) : (
                  <p className="text-xs text-amber-800/70 dark:text-amber-400/70 italic">
                    Noch kein Feedback-Kommentar hinterlegt.
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-6 py-3.5 bg-slate-50/70 dark:bg-slate-800/80 shrink-0">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">Drücke Esc zum Schließen</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 dark:bg-slate-800 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};

