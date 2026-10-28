import { t, useLanguage, assignmentStatusText } from '../lib/i18n';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  FileText,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  Calendar,
  Users,
  Search,
  Mail,
  Save,
  RefreshCw,
  SlidersHorizontal,
  GraduationCap,
  Sparkles,
  Layers,
  ChevronRight,
  ExternalLink,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  AssignmentItem,
  ExerciseOverviewResponse,
  ExerciseSubmissionsResponse,
  StudentAssignmentDetail,
  SubmissionItem,
} from '../types';
import { api } from '../lib/api';

interface ExerciseModalProps {
  exerciseRefId: string;
  initialTitle?: string;
  onClose: () => void;
}

export const ExerciseModal: React.FC<ExerciseModalProps> = ({
  exerciseRefId,
  initialTitle,
  onClose,
}) => {
  useLanguage();
  // Mode: 'ta' (Teaching Assistant / Grading) or 'student' (My Submission & Feedback)
  const [activeMode, setActiveMode] = useState<'ta' | 'student'>('ta');

  // Loading & error states
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Exercise overview & sub-assignments
  const [overviewData, setOverviewData] = useState<ExerciseOverviewResponse | null>(null);
  const [selectedAssId, setSelectedAssId] = useState<string | null>(null);

  // TA Submissions state
  const [submissionsData, setSubmissionsData] = useState<ExerciseSubmissionsResponse | null>(null);
  const [localEdits, setLocalEdits] = useState<
    Record<string, { status: string; mark: string; feedback: string; isDirty: boolean }>
  >({});
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [savedSuccessId, setSavedSuccessId] = useState<string | null>(null);

  // TA Filter & Search states (Strictly Local)
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_graded' | 'passed' | 'failed' | 'submitted'>('all');
  const [showOptionalColumns, setShowOptionalColumns] = useState(() => {
    return localStorage.getItem('ilias_ta_show_extra_cols') === 'true';
  });

  // Student Assignment Detail state
  const [studentDetail, setStudentDetail] = useState<StudentAssignmentDetail | null>(null);

  // 1. Initial Load: Fetch Exercise Overview
  useEffect(() => {
    let isMounted = true;
    setIsLoadingOverview(true);
    setErrorMessage(null);

    api
      .getExerciseOverview(exerciseRefId)
      .then((data) => {
        if (!isMounted) return;
        setOverviewData(data);

        // Pick first assignment or active assignment
        const firstAss = data.assignments[0];
        if (firstAss && firstAss.ass_id) {
          setSelectedAssId(firstAss.ass_id);
        }

        // If TA link is present, default to TA mode, else student mode
        if (!data.submissions_and_grades_url) {
          setActiveMode('student');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Overview fetch error:', err);
        // Fallback: try loading submissions directly
        api
          .getExerciseSubmissions(exerciseRefId)
          .then((subData) => {
            if (!isMounted) return;
            setSubmissionsData(subData);
            setActiveMode('ta');
            if (subData.active_assignment_id) {
              setSelectedAssId(subData.active_assignment_id);
            }
          })
          .catch((subErr) => {
            if (!isMounted) return;
            setErrorMessage(subErr.message || t("Übung konnte nicht geladen werden."));
          });
      })
      .finally(() => {
        if (isMounted) setIsLoadingOverview(false);
      });

    return () => {
      isMounted = false;
    };
  }, [exerciseRefId]);

  // 2. Fetch Active Assignment Data (TA Submissions or Student Detail)
  const loadActiveContent = useCallback(
    async (assId?: string | null) => {
      setIsLoadingContent(true);
      setErrorMessage(null);

      try {
        if (activeMode === 'ta') {
          const subRes = await api.getExerciseSubmissions(exerciseRefId, assId || undefined);
          setSubmissionsData(subRes);

          // Populate local edits map
          const edits: Record<string, { status: string; mark: string; feedback: string; isDirty: boolean }> = {};
          for (const sub of subRes.submissions) {
            edits[sub.member_id] = {
              status: sub.passed_status || 'not_graded',
              mark: sub.mark || '',
              feedback: sub.feedback || '',
              isDirty: false,
            };
          }
          setLocalEdits(edits);
        } else {
          if (assId) {
            const studRes = await api.getStudentAssignment(exerciseRefId, assId);
            setStudentDetail(studRes);
          }
        }
      } catch (err: any) {
        console.error('Failed to load exercise content:', err);
        setErrorMessage(err.message || t("Fehler beim Laden der Aufgabendaten."));
      } finally {
        setIsLoadingContent(false);
      }
    },
    [exerciseRefId, activeMode]
  );

  useEffect(() => {
    if (!isLoadingOverview) {
      loadActiveContent(selectedAssId);
    }
  }, [selectedAssId, activeMode, isLoadingOverview, loadActiveContent]);

  // Toggle optional columns
  const handleToggleExtraColumns = () => {
    const next = !showOptionalColumns;
    setShowOptionalColumns(next);
    localStorage.setItem('ilias_ta_show_extra_cols', String(next));
  };

  // Local Edits change handlers
  const handleStatusChange = (memberId: string, status: string) => {
    setLocalEdits((prev) => ({
      ...prev,
      [memberId]: {
        ...(prev[memberId] || { mark: '', feedback: '', status: 'not_graded' }),
        status,
        isDirty: true,
      },
    }));
  };

  const handleMarkChange = (memberId: string, mark: string) => {
    setLocalEdits((prev) => ({
      ...prev,
      [memberId]: {
        ...(prev[memberId] || { status: 'not_graded', feedback: '', mark: '' }),
        mark,
        isDirty: true,
      },
    }));
  };

  const handleFeedbackChange = (memberId: string, feedback: string) => {
    setLocalEdits((prev) => ({
      ...prev,
      [memberId]: {
        ...(prev[memberId] || { status: 'not_graded', mark: '', feedback: '' }),
        feedback,
        isDirty: true,
      },
    }));
  };

  // Save single submission
  const handleSaveSubmission = async (memberId: string) => {
    const edit = localEdits[memberId];
    if (!edit) return;

    setSavingMemberId(memberId);
    try {
      await api.gradeSubmission(exerciseRefId, memberId, {
        member_id: memberId,
        ass_id: selectedAssId || undefined,
        status: edit.status,
        mark: edit.mark || undefined,
        feedback: edit.feedback || undefined,
        rtoken: submissionsData?.rtoken,
      });

      // Mark as not dirty
      setLocalEdits((prev) => ({
        ...prev,
        [memberId]: { ...prev[memberId], isDirty: false },
      }));

      // Update in-memory submissions
      setSubmissionsData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          submissions: prev.submissions.map((s) => {
            if (s.member_id === memberId) {
              return {
                ...s,
                passed_status: edit.status,
                mark: edit.mark,
                feedback: edit.feedback,
              };
            }
            return s;
          }),
        };
      });

      // Trigger success flash
      setSavedSuccessId(memberId);
      setTimeout(() => setSavedSuccessId(null), 2500);
    } catch (err: any) {
      alert(t("Fehler beim Speichern: {p0}", { p0: err.message }));
    } finally {
      setSavingMemberId(null);
    }
  };

  // Filtered submissions list (Local Instant Filtering)
  const submissionsList = submissionsData?.submissions || [];
  const filteredSubmissions = useMemo(() => {
    return submissionsList.filter((s) => {
      if (savedSuccessId === s.member_id) {
        return true;
      }

      // 1. Status Filter
      const edit = localEdits[s.member_id];
      const isUnsaved = Boolean(edit?.isDirty);
      const curStatus = (isUnsaved ? s.passed_status : edit?.status) || s.passed_status || 'not_graded';

      if (statusFilter === 'passed' && curStatus !== 'passed') return false;
      if (statusFilter === 'failed' && curStatus !== 'failed') return false;
      if (statusFilter === 'not_graded' && curStatus !== 'not_graded') return false;
      if (statusFilter === 'submitted' && s.submission_status !== 'submitted' && s.submission_status !== 'late') {
        return false;
      }

      // 2. Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = s.student_name.toLowerCase().includes(q);
        const matchesTeam = s.team_id ? s.team_id.toLowerCase().includes(q) : false;
        const matchesLogin = s.login ? s.login.toLowerCase().includes(q) : false;
        const matchesFeedback = (edit?.feedback || s.feedback || '').toLowerCase().includes(q);
        if (!matchesName && !matchesTeam && !matchesLogin && !matchesFeedback) {
          return false;
        }
      }

      return true;
    });
  }, [submissionsList, statusFilter, searchQuery, localEdits, savedSuccessId]);

  // Counts for TA filters
  const counts = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let notGraded = 0;
    let submitted = 0;

    for (const s of submissionsList) {
      const edit = localEdits[s.member_id];
      const isUnsaved = Boolean(edit?.isDirty);
      const st = (isUnsaved ? s.passed_status : edit?.status) || s.passed_status || 'not_graded';
      if (st === 'passed') passed++;
      else if (st === 'failed') failed++;
      else notGraded++;

      if (s.submission_status === 'submitted' || s.submission_status === 'late') {
        submitted++;
      }
    }

    return { total: submissionsList.length, passed, failed, notGraded, submitted };
  }, [submissionsList, localEdits]);

  // List of available assignments
  const availableAssignments = useMemo(() => {
    if (submissionsData?.available_assignments && submissionsData.available_assignments.length > 0) {
      return submissionsData.available_assignments;
    }
    return overviewData?.assignments || [];
  }, [submissionsData, overviewData]);

  const modalTitle =
    submissionsData?.exercise.title || overviewData?.title || initialTitle || t("Übungen & Abgaben");

  return (
    <div className="app-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-5 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="flex h-full max-h-[92dvh] w-full max-w-6xl flex-col rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/90 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm shrink-0">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700 border border-indigo-200">
                  {t("ILIAS Übungseinheit")}
                </span>
                <span className="text-xs text-slate-400">{t("Ref:")} {exerciseRefId}</span>
              </div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">{modalTitle}</h2>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            {/* View Mode Toggle: TA vs Student */}
            <div className="flex items-center gap-1 rounded-xl bg-slate-200/80 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveMode('ta')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition cursor-pointer ${
                  activeMode === 'ta'
                    ? 'bg-white text-indigo-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <GraduationCap className="h-4 w-4 text-indigo-600" />
                <span>{t("Tutor-Korrektur")}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveMode('student')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition cursor-pointer ${
                  activeMode === 'student'
                    ? 'bg-white text-emerald-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sparkles className="h-4 w-4 text-emerald-600" />
                <span>{t("Meine Abgabe & Feedback")}</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 transition cursor-pointer"
              title={t("Schließen")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Sub-Assignments Switcher Tab Bar */}
        {availableAssignments.length > 0 && (
          <div className="border-b border-slate-200 bg-white px-6 py-2.5 flex items-center gap-2 overflow-x-auto scrollbar-thin">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 shrink-0 mr-1">
              {t("Aufgabe:")}
            </span>
            {availableAssignments.map((ass) => {
              const isSelected = (selectedAssId && ass.ass_id === selectedAssId) || ass.is_selected;

              return (
                <button
                  key={ass.ass_id || ass.title}
                  type="button"
                  onClick={() => {
                    if (ass.ass_id) {
                      setSelectedAssId(ass.ass_id);
                    }
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold transition whitespace-nowrap cursor-pointer shrink-0 border ${
                    isSelected
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-900 shadow-2xs'
                      : 'border-slate-200 bg-slate-50/60 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span>{ass.title}</span>
                  {ass.edit_until && (
                    <span className="rounded bg-white/80 px-1.5 py-0.2 text-[10px] font-semibold text-slate-500 border border-slate-200/60">
                      {assignmentStatusText(ass.edit_until)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Modal Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMessage && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-800 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isLoadingContent ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="h-8 w-8 animate-spin text-indigo-500" />
              <p className="text-xs font-semibold">{t("Lade Aufgabendaten aus ILIAS...")}</p>
            </div>
          ) : activeMode === 'ta' ? (
            /* ========================================================
               TEACHING ASSISTANT / TA GRADING VIEW
               ======================================================== */
            <div className="space-y-4">
              {/* Filter & Instant Search Toolbar */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 shadow-2xs">
                {/* Search input */}
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("Student, Login, Team (z.B. 39146) oder Feedback durchsuchen...")}
                    className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 shadow-2xs"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      statusFilter === 'all'
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {t("Alle (")}{counts.total})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('not_graded')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      statusFilter === 'not_graded'
                        ? 'bg-amber-500 text-white shadow-2xs'
                        : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                    }`}
                  >
                    {t("Offen (")}{counts.notGraded})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('passed')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      statusFilter === 'passed'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                    }`}
                  >
                    {t("Bestanden (")}{counts.passed})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('failed')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      statusFilter === 'failed'
                        ? 'bg-red-600 text-white shadow-2xs'
                        : 'bg-red-50 text-red-800 border border-red-200 hover:bg-red-100'
                    }`}
                  >
                    {t("Nicht bestanden (")}{counts.failed})
                  </button>

                  <div className="h-4 w-px bg-slate-300 mx-1" />

                  <button
                    type="button"
                    onClick={handleToggleExtraColumns}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer border ${
                      showOptionalColumns
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                    title={t("Zusätzliche Spalten anzeigen")}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span>{t("Spalten")}</span>
                  </button>
                </div>
              </div>

              {/* Submissions List */}
              {filteredSubmissions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
                  <p className="text-xs font-semibold">{t("Keine Abgaben für diesen Filter gefunden.")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredSubmissions.map((sub) => {
                    const edit = localEdits[sub.member_id] || {
                      status: sub.passed_status || 'not_graded',
                      mark: sub.mark || '',
                      feedback: sub.feedback || '',
                      isDirty: false,
                    };
                    const isSaving = savingMemberId === sub.member_id;
                    const isSaved = savedSuccessId === sub.member_id;

                    return (
                      <div
                        key={sub.member_id}
                        className={`rounded-2xl border bg-white p-4 transition shadow-2xs space-y-3 ${
                          edit.isDirty
                            ? 'border-amber-300 ring-1 ring-amber-200'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {/* Row Header: Student Info & Actions */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 font-bold text-xs shrink-0">
                              {sub.student_name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-slate-900">
                                  {sub.student_name}
                                </span>
                                {sub.team_id && (
                                  <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                                    {t("Team")} {sub.team_id}
                                  </span>
                                )}
                                {showOptionalColumns && sub.login && (
                                  <span className="font-mono text-[10px] text-slate-400">
                                    ({sub.login})
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                                {sub.submission_time && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    <span>{t("Abgabe:")} {sub.submission_time}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Direct Actions: Download, Mail, Team Log */}
                          <div className="flex items-center gap-2 flex-wrap self-end sm:self-auto">
                            {sub.download_url ? (
                              <a
                                href={sub.download_url}
                                download
                                className="flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-600 hover:text-white transition shadow-2xs border border-indigo-200"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>{t("Abgabe herunterladen")}</span>
                              </a>
                            ) : (
                              <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-400">
                                {t("Keine Datei")}
                              </span>
                            )}

                            {sub.feedback_mail_url && (
                              <a
                                href={sub.feedback_mail_url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
                                title={t("Feedback Mail an Studierende senden")}
                              >
                                <Mail className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">{t("Mail")}</span>
                              </a>
                            )}

                            {showOptionalColumns && sub.team_log_url && (
                              <a
                                href={sub.team_log_url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
                                title={t("Team Log einsehen")}
                              >
                                <Users className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">{t("Log")}</span>
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Grading & Evaluation Area */}
                        <div className="rounded-xl bg-slate-50/80 p-3 border border-slate-100 flex flex-col md:flex-row gap-3">
                          {/* Left: Status Toggle & Grade */}
                          <div className="w-full md:w-56 shrink-0 space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                              {t("Bewertung & Status")}
                            </label>

                            {/* Status Pills */}
                            <div className="flex flex-col gap-1">
                              <button
                                type="button"
                                onClick={() => handleStatusChange(sub.member_id, 'passed')}
                                className={`flex items-center justify-between rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer border ${
                                  edit.status === 'passed'
                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50'
                                }`}
                              >
                                <span>{t("Bestanden")}</span>
                                {edit.status === 'passed' && <Check className="h-3 w-3" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleStatusChange(sub.member_id, 'failed')}
                                className={`flex items-center justify-between rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer border ${
                                  edit.status === 'failed'
                                    ? 'bg-red-600 text-white border-red-600 shadow-2xs'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-red-50'
                                }`}
                              >
                                <span>{t("Nicht bestanden")}</span>
                                {edit.status === 'failed' && <Check className="h-3 w-3" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleStatusChange(sub.member_id, 'not_graded')}
                                className={`flex items-center justify-between rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer border ${
                                  edit.status === 'not_graded'
                                    ? 'bg-slate-700 text-white border-slate-700 shadow-2xs'
                                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                <span>{t("Nicht bewertet")}</span>
                                {edit.status === 'not_graded' && <Check className="h-3 w-3" />}
                              </button>
                            </div>

                            {/* Points / Mark input */}
                            <div>
                              <input
                                type="text"
                                value={edit.mark}
                                onChange={(e) => handleMarkChange(sub.member_id, e.target.value)}
                                placeholder={t("Note / Punkte (optional)")}
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
                              />
                            </div>
                          </div>

                          {/* Middle: Inline Evaluation Statement Textarea */}
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                              {t("Evaluation Statement (Korrektur-Kommentar für Studierende)")}
                            </label>
                            <textarea
                              rows={3}
                              value={edit.feedback}
                              onChange={(e) => handleFeedbackChange(sub.member_id, e.target.value)}
                              placeholder={t("Feedback / Korrektur-Notizen für den/die Studierende eingeben...")}
                              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-sans"
                            />
                          </div>

                          {/* Right: Save Button */}
                          <div className="flex md:flex-col justify-end items-end gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleSaveSubmission(sub.member_id)}
                              disabled={isSaving}
                              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer ${
                                isSaved
                                  ? 'bg-emerald-600'
                                  : edit.isDirty
                                  ? 'bg-indigo-600 hover:bg-indigo-700'
                                  : 'bg-slate-700 hover:bg-slate-800'
                              } disabled:opacity-50`}
                            >
                              {isSaving ? (
                                <>
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  <span>{t("Speichern...")}</span>
                                </>
                              ) : isSaved ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-white" />
                                  <span>{t("Gespeichert!")}</span>
                                </>
                              ) : (
                                <>
                                  <Save className="h-3.5 w-3.5" />
                                  <span>{t("Speichern")}</span>
                                </>
                              )}
                            </button>
                            {edit.isDirty && (
                              <span className="text-[10px] font-semibold text-amber-600">
                                {t("Ungespeichert")}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ========================================================
               STUDENT ASSIGNMENT VIEW (Instructions, Files, Team, Evaluation)
               ======================================================== */
            <div className="space-y-6 max-w-4xl mx-auto">
              {studentDetail ? (
                <>
                  {/* Schedule & Timeline Banner */}
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5 shadow-2xs space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-indigo-600" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                          {t("Terminplan & Fristen")}
                        </h3>
                      </div>
                      {studentDetail.time_remaining && (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            studentDetail.is_ended
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {assignmentStatusText(studentDetail.time_remaining)}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {studentDetail.start_time && (
                        <div className="rounded-xl bg-white p-3 border border-indigo-100/60 shadow-2xs">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            {t("Startzeit")}
                          </span>
                          <span className="font-semibold text-slate-800">{studentDetail.start_time}</span>
                        </div>
                      )}
                      {studentDetail.ended_on && (
                        <div className="rounded-xl bg-white p-3 border border-indigo-100/60 shadow-2xs">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            {t("Abgabefrist")}
                          </span>
                          <span className="font-semibold text-slate-800">{assignmentStatusText(studentDetail.ended_on)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Work Instructions */}
                  {studentDetail.instructions && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-slate-500" />
                        <span>{t("Arbeitsanweisung")}</span>
                      </h3>
                      <div className="ilias-rich-content text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: studentDetail.instructions }} />
                    </div>
                  )}

                  {/* Exercise Prompt Files */}
                  {studentDetail.exercise_files.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                        <Download className="h-4 w-4 text-indigo-600" />
                        <span>{t("Übungsunterlagen & Aufgabenstellung")}</span>
                      </h3>
                      <div className="space-y-2">
                        {studentDetail.exercise_files.map((f, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-3 hover:bg-slate-50 transition"
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <FileText className="h-4 w-4 text-red-500 shrink-0" />
                              <span className="text-xs font-bold text-slate-800 truncate">
                                {f.filename}
                              </span>
                            </div>
                            <a
                              href={f.download_url}
                              download
                              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 transition shadow-2xs"
                            >
                              <Download className="h-3 w-3" />
                              <span>{t("Herunterladen")}</span>
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Team Card */}
                  {(studentDetail.is_team_upload ?? Boolean(studentDetail.create_team_url || studentDetail.manage_team_url || studentDetail.delete_team_url || studentDetail.team_status_text)) && <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                        <Users className="h-4 w-4 text-indigo-600" />
                        <span>{t("Team")}</span>
                      </h3>
                      {studentDetail.team_members.length > 0 && selectedAssId && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(t("Möchtest du das Team wirklich auflösen?"))) return;
                            try {
                              const updated = await api.deleteStudentTeam(exerciseRefId, selectedAssId);
                              setStudentDetail(updated);
                            } catch (err: any) {
                              alert(err.message || t("Fehler beim Auflösen des Teams"));
                            }
                          }}
                          className="text-xs font-bold text-rose-600 hover:text-rose-800 flex items-center gap-1 cursor-pointer"
                        >
                          <span>{t("Team auflösen")}</span>
                        </button>
                      )}
                    </div>

                    {studentDetail.team_members.length > 0 ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        {studentDetail.team_members.map((member, i) => (
                          <span
                            key={i}
                            className="rounded-xl bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800 border border-indigo-200"
                          >
                            {member}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 flex items-center justify-between">
                        <span>{studentDetail.team_status_text || t("Sie gehören noch keinem Team an.")}</span>
                        {studentDetail.create_team_url && selectedAssId && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const updated = await api.createStudentTeam(exerciseRefId, selectedAssId);
                                setStudentDetail(updated);
                              } catch (err: any) {
                                alert(err.message || t("Fehler beim Erstellen des Teams"));
                              }
                            }}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 shadow-2xs cursor-pointer"
                          >
                            {t("Team erstellen")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>}
                  {/* Submission Card */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>{t("Meine Einreichung")}</span>
                    </h3>

                    {studentDetail.submitted_files.length > 0 ? (
                      <div className="space-y-2">
                        {studentDetail.submitted_files.map((sf, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/40 p-3"
                          >
                            <span className="text-xs font-bold text-emerald-900">{sf.filename}</span>
                            <a
                              href={sf.download_url}
                              download
                              className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
                            >
                              <Download className="h-3 w-3" />
                              <span>{t("Abgabe anzeigen")}</span>
                            </a>
                          </div>
                        ))}
                        {studentDetail.last_submission && (
                          <p className="text-[11px] text-slate-400">
                            {t("Letzte Abgabe:")} {studentDetail.last_submission}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">{t("Bisher keine Abgabe eingereicht.")}</p>
                    )}
                  </div>

                  {/* Tutor Evaluation / Statement Card */}
                  {studentDetail.evaluation_statement ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-2xs space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span>{t("Bewertung & Feedback des Tutors")}</span>
                        </h3>
                        <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-2xs">
                          {studentDetail.passed_status === 'passed' ? t("Bestanden") : t("Bewertet")}
                        </span>
                      </div>

                      <div className="rounded-xl bg-white p-4 border border-emerald-100 shadow-2xs">
                        <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap font-sans">
                          {studentDetail.evaluation_statement}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-400">
                  <p className="text-xs font-semibold">{t("Keine Detaildaten für diese Aufgabe gefunden.")}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

