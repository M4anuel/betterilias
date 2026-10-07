import React, { useEffect, useState } from 'react';
import {
  X,
  User,
  Users,
  Clock,
  Calendar,
  CheckCircle2,
  AlertCircle,
  FileText,
  Download,
  Mail,
  ExternalLink,
  Shield,
  MessageSquare,
  Award,
  HelpCircle,
  Save,
  Check,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { SubmissionItem, FeedbackFileItem } from '../types';
import { api } from '../lib/api';

interface SubmissionDetailModalProps {
  submission: SubmissionItem;
  exerciseTitle?: string;
  assignmentTitle?: string;
  exerciseRefId?: string;
  assId?: string;
  isUpdating?: boolean;
  initialEdit?: {
    status: string;
    mark: string;
    feedback: string;
    notice: string;
  };
  onSave?: (
    memberId: string,
    data: { status: string; mark: string; feedback: string; notice: string }
  ) => Promise<void>;
  onClose: () => void;
}

export const SubmissionDetailModal: React.FC<SubmissionDetailModalProps> = ({
  submission,
  exerciseTitle,
  assignmentTitle,
  exerciseRefId,
  assId,
  isUpdating,
  initialEdit,
  onSave,
  onClose,
}) => {
  // Editable form state
  const [status, setStatus] = useState<string>(
    initialEdit?.status || submission.passed_status || 'not_graded'
  );
  const [mark, setMark] = useState<string>(
    initialEdit?.mark !== undefined ? initialEdit.mark : submission.mark || ''
  );
  const [feedback, setFeedback] = useState<string>(
    initialEdit?.feedback !== undefined ? initialEdit.feedback : submission.feedback || ''
  );
  const [notice, setNotice] = useState<string>(
    initialEdit?.notice !== undefined ? initialEdit.notice : submission.notice || ''
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Feedback files state
  const [feedbackFiles, setFeedbackFiles] = useState<FeedbackFileItem[]>([]);
  const [isLoadingFeedbackFiles, setIsLoadingFeedbackFiles] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (exerciseRefId && submission.evaluation_by_file_url) {
      setIsLoadingFeedbackFiles(true);
      api
        .getFeedbackFiles(exerciseRefId, submission.member_id, assId)
        .then((res) => {
          setFeedbackFiles(res.files || []);
        })
        .catch(() => {})
        .finally(() => setIsLoadingFeedbackFiles(false));
    }
  }, [exerciseRefId, submission.member_id, submission.evaluation_by_file_url, assId]);

  const handleUploadFeedbackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !exerciseRefId) return;

    setIsUploadingFile(true);
    setUploadSuccessMsg(null);
    try {
      const res = await api.uploadFeedbackFile(exerciseRefId, submission.member_id, file, assId);
      setFeedbackFiles(res.files || []);
      setUploadSuccessMsg(`"${file.name}" erfolgreich hochgeladen.`);
      setTimeout(() => setUploadSuccessMsg(null), 3500);
    } catch (err: any) {
      alert(`Fehler beim Hochladen: ${err.message}`);
    } finally {
      setIsUploadingFile(false);
      e.target.value = '';
    }
  };


  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave(submission.member_id, { status, mark, feedback, notice });
      setIsSaved(true);
      setIsDirty(false);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err: any) {
      alert(err.message || 'Fehler beim Speichern der Bewertung');
    } finally {
      setIsSaving(false);
    }
  };

  const hasSubmitted = Boolean(
    submission.download_url ||
    (submission.files && submission.files.length > 0) ||
    ['submitted', 'late'].includes(submission.submission_status)
  );

  // Status badge helper
  const renderStatusBadge = () => {
    if (status === 'passed') {
      return (
        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Bestanden</span>
        </span>
      );
    }
    if (status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 border border-red-200">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Nicht bestanden</span>
        </span>
      );
    }
    if (hasSubmitted) {
      return (
        <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 border border-sky-200">
          <Clock className="h-3.5 w-3.5" />
          <span>Abgegeben (Offen)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500 border border-slate-200">
        <HelpCircle className="h-3.5 w-3.5" />
        <span>Nicht abgegeben</span>
      </span>
    );
  };

  const members =
    submission.team_members && submission.team_members.length > 0
      ? submission.team_members
      : [submission.student_name];

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-3xl bg-white shadow-2xl border border-slate-200/80 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="submission-modal-title"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700 border border-indigo-200/80">
                Abgabe-Details & Bewertung
              </span>
              {renderStatusBadge()}
            </div>
            <h2 id="submission-modal-title" className="text-lg font-bold text-slate-900 leading-snug">
              {submission.team_id ? `Team #${submission.team_id}` : submission.student_name}
            </h2>
            {(assignmentTitle || exerciseTitle) && (
              <p className="text-xs text-slate-500">
                {assignmentTitle && <span className="font-semibold text-slate-700">{assignmentTitle}</span>}
                {assignmentTitle && exerciseTitle && ' • '}
                {exerciseTitle && <span>{exerciseTitle}</span>}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 transition cursor-pointer"
            aria-label="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Team Members Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
              <Users className="h-3.5 w-3.5 text-indigo-500" />
              <span>
                {members.length > 1 ? `Gruppenmitglieder (${members.length})` : 'Teilnehmer'}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {members.map((member, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200/80 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs"
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 font-bold text-[10px] shrink-0">
                    <User className="h-3.5 w-3.5" />
                  </div>
                  <span>{member}</span>
                </div>
              ))}
              {submission.login && (
                <div className="flex items-center gap-1 rounded-xl bg-slate-100 border border-slate-200 px-3 py-1.5 text-xs font-mono text-slate-500">
                  <span className="text-[10px] text-slate-400">Login:</span>
                  <span>{submission.login}</span>
                </div>
              )}
            </div>
          </div>

          {/* EDITABLE GRADING & EVALUATION CARD */}
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/40 via-white to-slate-50 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-indigo-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-2xs">
                  <Award className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Korrektur & Bewertung bearbeiten
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Status, Noten, Feedback und Tutoren-Notizen direkt speichern
                  </p>
                </div>
              </div>

              {onSave && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || isUpdating}
                  title={isUpdating ? 'Aktualisierung läuft... Bitte warten' : 'Speichern'}
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer ${
                    isSaved
                      ? 'bg-emerald-600'
                      : isDirty
                      ? 'bg-indigo-600 hover:bg-indigo-700'
                      : 'bg-slate-800 hover:bg-slate-900'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Speichern...</span>
                    </>
                  ) : isUpdating ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-300" />
                      <span>Lädt...</span>
                    </>
                  ) : isSaved ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-white" />
                      <span>Gespeichert!</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      <span>Speichern</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: Status Buttons & Grade/Points Input */}
              <div className="space-y-3">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                  Status (Bestanden / Nicht bestanden)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStatus('passed');
                      setIsDirty(true);
                    }}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                      status === 'passed'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50'
                    }`}
                  >
                    <span>Bestanden</span>
                    {status === 'passed' && <Check className="h-3.5 w-3.5 mt-0.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStatus('failed');
                      setIsDirty(true);
                    }}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                      status === 'failed'
                        ? 'bg-red-600 text-white border-red-600 shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-red-50'
                    }`}
                  >
                    <span>Nicht best.</span>
                    {status === 'failed' && <Check className="h-3.5 w-3.5 mt-0.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStatus('not_graded');
                      setIsDirty(true);
                    }}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                      status === 'not_graded'
                        ? 'bg-slate-700 text-white border-slate-700 shadow-2xs'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span>Offen</span>
                    {status === 'not_graded' && <Check className="h-3.5 w-3.5 mt-0.5" />}
                  </button>
                </div>

                {/* Grade / Points input (Always editable here in info modal!) */}
                <div className="space-y-1 pt-1">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                    Note / Punkte (Mark)
                  </label>
                  <input
                    type="text"
                    value={mark}
                    onChange={(e) => {
                      setMark(e.target.value);
                      setIsDirty(true);
                    }}
                    placeholder="Note oder Punktzahl (z.B. 5.5 oder 18/20)"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Right Column: Internal Tutor Notes Textbox */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800">
                  <Shield className="h-3.5 w-3.5 text-amber-600" />
                  <span>Notiz für Tutoren (Nur intern sichtbar)</span>
                </div>
                <textarea
                  rows={4}
                  value={notice}
                  onChange={(e) => {
                    setNotice(e.target.value);
                    setIsDirty(true);
                  }}
                  placeholder="Interne Tutor-Notiz eingeben (wird für Studierende NICHT angezeigt)..."
                  className="w-full rounded-xl border border-amber-200 bg-amber-50/50 p-2.5 text-xs text-amber-950 placeholder-amber-700/50 focus:border-amber-500 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-400"
                />
              </div>
            </div>

            {/* Evaluation Statement Textarea */}
            <div className="space-y-1 pt-1 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <MessageSquare className="h-3.5 w-3.5 text-indigo-600" />
                <span>Evaluation Statement (Korrektur-Feedback für Studierende)</span>
              </div>
              <textarea
                rows={3}
                value={feedback}
                onChange={(e) => {
                  setFeedback(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="Korrektur-Kommentar für den/die Studierende verfassen..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          </div>

          {/* Files & Submission Downloads */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
              <FileText className="h-3.5 w-3.5 text-indigo-500" />
              <span>Eingereichte Dateien ({submission.files.length})</span>
            </div>

            {submission.files.length > 0 ? (
              <div className="space-y-2">
                {submission.files.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 hover:border-indigo-200 transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">{file.filename}</p>
                        {file.upload_time && (
                          <p className="text-[10px] text-slate-400">Hochgeladen: {file.upload_time}</p>
                        )}
                      </div>
                    </div>

                    <a
                      href={file.download_url}
                      download
                      className="flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-600 hover:text-white transition shrink-0 border border-indigo-200"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download</span>
                    </a>
                  </div>
                ))}
              </div>
            ) : submission.download_url ? (
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5">
                <span className="text-xs text-slate-600 font-medium">Abgabe-Archiv verfügbar</span>
                <a
                  href={submission.download_url}
                  download
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-600 hover:text-white transition border border-indigo-200"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Gesamtabgabe herunterladen</span>
                </a>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                Keine Dateien eingereicht.
              </div>
            )}
          </div>

          {/* Feedback / Evaluation Files Section */}
          {submission.evaluation_by_file_url && (
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Korrektur-Dateien (Evaluation Files)
                </h3>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={`modal-upload-${submission.member_id}`}
                    className={`flex items-center gap-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 text-xs font-bold transition border border-indigo-200 cursor-pointer ${
                      isUploadingFile ? 'opacity-50 cursor-wait' : ''
                    }`}
                  >
                    {isUploadingFile ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    <span>{isUploadingFile ? 'Wird hochgeladen...' : 'Korrekturdatei hochladen'}</span>
                  </label>
                  <input
                    id={`modal-upload-${submission.member_id}`}
                    type="file"
                    className="hidden"
                    disabled={isUploadingFile}
                    onChange={handleUploadFeedbackFile}
                  />
                  <a
                    href={submission.evaluation_by_file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
                    title="In ILIAS öffnen"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>ILIAS</span>
                  </a>
                </div>
              </div>

              {uploadSuccessMsg && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>{uploadSuccessMsg}</span>
                </div>
              )}

              {isLoadingFeedbackFiles ? (
                <div className="p-3 text-xs text-slate-400 flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                  <span>Lade Korrekturdateien aus ILIAS...</span>
                </div>
              ) : feedbackFiles.length > 0 ? (
                <div className="space-y-2">
                  {feedbackFiles.map((ff) => (
                    <div
                      key={ff.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-indigo-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">{ff.title}</p>
                          <p className="text-[10px] text-slate-400">
                            {ff.size && `${ff.size} • `}{ff.created_on && `Erstellt: ${ff.created_on}`}
                          </p>
                        </div>
                      </div>
                      {ff.download_url && (
                        <a
                          href={ff.download_url}
                          download
                          className="flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-600 hover:text-white transition border border-indigo-200"
                        >
                          <Download className="h-3 w-3" />
                          <span>Download</span>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  Noch keine Korrekturdatei für diese(n) Studierende(n) hochgeladen.
                </div>
              )}
            </div>
          )}

          {/* All Columns / Timestamps Grid */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Spalten- & Zeitdaten
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Submitted on (Bug-fixed: shows Eingereicht even if timestamp column was hidden in ILIAS table) */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[11px]">
                  <Clock className="h-3.5 w-3.5 text-sky-500" />
                  <span>Abgegeben am (Submitted on)</span>
                </div>
                <div className="font-bold text-slate-800">
                  {submission.submission_time ? (
                    submission.submission_time
                  ) : hasSubmitted ? (
                    <span className="text-emerald-700 font-medium">
                      Eingereicht (Zeitpunkt in ILIAS-Tabelle ausgeblendet)
                    </span>
                  ) : (
                    <span className="text-slate-400 font-normal">Keine Abgabe vorhanden</span>
                  )}
                </div>
              </div>

              {/* Graded on */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[11px]">
                  <Calendar className="h-3.5 w-3.5 text-indigo-500" />
                  <span>Bewertet am (Graded on)</span>
                </div>
                <div className="font-bold text-slate-800">
                  {submission.graded_on || (
                    <span className="text-slate-400 font-normal">Noch nicht erfasst</span>
                  )}
                </div>
              </div>

              {/* Evaluation on */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[11px]">
                  <MessageSquare className="h-3.5 w-3.5 text-amber-500" />
                  <span>Rückmeldung am (Evaluation on)</span>
                </div>
                <div className="font-bold text-slate-800">
                  {submission.evaluation_on || (
                    <span className="text-slate-400 font-normal">Noch nicht erfasst</span>
                  )}
                </div>
              </div>

              {/* Individual Deadline */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[11px]">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <span>Individuelle Frist</span>
                </div>
                <div className="font-bold text-slate-800">
                  {submission.individual_deadline || (
                    <span className="text-slate-400 font-normal">Standardfrist</span>
                  )}
                </div>
              </div>

              {/* Assignment Sent on */}
              {submission.sent_on && (
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[11px]">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>Aufgabe versendet am</span>
                  </div>
                  <div className="font-bold text-slate-800">{submission.sent_on}</div>
                </div>
              )}
            </div>
          </div>

          {/* Additional raw ILIAS columns */}
          {submission.additional_columns && Object.keys(submission.additional_columns).length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Alle Tabellenspalten aus ILIAS
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {Object.entries(submission.additional_columns).map(([k, v]) => (
                  <div key={k} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block truncate">
                      {k}
                    </span>
                    <span className="text-xs font-medium text-slate-700 block break-words">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer / Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-2 flex-wrap">
            {submission.evaluation_by_file_url && (
              <a
                href={submission.evaluation_by_file_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs"
              >
                <FileText className="h-3.5 w-3.5 text-indigo-500" />
                <span>Evaluation by File</span>
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}

            {submission.feedback_mail_url && (
              <a
                href={submission.feedback_mail_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs"
              >
                <Mail className="h-3.5 w-3.5 text-slate-500" />
                <span>Feedback-Mail verfassen</span>
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}

            {submission.team_log_url && (
              <a
                href={submission.team_log_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs"
              >
                <Users className="h-3.5 w-3.5 text-slate-500" />
                <span>Team-Log</span>
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onSave && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || isUpdating}
                title={isUpdating ? 'Aktualisierung läuft... Bitte warten' : 'Speichern'}
                className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer ${
                  isSaved
                    ? 'bg-emerald-600'
                    : isDirty
                    ? 'bg-indigo-600 hover:bg-indigo-700'
                    : 'bg-slate-800 hover:bg-slate-900'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Speichern...</span>
                  </>
                ) : isUpdating ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-300" />
                    <span>Lädt...</span>
                  </>
                ) : isSaved ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-white" />
                    <span>Gespeichert!</span>
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" />
                    <span>Speichern</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer"
            >
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
