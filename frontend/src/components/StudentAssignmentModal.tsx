import { t, useLanguage, assignmentStatusText } from '../lib/i18n';
import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  FileText,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  Calendar,
  Users,
  Award,
  RefreshCw,
  PlusCircle,
  Upload,
  Trash2,
  UserPlus,
  UserMinus,
  Search,
  Check,
} from 'lucide-react';
import { CourseUserCandidate, StudentAssignmentDetail, TeamMemberInfo } from '../types';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { useNavigationGuard } from '../lib/navigationGuard';

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
  useLanguage();
  const [detail, setDetail] = useState<StudentAssignmentDetail | null>(() => {
    return cache.getCachedStudentAssignment(exerciseRefId, assId);
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    return !cache.getCachedStudentAssignment(exerciseRefId, assId);
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);

  // Team Management State
  const [isCreatingTeam, setIsCreatingTeam] = useState<boolean>(false);
  const [isDeletingTeam, setIsDeletingTeam] = useState<boolean>(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState<boolean>(false);
  const [candidates, setCandidates] = useState<CourseUserCandidate[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState<boolean>(false);
  const [candidateSearchQuery, setCandidateSearchQuery] = useState<string>('');
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [manualUserLogin, setManualUserLogin] = useState<string>('');
  const [isAddingMembers, setIsAddingMembers] = useState<boolean>(false);
  const [addingSingleUserId, setAddingSingleUserId] = useState<string | null>(null);
  const [teamFeedbackMessage, setTeamFeedbackMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const showTeamFeedback = (type: 'success' | 'error', text: string) => {
    setTeamFeedbackMessage({ type, text });
    if (type === 'success') {
      setTimeout(() => {
        setTeamFeedbackMessage((prev) => (prev?.text === text ? null : prev));
      }, 4500);
    }
  };

  const loadCandidates = async (force = false) => {
    if (candidates.length > 0 && !force) return;
    setIsLoadingCandidates(true);
    try {
      const res = await api.getTeamCandidates(exerciseRefId, assId);
      setCandidates(res.candidates || []);
      if (res.current_user_id) {
        setCurrentUserId(res.current_user_id);
      }
    } catch (err: any) {
      showTeamFeedback('error', t("Kurs-Teilnehmerliste konnte nicht geladen werden: {p0}", { p0: err.message }));
    } finally {
      setIsLoadingCandidates(false);
    }
  };

  const handleToggleAddMemberPanel = () => {
    const nextOpen = !isAddMemberOpen;
    setIsAddMemberOpen(nextOpen);
    if (nextOpen && candidates.length === 0) {
      loadCandidates();
    }
  };

  const handleCreateTeam = async () => {
    setIsCreatingTeam(true);
    setTeamFeedbackMessage(null);
    try {
      const updated = await api.createStudentTeam(exerciseRefId, assId);
      setDetail(updated);
      cache.setCachedStudentAssignment(exerciseRefId, assId, updated);
      showTeamFeedback('success', t("Team erfolgreich erstellt! Du kannst jetzt Mitglieder aus dem Kurs hinzufügen."));
      setIsAddMemberOpen(true);
      loadCandidates(true);
    } catch (err: any) {
      showTeamFeedback('error', t("Team konnte nicht erstellt werden: {p0}", { p0: err.message }));
    } finally {
      setIsCreatingTeam(false);
    }
  };

  const handleAddSingleCandidate = async (candidate: CourseUserCandidate) => {
    setAddingSingleUserId(candidate.user_id);
    setTeamFeedbackMessage(null);
    try {
      const updated = await api.addStudentTeamMembers(exerciseRefId, assId, {
        user_ids: [candidate.user_id],
      });
      setDetail(updated);
      cache.setCachedStudentAssignment(exerciseRefId, assId, updated);
      setSelectedCandidateIds((prev) => {
        const next = new Set(prev);
        next.delete(candidate.user_id);
        return next;
      });
      showTeamFeedback('success', t("{p0} ({p1}) wurde zum Team hinzugefügt.", { p0: candidate.full_name, p1: candidate.login }));
    } catch (err: any) {
      showTeamFeedback('error', t("Mitglied konnte nicht hinzugefügt werden: {p0}", { p0: err.message }));
    } finally {
      setAddingSingleUserId(null);
    }
  };

  const handleAddSelectedCandidates = async () => {
    const ids = Array.from(selectedCandidateIds);
    if (ids.length === 0) return;

    setIsAddingMembers(true);
    setTeamFeedbackMessage(null);
    try {
      const updated = await api.addStudentTeamMembers(exerciseRefId, assId, {
        user_ids: ids,
      });
      setDetail(updated);
      cache.setCachedStudentAssignment(exerciseRefId, assId, updated);
      setSelectedCandidateIds(new Set());
      showTeamFeedback('success', ids.length === 1 ? t('One person was added to the team.') : t('{count} people were added to the team.', { count: ids.length }));
    } catch (err: any) {
      showTeamFeedback('error', t("Mitglieder konnten nicht hinzugefügt werden: {p0}", { p0: err.message }));
    } finally {
      setIsAddingMembers(false);
    }
  };

  const handleAddManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualUserLogin.trim().replace(/^\[|\]$/g, '');
    if (!cleaned) return;

    setIsAddingMembers(true);
    setTeamFeedbackMessage(null);
    try {
      const updated = await api.addStudentTeamMembers(exerciseRefId, assId, {
        user_logins: [cleaned],
      });
      setDetail(updated);
      cache.setCachedStudentAssignment(exerciseRefId, assId, updated);
      setManualUserLogin('');
      showTeamFeedback('success', t("\"{p0}\" wurde zum Team hinzugefügt.", { p0: cleaned }));
    } catch (err: any) {
      showTeamFeedback('error', t("Benutzer \"{p0}\" konnte nicht hinzugefügt werden: {p1}", { p0: cleaned, p1: err.message }));
    } finally {
      setIsAddingMembers(false);
    }
  };

  const handleRemoveTeamMember = async (member: TeamMemberInfo) => {
    if (!member.user_id) {
      showTeamFeedback('error', t("Benutzer-ID für dieses Teammitglied nicht verfügbar. Bitte lade die Ansicht neu."));
      return;
    }
    const label = member.name || member.login || member.user_id;
    if (!window.confirm(t("Möchtest du \"{p0}\" wirklich aus dem Team entfernen?", { p0: label }))) {
      return;
    }

    setRemovingMemberId(member.user_id);
    setTeamFeedbackMessage(null);
    try {
      const updated = await api.removeStudentTeamMembers(exerciseRefId, assId, [member.user_id]);
      setDetail(updated);
      cache.setCachedStudentAssignment(exerciseRefId, assId, updated);
      showTeamFeedback('success', t("\"{p0}\" wurde aus dem Team entfernt.", { p0: label }));
    } catch (err: any) {
      showTeamFeedback('error', t("Mitglied konnte nicht entfernt werden: {p0}", { p0: err.message }));
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleDeleteTeam = async () => {
    const memberCount = resolvedTeamMembers.length;
    const confirmMsg =
      memberCount > 1
        ? t("Möchtest du das gesamte Team ({p0} Mitglieder) wirklich auflösen?\n\nHinweis: Da ILIAS ein Team erst löschen lässt, wenn nur noch 1 Person darin ist, entfernt BetterIlias zuerst automatisch alle anderen Teammitglieder und löst danach das Team auf.", { p0: memberCount })
        : t("Möchtest du dein Team wirklich auflösen?");

    if (!window.confirm(confirmMsg)) {
      return;
    }

    setIsDeletingTeam(true);
    setTeamFeedbackMessage(null);
    try {
      const updated = await api.deleteStudentTeam(exerciseRefId, assId);
      setDetail(updated);
      cache.setCachedStudentAssignment(exerciseRefId, assId, updated);
      setIsAddMemberOpen(false);
      setSelectedCandidateIds(new Set());
      showTeamFeedback('success', t("Das Team wurde erfolgreich aufgelöst."));
    } catch (err: any) {
      showTeamFeedback('error', t("Team konnte nicht aufgelöst werden: {p0}", { p0: err.message }));
    } finally {
      setIsDeletingTeam(false);
    }
  };

  const toggleCandidateSelection = (userId: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  // Resolve and enrich team members with loaded candidates directory
  const resolvedTeamMembers: TeamMemberInfo[] = useMemo(() => {
    if (!detail) return [];
    const candidateById = new Map<string, CourseUserCandidate>();
    const candidateByLogin = new Map<string, CourseUserCandidate>();
    for (const c of candidates) {
      if (c.user_id) candidateById.set(c.user_id, c);
      if (c.login) candidateByLogin.set(c.login.toLowerCase(), c);
    }

    let baseList: TeamMemberInfo[] = [];
    if (detail.team_member_details && detail.team_member_details.length > 0) {
      baseList = detail.team_member_details;
    } else if (detail.team_members && detail.team_members.length > 0) {
      baseList = detail.team_members.map((raw) => {
        const bracketMatch = raw.match(/\[([^\]]+)\]/);
        const login = bracketMatch ? bracketMatch[1].trim() : raw.trim().replace(/^\[|\]$/g, '');
        return {
          user_id: undefined,
          login,
          name: undefined,
          is_self: detail.team_members.length === 1,
        };
      });
    }

    return baseList.map((m) => {
      const matched: CourseUserCandidate | undefined =
        (m.user_id ? candidateById.get(m.user_id) : undefined) ||
        (m.login ? candidateByLogin.get(m.login.toLowerCase()) : undefined);
      const fullName = m.name || matched?.full_name || undefined;
      const userId = m.user_id || matched?.user_id || undefined;
      const login = m.login || matched?.login || '';
      const isSelf =
        m.is_self ||
        Boolean(currentUserId && userId === currentUserId) ||
        baseList.length === 1;
      return {
        ...m,
        user_id: userId,
        login,
        name: fullName,
        is_self: isSelf,
      };
    });
  }, [detail, candidates, currentUserId]);

  const existingMemberUserIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of resolvedTeamMembers) {
      if (m.user_id) s.add(m.user_id);
    }
    return s;
  }, [resolvedTeamMembers]);

  const existingMemberLogins = useMemo(() => {
    const s = new Set<string>();
    for (const m of resolvedTeamMembers) {
      if (m.login) s.add(m.login.toLowerCase());
    }
    return s;
  }, [resolvedTeamMembers]);

  const filteredCandidates = useMemo(() => {
    const q = candidateSearchQuery.trim().toLowerCase();
    const matching = q
      ? candidates.filter(
          (c) =>
            c.full_name.toLowerCase().includes(q) ||
            c.login.toLowerCase().includes(q) ||
            c.lastname.toLowerCase().includes(q) ||
            c.firstname.toLowerCase().includes(q)
        )
      : [...candidates];

    return matching.sort((a, b) => {
      const aChecked =
        selectedCandidateIds.has(a.user_id) ||
        existingMemberUserIds.has(a.user_id) ||
        (Boolean(a.login) && existingMemberLogins.has(a.login.toLowerCase()));
      const bChecked =
        selectedCandidateIds.has(b.user_id) ||
        existingMemberUserIds.has(b.user_id) ||
        (Boolean(b.login) && existingMemberLogins.has(b.login.toLowerCase()));

      if (aChecked !== bChecked) {
        return aChecked ? -1 : 1;
      }
      const aSelected = selectedCandidateIds.has(a.user_id);
      const bSelected = selectedCandidateIds.has(b.user_id);
      if (aSelected !== bSelected) {
        return aSelected ? -1 : 1;
      }
      return 0;
    });
  }, [
    candidates,
    candidateSearchQuery,
    selectedCandidateIds,
    existingMemberUserIds,
    existingMemberLogins,
  ]);

  const hasTeam = Boolean(
    detail &&
      (resolvedTeamMembers.length > 0 ||
        detail.manage_team_url ||
        detail.delete_team_url)
  );
  const isTeamUpload = detail?.is_team_upload ?? Boolean(
    detail?.create_team_url || detail?.manage_team_url || detail?.delete_team_url || detail?.team_status_text
  );

  const canCreateTeam = Boolean(
    detail && isTeamUpload &&
      !hasTeam &&
      !detail.is_ended &&
      (detail.create_team_url ||
        (detail.team_status_text &&
          /no team|kein team/i.test(detail.team_status_text)))
  );

  const uploadStudentFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0 || isUploading) return;

    setIsUploading(true);
    setUploadSuccessMessage(null);
    try {
      let lastUpdated: StudentAssignmentDetail | null = null;
      for (const file of fileList) {
        lastUpdated = await api.uploadStudentAssignmentFile(exerciseRefId, assId, file);
      }
      if (lastUpdated) {
        setDetail(lastUpdated);
        cache.setCachedStudentAssignment(exerciseRefId, assId, lastUpdated);
        // The backend confirms the uploaded file, rather than accepting any
        // pre-existing submission as evidence that this upload succeeded.
        setUploadSuccessMessage(
          fileList.length === 1
            ? t('upload.file_submitted', { filename: fileList[0].name })
            : t("{p0} Dateien erfolgreich eingereicht.", { p0: fileList.length })
        );
        setTimeout(() => setUploadSuccessMessage(null), 4000);
      }
    } catch (err: any) {
      alert(t("Fehler beim Hochladen der Abgabe: {p0}", { p0: err.message }));
    } finally {
      setIsUploading(false);
    }
  };

  const handleUploadStudentFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await uploadStudentFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleDragOverSubmission = (e: React.DragEvent<HTMLDivElement>) => {
    if (detail?.is_ended || canCreateTeam || isUploading) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingFile) {
      setIsDraggingFile(true);
    }
  };

  const handleDragLeaveSubmission = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingFile(false);
    }
  };

  const handleDropSubmission = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    if (detail?.is_ended || canCreateTeam || isUploading) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await uploadStudentFiles(e.dataTransfer.files);
    }
  };

  const [deletingDeliveredId, setDeletingDeliveredId] = useState<string | null>(null);

  const handleDeleteStudentFile = async (deliveredId: string, filename: string) => {
    if (!window.confirm(t("Möchtest du die Datei \"{p0}\" wirklich löschen?", { p0: filename }))) {
      return;
    }

    setDeletingDeliveredId(deliveredId);
    try {
      const updated = await api.deleteStudentAssignmentFile(exerciseRefId, assId, deliveredId);
      setDetail(updated);
      cache.setCachedStudentAssignment(exerciseRefId, assId, updated);
      setUploadSuccessMessage(t("\"{p0}\" erfolgreich gelöscht.", { p0: filename }));
      setTimeout(() => setUploadSuccessMessage(null), 4000);
    } catch (err: any) {
      alert(t("Fehler beim Löschen der Abgabe: {p0}", { p0: err.message }));
    } finally {
      setDeletingDeliveredId(null);
    }
  };

  useNavigationGuard({
    id: `student-assignment-${assId}`,
    isPending: () => isUploading || isDeletingTeam || deletingDeliveredId !== null,
    message: () => t("Ein Vorgang oder Upload wird gerade ausgeführt. Wenn Sie die Seite jetzt verlassen, wird er möglicherweise abgebrochen. Möchten Sie wirklich fortfahren?"),
  });

  const handleSafeClose = () => {
    if (isUploading || isDeletingTeam || deletingDeliveredId !== null) {
      if (!window.confirm(t("Ein Upload wird gerade ausgeführt. Möchten Sie wirklich abbrechen?"))) {
        return;
      }
    }
    onClose();
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSafeClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSafeClose]);

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
            setErrorMessage(err.message || t("Übungsdetails konnten nicht geladen werden."));
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
          handleSafeClose();
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
              <p className="text-xs text-slate-400 dark:text-slate-500">{t("Übungsblatt & Einreichung")}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSafeClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
            title={t("Schließen (Esc)")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading && !detail ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-600" />
              <p className="text-xs font-semibold">{t("Lade Details zur Aufgabe...")}</p>
            </div>
          ) : errorMessage ? (
            <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/30 p-6 text-center space-y-2">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400 mx-auto" />
              <h3 className="text-sm font-bold text-red-900 dark:text-red-200">{t("Fehler beim Laden")}</h3>
              <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition"
              >
                {t("Schließen")}
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
                      {t("Terminplan & Fristen")}
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
                      {assignmentStatusText(detail.time_remaining)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-indigo-100/70 dark:border-indigo-900/50">
                  {detail.start_time && (
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <Clock className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                      <span>
                        <strong className="text-slate-800 dark:text-slate-100">{t("Start:")}</strong> {detail.start_time}
                      </span>
                    </div>
                  )}
                  {detail.ended_on && (
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <Clock className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
                      <span>
                        <strong className="text-slate-800 dark:text-slate-100">{t("Abgabefrist:")}</strong> {assignmentStatusText(detail.ended_on)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Instructions Panel */}
              {detail.instructions && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {t("Arbeitsanweisung")}
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
                    <span>{t("Aufgaben-Materialien & Vorlagen")}</span>
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

              {/* Team Management & Gruppenmitglieder */}
              {isTeamUpload && <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-3.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {t("Team & Gruppenmitglieder")}
                    </h3>
                    {hasTeam && (
                      <span className="rounded-full bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800">
                        {resolvedTeamMembers.length}{' '}
                        {resolvedTeamMembers.length === 1 ? t("Mitglied") : t("Mitglieder")}
                      </span>
                    )}
                  </div>

                  {/* Team Action Buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {canCreateTeam && (
                      <button
                        type="button"
                        onClick={handleCreateTeam}
                        disabled={isCreatingTeam}
                        className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-xs font-bold transition shadow-2xs cursor-pointer disabled:opacity-60"
                      >
                        {isCreatingTeam ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlusCircle className="h-3.5 w-3.5" />
                        )}
                        <span>{isCreatingTeam ? t("Wird erstellt...") : t("Team erstellen")}</span>
                      </button>
                    )}

                    {hasTeam && !detail.is_ended && (
                      <>
                        <button
                          type="button"
                          onClick={handleToggleAddMemberPanel}
                          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer border ${
                            isAddMemberOpen
                              ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                              : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60'
                          }`}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <span>
                            {isAddMemberOpen ? t("Suche schließen") : t("Mitglieder hinzufügen")}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={handleDeleteTeam}
                          disabled={isDeletingTeam}
                          className="flex items-center gap-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 px-3 py-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition border border-rose-200 dark:border-rose-800/80 cursor-pointer disabled:opacity-60"
                          title={t("Team vollständig auflösen")}
                        >
                          {isDeletingTeam ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {isDeletingTeam
                              ? resolvedTeamMembers.length > 1
                                ? t("Entferne Mitglieder & löse auf...")
                                : t("Wird aufgelöst...")
                              : t("Team auflösen")}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Team Feedback Banner */}
                {teamFeedbackMessage && (
                  <div
                    className={`p-2.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 animate-in fade-in ${
                      teamFeedbackMessage.type === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {teamFeedbackMessage.type === 'success' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
                      )}
                      <span>{teamFeedbackMessage.text}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTeamFeedbackMessage(null)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Current Team Members List */}
                {resolvedTeamMembers.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {resolvedTeamMembers.map((member, idx) => {
                      const isRemoving =
                        Boolean(member.user_id) && removingMemberId === member.user_id;
                      const canRemoveThisMember =
                        !detail.is_ended &&
                        Boolean(member.user_id) &&
                        resolvedTeamMembers.length > 1 &&
                        !member.is_self;

                      return (
                        <div
                          key={member.user_id || member.login || idx}
                          className="flex items-center justify-between rounded-xl border border-indigo-100 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/30 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 font-bold text-[11px] shrink-0">
                              {(member.name || member.login || 'T')
                                .replace(/^\[/, '')
                                .charAt(0)
                                .toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                                  {member.name || member.login}
                                </span>
                                {member.is_self && (
                                  <span className="rounded-md bg-indigo-600/10 dark:bg-indigo-400/15 px-1.5 py-0.2 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 shrink-0">
                                    {t("Du")}
                                  </span>
                                )}
                              </div>
                              {member.login && member.name && (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono block truncate">
                                  [{member.login}]
                                </span>
                              )}
                            </div>
                          </div>

                          {canRemoveThisMember && (
                            <button
                              type="button"
                              onClick={() => handleRemoveTeamMember(member)}
                              disabled={isRemoving || isDeletingTeam}
                              className="flex items-center gap-1 rounded-lg bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-900/60 px-2 py-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition shrink-0 cursor-pointer disabled:opacity-50"
                              title={t("Aus dem Team entfernen")}
                            >
                              {isRemoving ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <UserMinus className="h-3 w-3" />
                              )}
                              <span>{t("Entfernen")}</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {detail.team_status_text || t("Noch keinem Team zugeordnet.")}
                      </p>
                      {canCreateTeam && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">
                          {t("Erstelle ein Team, um gemeinsam mit anderen Kursmitgliedern abzugeben.")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Searchable Course Participant Picker */}
                {isAddMemberOpen && hasTeam && !detail.is_ended && (
                  <div className="mt-3 rounded-2xl border border-indigo-200/80 dark:border-indigo-900/70 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3 animate-in fade-in duration-150">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                          {t("Kursmitglieder suchen & zum Team hinzufügen")}
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t("Wähle Studierende aus dem aktuellen Kurs aus oder gib ihren ILIAS-Benutzernamen ein.")}
                        </p>
                      </div>
                      {selectedCandidateIds.size > 0 && (
                        <button
                          type="button"
                          onClick={handleAddSelectedCandidates}
                          disabled={isAddingMembers}
                          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-xs font-bold transition shadow-2xs cursor-pointer disabled:opacity-60 shrink-0"
                        >
                          {isAddingMembers ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <UserPlus className="h-3.5 w-3.5" />
                          )}
                          <span>{t("Ausgewählte hinzufügen (")}{selectedCandidateIds.size})</span>
                        </button>
                      )}
                    </div>

                    {/* Search Input */}
                    <div className="relative">
                      <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="search"
                        value={candidateSearchQuery}
                        onChange={(e) => setCandidateSearchQuery(e.target.value)}
                        placeholder={t("Nach Vorname, Nachname oder ILIAS-Login suchen...")}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
                      />
                    </div>

                    {/* Candidates List */}
                    {isLoadingCandidates ? (
                      <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500 dark:text-slate-400">
                        <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                        <span>{t("Lade Kursteilnehmer aus ILIAS...")}</span>
                      </div>
                    ) : filteredCandidates.length > 0 ? (
                      <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredCandidates.map((candidate) => {
                          const isAlreadyMember =
                            existingMemberUserIds.has(candidate.user_id) ||
                            (Boolean(candidate.login) &&
                              existingMemberLogins.has(candidate.login.toLowerCase()));
                          const isSelected = selectedCandidateIds.has(candidate.user_id);
                          const isAddingThis = addingSingleUserId === candidate.user_id;

                          return (
                            <div
                              key={candidate.user_id}
                              onClick={() => {
                                if (!isAlreadyMember && !isAddingThis) {
                                  toggleCandidateSelection(candidate.user_id);
                                }
                              }}
                              className={`flex items-center justify-between px-3 py-2 text-xs transition ${
                                isAlreadyMember
                                  ? 'bg-slate-50/80 dark:bg-slate-800/40 opacity-75'
                                  : isSelected
                                  ? 'bg-indigo-50/70 dark:bg-indigo-950/50 cursor-pointer'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected || isAlreadyMember}
                                  disabled={isAlreadyMember || isAddingThis}
                                  onChange={() => toggleCandidateSelection(candidate.user_id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-default"
                                />
                                <div className="min-w-0">
                                  <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                                    {candidate.full_name}
                                  </span>
                                  {candidate.login && (
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono block truncate">
                                      [{candidate.login}]
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="shrink-0">
                                {isAlreadyMember ? (
                                  <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                    <Check className="h-3 w-3" />
                                    <span>{t("Im Team")}</span>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAddSingleCandidate(candidate);
                                    }}
                                    disabled={isAddingThis || isAddingMembers}
                                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-600 hover:text-white text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-2.5 py-1 text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                                  >
                                    {isAddingThis ? (
                                      <RefreshCw className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <UserPlus className="h-3 w-3" />
                                    )}
                                    <span>{t("Hinzufügen")}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-4 text-center text-xs text-slate-400 dark:text-slate-500">
                        {t("Keine passenden Kursteilnehmer für „")}{candidateSearchQuery}{t("“ gefunden.")}
                      </div>
                    )}

                    {/* Direct Login Input Fallback */}
                    <form
                      onSubmit={handleAddManualLogin}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-700/60"
                    >
                      <input
                        type="text"
                        value={manualUserLogin}
                        onChange={(e) => setManualUserLogin(e.target.value)}
                        placeholder={t("Oder direkt per ILIAS-Login hinzufügen (z. B. m.mustermann1)...")}
                        className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                      <button
                        type="submit"
                        disabled={!manualUserLogin.trim() || isAddingMembers}
                        className="rounded-xl bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 text-white px-3 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {t("Per Login hinzufügen")}
                      </button>
                    </form>
                  </div>
                )}
              </div>}
              {/* Submission Status & Uploaded Files */}
              <div
                onDragOver={handleDragOverSubmission}
                onDragLeave={handleDragLeaveSubmission}
                onDrop={handleDropSubmission}
                className={`rounded-2xl border p-5 shadow-2xs space-y-3 transition-all ${
                  isDraggingFile
                    ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {t("Eigene Einreichung")}
                    </h3>
                    {detail.submitted_files && detail.submitted_files.length > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        <span>{t("Abgegeben")}</span>
                      </span>
                    ) : detail.submission_status === 'late' ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
                        <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                        <span>{t("Verspätet eingereicht")}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200/80 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                        <Clock className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                        <span>
                          {detail.submission_status && detail.submission_status !== 'not_submitted'
                            ? detail.submission_status
                            : t("Noch keine Abgabe")}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Upload Submission Button */}
                  {!detail.is_ended && !canCreateTeam && (
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
                        <span>{isUploading ? t("Wird hochgeladen...") : t("Abgabe einreichen")}</span>
                      </label>
                      <input
                        id={`student-upload-${assId}`}
                        type="file"
                        multiple
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
                  <div className="space-y-3">
                    {detail.last_submission && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                        {t("Letzte Einreichung:")} {detail.last_submission}
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
                                title={t("Abgabe direkt herunterladen")}
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>{t("Download")}</span>
                              </a>
                              {subFile.delivered_id && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStudentFile(subFile.delivered_id!, subFile.filename)}
                                  disabled={deletingDeliveredId === subFile.delivered_id}
                                  className="flex items-center justify-center rounded-lg bg-white dark:bg-slate-700 border border-rose-200 dark:border-rose-900/60 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:border-rose-300 transition shadow-2xs shrink-0 cursor-pointer disabled:opacity-50"
                                  title={t("Abgabe löschen")}
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

                    {!detail.is_ended && !canCreateTeam && (
                      <label
                        htmlFor={`student-upload-${assId}`}
                        className={`flex items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-xs transition cursor-pointer ${
                          isDraggingFile
                            ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 text-slate-500 dark:text-slate-400 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 hover:text-indigo-600 dark:hover:text-indigo-300'
                        }`}
                      >
                        <Upload className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {isDraggingFile
                            ? t("Datei hier loslassen zum Hochladen...")
                            : t("Weitere Datei per Drag & Drop hierher ziehen oder klicken zum Hinzufügen")}
                        </span>
                      </label>
                    )}
                  </div>
                ) : !detail.is_ended && !canCreateTeam ? (
                  <label
                    htmlFor={`student-upload-${assId}`}
                    className={`group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition cursor-pointer ${
                      isDraggingFile
                        ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/40'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20'
                    }`}
                  >
                    <div
                      className={`mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl transition ${
                        isDraggingFile
                          ? 'bg-indigo-600 text-white scale-105 shadow-xs'
                          : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/60'
                      }`}
                    >
                      {isUploading ? (
                        <RefreshCw className="h-5 w-5 animate-spin" />
                      ) : (
                        <Upload className="h-5 w-5" />
                      )}
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {isUploading
                        ? t("Abgabe wird zu ILIAS hochgeladen...")
                        : isDraggingFile
                        ? t("Datei jetzt loslassen, um sie einzureichen")
                        : t("Datei per Drag & Drop hierher ziehen oder klicken")}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      {t("Noch keine Dateien eingereicht • Direkter Upload nach ILIAS")}
                    </p>
                  </label>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 p-6 text-center space-y-1.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
                      {canCreateTeam ? <Users className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                    </div>
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {canCreateTeam
                        ? t("Bitte erstelle zuerst ein Team, um eine Datei einzureichen")
                        : t("Keine Dateien für diese Aufgabe eingereicht")}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      {canCreateTeam
                        ? t("Für diese Gruppenaufgabe ist vor dem Datei-Upload ein Team erforderlich.")
                        : t("Die Bearbeitungsfrist für diese Aufgabe ist abgelaufen.")}
                    </p>
                  </div>
                )}
              </div>

              {/* Tutor Evaluation Feedback Card */}
              <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/30 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                      {t("Bewertung durch Tutor")}
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
                          <span>{t("Bestanden")}</span>
                        </>
                      ) : detail.passed_status === 'failed' ? (
                        <>
                          <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                          <span>{t("Nicht bestanden")}</span>
                        </>
                      ) : (
                        <span>{t("Nicht bewertet")}</span>
                      )}
                    </span>
                  )}
                </div>

                {detail.mark && (
                  <p className="text-xs text-amber-900 dark:text-amber-200 font-semibold">
                    {t("Note / Punkte:")} <span className="font-mono">{detail.mark}</span>
                  </p>
                )}

                {detail.evaluation_statement ? (
                  <div className="rounded-xl bg-white dark:bg-slate-800 p-3.5 border border-amber-200/80 dark:border-amber-900/60 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed shadow-2xs">
                    {detail.evaluation_statement}
                  </div>
                ) : (
                  <p className="text-xs text-amber-800/70 dark:text-amber-400/70 italic">
                    {t("Noch kein Feedback-Kommentar hinterlegt.")}
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-6 py-3.5 bg-slate-50/70 dark:bg-slate-800/80 shrink-0">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{t("Drücke Esc zum Schließen")}</span>
          <button
            type="button"
            onClick={handleSafeClose}
            className="rounded-xl bg-slate-900 dark:bg-slate-800 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {t("Schließen")}
          </button>
        </div>
      </div>
    </div>
  );
};
