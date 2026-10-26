import { t, useLanguage, assignmentStatusText } from '../lib/i18n';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Layers,
  FileText,
  Clock,
  Calendar,
  Users,
  CheckCircle2,
  AlertCircle,
  Search,
  ExternalLink,
  Info,
  Award,
  Sparkles,
  Download,
  Mail,
  Save,
  RefreshCw,
  PlusCircle,
  Check,
  Zap,
  User,
  Shield,
  Upload,
  Trash2,
  MoreVertical,
  Edit3,
} from 'lucide-react';
import {
  AssignmentItem,
  FeedbackFileItem,
  BreadcrumbItem,
  ExerciseInfoResponse,
  ExerciseOverviewResponse,
  ExerciseSubmissionsResponse,
  ExerciseTab,
  SubmissionItem,
  TAQuickFilter,
} from '../types';
import { api } from '../lib/api';
import { navigationGuard, useNavigationGuard } from '../lib/navigationGuard';
import { cache, EXERCISE_OVERVIEW_PREFIX, EXERCISE_SUBMISSIONS_PREFIX } from '../lib/cache';
import { CompactBreadcrumbs } from './CompactBreadcrumbs';
import { StudentAssignmentModal } from './StudentAssignmentModal';
import { SubmissionDetailModal } from './SubmissionDetailModal';
import { TAFilterSettingsModal } from './TAFilterSettingsModal';
import { NotificationToast, ChangeNotification } from './NotificationToast';
import { GradingFeedbackBar, GradeSavedFeedback } from './GradingFeedbackBar';
import { TAExerciseManagementView, AssignmentFeedback } from './TAExerciseManagementView';
import { TAExerciseEditorView } from './TAExerciseEditorView';

interface ExerciseViewProps {
  exerciseRefId: string;
  courseNickname: string;
  courseRefId: string;
  courseBreadcrumbs?: BreadcrumbItem[];
  activeTabProp?: ExerciseTab | null;
  onTabChange?: (tab: ExerciseTab) => void;
  onBack: () => void;
  onNavigateHome: () => void;
  onNavigateCourse: (courseRefId: string) => void;
  onNavigateFolder?: (folderRefId: string) => void;
  onNavigateRepository: (repoRefId: string) => void;
  onNavigateSemester?: (semester: string) => void;
  onNotifyChange?: (notifications: ChangeNotification[]) => void;
}

export const ExerciseView: React.FC<ExerciseViewProps> = ({
  exerciseRefId,
  courseNickname,
  courseRefId,
  courseBreadcrumbs,
  activeTabProp,
  onTabChange,
  onBack,
  onNavigateHome,
  onNavigateCourse,
  onNavigateFolder,
  onNavigateRepository,
  onNavigateSemester,
  onNotifyChange,
}) => {
  const language = useLanguage();

  // Top Navigation Tab: 'assignments' | 'info' | 'ta_grading'
  const [activeTab, setActiveTab] = useState<'assignments' | 'info' | 'ta_grading'>(() => {
    if (activeTabProp === 'info') return 'info';
    if (activeTabProp === 'submissions') return 'ta_grading';
    return 'assignments';
  });
  const [taManagementMode, setTaManagementMode] = useState<'none' | 'list' | 'editor'>(() => {
    if (activeTabProp === 'manage') return 'list';
    if (activeTabProp === 'manage-edit') return 'editor';
    return 'none';
  });

  // Sync state when activeTabProp changes (from URL / popstate / Mouse 4/5)
  useEffect(() => {
    if (!activeTabProp || activeTabProp === 'assignments') {
      setActiveTab('assignments');
      setTaManagementMode('none');
    } else if (activeTabProp === 'info') {
      setActiveTab('info');
      setTaManagementMode('none');
    } else if (activeTabProp === 'submissions') {
      setActiveTab('ta_grading');
      setTaManagementMode('none');
    } else if (activeTabProp === 'manage') {
      setActiveTab('assignments');
      setTaManagementMode('list');
    } else if (activeTabProp === 'manage-edit') {
      setActiveTab('assignments');
      setTaManagementMode('editor');
    }
  }, [activeTabProp]);

  const switchTab = useCallback(
    (tab: ExerciseTab) => {
      if (tab !== activeTabProp && !navigationGuard.confirmNavigation()) {
        return;
      }
      if (tab === 'assignments') {
        setActiveTab('assignments');
        setTaManagementMode('none');
      } else if (tab === 'info') {
        setActiveTab('info');
        setTaManagementMode('none');
      } else if (tab === 'submissions') {
        setActiveTab('ta_grading');
        setTaManagementMode('none');
      } else if (tab === 'manage') {
        setActiveTab('assignments');
        setTaManagementMode('list');
      } else if (tab === 'manage-edit') {
        setActiveTab('assignments');
        setTaManagementMode('editor');
      }
      if (onTabChange) {
        onTabChange(tab);
      }
    },
    [onTabChange]
  );
  const [editingTaAssId, setEditingTaAssId] = useState<string | null>(null);
  const [editingTaTypeId, setEditingTaTypeId] = useState<number>(1);
  const [assignmentFeedback, setAssignmentFeedback] = useState<AssignmentFeedback | null>(null);

  // Overview data (Cached with SWR)
  const [overviewData, setOverviewData] = useState<ExerciseOverviewResponse | null>(() => {
    return cache.getCachedExerciseOverview(exerciseRefId);
  });
  const [isLoadingOverview, setIsLoadingOverview] = useState<boolean>(() => {
    return !cache.getCachedExerciseOverview(exerciseRefId);
  });
  const [isRevalidatingOverview, setIsRevalidatingOverview] = useState<boolean>(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Student Assignment Modal
  const [activeModalAssignment, setActiveModalAssignment] = useState<{ assId: string; title: string } | null>(null);

  // Submission Detail Modal (TA view "i" button)
  const [detailModalSubmission, setDetailModalSubmission] = useState<SubmissionItem | null>(null);

  // Assignment List Filters
  const [assignmentFilterMode, setAssignmentFilterMode] = useState<'all' | 'ongoing' | 'future' | 'past'>('all');
  const [assignmentSearchQuery, setAssignmentSearchQuery] = useState('');

  // Info Tab state (Cached)
  const [infoData, setInfoData] = useState<ExerciseInfoResponse | null>(() => {
    return cache.getCachedExerciseInfo(exerciseRefId);
  });
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);

  // TA Grading Tab state (Cached per exerciseRefId + assId)
  const [selectedTaAssId, setSelectedTaAssId] = useState<string | null>(() => {
    const cachedOverview = cache.getCachedExerciseOverview(exerciseRefId);
    if (cachedOverview?.assignments && cachedOverview.assignments.length > 0) {
      const ongoing = cachedOverview.assignments.find((a) => a.is_ongoing) || cachedOverview.assignments[0];
      return ongoing.ass_id || null;
    }
    return null;
  });

  const [taSubmissionsData, setTaSubmissionsData] = useState<ExerciseSubmissionsResponse | null>(() => {
    const cachedOverview = cache.getCachedExerciseOverview(exerciseRefId);
    let initialAssId: string | undefined = undefined;
    if (cachedOverview?.assignments && cachedOverview.assignments.length > 0) {
      const ongoing = cachedOverview.assignments.find((a) => a.is_ongoing) || cachedOverview.assignments[0];
      initialAssId = ongoing.ass_id || undefined;
    }
    return cache.getCachedExerciseSubmissions(exerciseRefId, initialAssId);
  });
  const [isLoadingTaSubmissions, setIsLoadingTaSubmissions] = useState(false);
  const [taSearchQuery, setTaSearchQuery] = useState('');
  // Submission requirement filter (Radio: 'all' | 'submitted' | 'not_submitted')
  const [taSubmissionFilter, setTaSubmissionFilter] = useState<'all' | 'submitted' | 'not_submitted'>(() => {
    return (localStorage.getItem('ilias_ta_filter_submission') as 'all' | 'submitted' | 'not_submitted') || 'all';
  });

  // Grade status multi-select filter (e.g. ['not_graded'], ['passed'], ['failed'], or [] for all)
  const [taGradeFilter, setTaGradeFilter] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('ilias_ta_filter_grade');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Quick Filters collection (customizable via dialog)
  const [quickFilters, setQuickFilters] = useState<TAQuickFilter[]>(() => {
    try {
      const saved = localStorage.getItem('ilias_ta_quick_filters');
      return saved
        ? JSON.parse(saved)
        : [
            {
              id: 'to_grade',
              get label() { return t("Zu bewerten"); },
              color: 'indigo',
              gradeStatus: ['not_graded'],
              submissionStatus: 'submitted',
            },
          ];
    } catch {
      return [
        {
          id: 'to_grade',
          get label() { return t("Zu bewerten"); },
          color: 'indigo',
          gradeStatus: ['not_graded'],
          submissionStatus: 'submitted',
        },
      ];
    }
  });

  // Settings modal open state
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  const handleSetSubmissionFilter = (val: 'all' | 'submitted' | 'not_submitted') => {
    setTaSubmissionFilter(val);
    localStorage.setItem('ilias_ta_filter_submission', val);
  };

  const handleToggleGradeFilter = (gradeVal: string) => {
    setTaGradeFilter((prev) => {
      const next = prev.includes(gradeVal) ? prev.filter((g) => g !== gradeVal) : [...prev, gradeVal];
      localStorage.setItem('ilias_ta_filter_grade', JSON.stringify(next));
      return next;
    });
  };

  const handleApplyQuickFilter = (qf: TAQuickFilter) => {
    const isCurrentlyActive =
      taSubmissionFilter === qf.submissionStatus &&
      taGradeFilter.length === qf.gradeStatus.length &&
      taGradeFilter.every((g) => qf.gradeStatus.includes(g));

    if (isCurrentlyActive) {
      handleSetSubmissionFilter('all');
      setTaGradeFilter([]);
      localStorage.setItem('ilias_ta_filter_grade', JSON.stringify([]));
    } else {
      handleSetSubmissionFilter(qf.submissionStatus);
      setTaGradeFilter(qf.gradeStatus);
      localStorage.setItem('ilias_ta_filter_grade', JSON.stringify(qf.gradeStatus));
    }
  };

  const handleAddQuickFilter = (newQf: Omit<TAQuickFilter, 'id'>) => {
    const item: TAQuickFilter = {
      ...newQf,
      id: `qf_${Date.now()}`,
    };
    setQuickFilters((prev) => {
      const updated = [...prev, item];
      localStorage.setItem('ilias_ta_quick_filters', JSON.stringify(updated));
      return updated;
    });
  };

  const handleDeleteQuickFilter = (id: string) => {
    setQuickFilters((prev) => {
      const updated = prev.filter((q) => q.id !== id);
      localStorage.setItem('ilias_ta_quick_filters', JSON.stringify(updated));
      return updated;
    });
  };

  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [savedSuccessId, setSavedSuccessId] = useState<string | null>(null);
  const [gradingFeedback, setGradingFeedback] = useState<GradeSavedFeedback | null>(null);
  const [localEdits, setLocalEdits] = useState<
    Record<
      string,
      {
        status: string;
        mark: string;
        feedback: string;
        notice: string;
        isDirty: boolean;
      }
    >
  >(() => {
    const cachedOverview = cache.getCachedExerciseOverview(exerciseRefId);
    let initialAssId: string | undefined = undefined;
    if (cachedOverview?.assignments && cachedOverview.assignments.length > 0) {
      const ongoing = cachedOverview.assignments.find((a) => a.is_ongoing) || cachedOverview.assignments[0];
      initialAssId = ongoing.ass_id || undefined;
    }
    const cachedSub = cache.getCachedExerciseSubmissions(exerciseRefId, initialAssId);
    const initialEdits: Record<string, any> = {};
    if (cachedSub?.submissions) {
      for (const s of cachedSub.submissions) {
        initialEdits[s.member_id] = {
          status: s.passed_status || 'not_graded',
          mark: s.mark || '',
          feedback: s.feedback || '',
          notice: s.notice || '',
          isDirty: false,
        };
      }
    }
    return initialEdits;
  });

  // Caching & In-flight request protection
  const submissionsCacheRef = useRef<Record<string, ExerciseSubmissionsResponse>>({});
  const taRequestSeq = useRef<number>(0);
  const lastRevalidatedAssKeyRef = useRef<string | null>(null);
  const [localNotifications, setLocalNotifications] = useState<ChangeNotification[]>([]);
  const [uploadingMemberId, setUploadingMemberId] = useState<string | null>(null);
  const [draggingMemberId, setDraggingMemberId] = useState<string | null>(null);
  const [fileUploadSuccessId, setFileUploadSuccessId] = useState<string | null>(null);


  // Course-specific TA Grading preferences (saved per courseRefId in localStorage)
  const [showMarksInOverview, setShowMarksInOverview] = useState<boolean>(() => {
    return localStorage.getItem(`ilias_ta_show_marks_${courseRefId}`) === 'true';
  });

  const toggleShowMarksInOverview = () => {
    const next = !showMarksInOverview;
    setShowMarksInOverview(next);
    localStorage.setItem(`ilias_ta_show_marks_${courseRefId}`, String(next));
  };

  const [evalModeInOverview, setEvalModeInOverview] = useState<'statement' | 'file' | 'email'>(() => {
    const saved = localStorage.getItem(`ilias_ta_eval_mode_${courseRefId}`);
    return (saved as 'statement' | 'file' | 'email') || 'statement';
  });

  const handleSetEvalMode = (mode: 'statement' | 'file' | 'email') => {
    setEvalModeInOverview(mode);
    localStorage.setItem(`ilias_ta_eval_mode_${courseRefId}`, mode);
  };

  // Sub-tab selection inside each card ('feedback' vs 'notice')
  const [rowTabState, setRowTabState] = useState<Record<string, 'feedback' | 'notice'>>({});

  // Feedback files per member in overview
  const [rowFeedbackFiles, setRowFeedbackFiles] = useState<Record<string, FeedbackFileItem[]>>({});
  const [loadingFeedbackFilesFor, setLoadingFeedbackFilesFor] = useState<Record<string, boolean>>({});
  const [deletingFeedbackFileId, setDeletingFeedbackFileId] = useState<string | null>(null);
  const fetchedFeedbackMembersRef = useRef<Set<string>>(new Set());

  // Check for unsaved grades or feedback notes
  const hasDirtyGrades = useMemo(
    () => Object.values(localEdits).some((e) => e.isDirty),
    [localEdits]
  );

  useNavigationGuard({
    id: `exercise-grading-${exerciseRefId}`,
    isDirty: () => hasDirtyGrades,
    isPending: () => uploadingMemberId !== null || deletingFeedbackFileId !== null,
    message: () => t("Sie haben ungespeicherte Bewertungen oder Notizen. Möchten Sie die Seite wirklich verlassen?"),
  });

  // Sorting state for TA grading submissions
  const [taSortField, setTaSortField] = useState<'time' | 'name' | 'status' | 'mark' | 'ilias'>('time');
  const [taSortOrder, setTaSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleSortToggle = (field: 'time' | 'name' | 'status' | 'mark' | 'ilias') => {
    if (taSortField === field) {
      setTaSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setTaSortField(field);
      setTaSortOrder(field === 'time' ? 'desc' : 'asc');
    }
  };

  const sortFieldLabel = useMemo(() => {
    switch (taSortField) {
      case 'time':
        return t("Abgabezeit");
      case 'ilias':
        return t('ILIAS-Standardsortierung');
      case 'name':
        return t("Name");
      case 'status':
        return t("Status");
      case 'mark':
        return t('Note / Punkte');
      default:
        return t("Abgabezeit");
    }
  }, [taSortField, language]);

  const [teamOrder, setTeamOrder] = useState<{
    source: ExerciseSubmissionsResponse;
    names: Record<string, string | null>;
    error: boolean;
  } | null>(null);
  const [teamOrderRetry, setTeamOrderRetry] = useState(0);
  const teamSortNames = teamOrder?.source === taSubmissionsData ? teamOrder?.names : undefined;

  useEffect(() => {
    if (taSortField !== 'ilias' || !taSubmissionsData || isLoadingTaSubmissions) return;
    let cancelled = false;
    const source = taSubmissionsData;
    setTeamOrder(null);
    api.getExerciseSubmissions(exerciseRefId, source.active_assignment_id || selectedTaAssId || undefined, true)
      .then((result) => {
        if (!cancelled) setTeamOrder({
          source,
          names: Object.fromEntries(result.submissions.map((s) => [s.member_id, s.feedback_recipient_surname || null])),
          error: false,
        });
      })
      .catch(() => {
        if (!cancelled) setTeamOrder({ source, names: {}, error: true });
      });
    return () => { cancelled = true; };
  }, [taSortField, taSubmissionsData, isLoadingTaSubmissions, exerciseRefId, selectedTaAssId, teamOrderRetry]);

  // Close any open modal on Mouse 4 (Back)
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        if (activeModalAssignment) {
          e.preventDefault();
          e.stopPropagation();
          setActiveModalAssignment(null);
          return;
        }
        if (detailModalSubmission) {
          e.preventDefault();
          e.stopPropagation();
          setDetailModalSubmission(null);
          return;
        }
        if (isSettingsModalOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsSettingsModalOpen(false);
          return;
        }
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [activeModalAssignment, detailModalSubmission, isSettingsModalOpen]);

  // Process breadcrumbs for CompactBreadcrumbs
  const effectiveBreadcrumbs = useMemo(() => {
    if (overviewData?.breadcrumbs && overviewData.breadcrumbs.length > 0) {
      return overviewData.breadcrumbs.map((b, idx, arr) => {
        if (idx === arr.length - 1 && !b.ref_id) {
          return { ...b, ref_id: exerciseRefId };
        }
        return b;
      });
    }
    const fallback = courseBreadcrumbs ? [...courseBreadcrumbs] : [];
    return [
      ...fallback,
      { title: overviewData?.title || t("Übungsübersicht"), ref_id: exerciseRefId },
    ];
  }, [overviewData?.breadcrumbs, overviewData?.title, exerciseRefId, courseBreadcrumbs]);

  // 1. Load Overview (defaults to mode=all so all 11+ assignments are fetched!)
  const loadOverview = useCallback((forceRefresh = false) => {
    const cached = cache.getCachedExerciseOverview(exerciseRefId);
    if (cached && !overviewData) {
      setOverviewData(cached);
    }
    // ILIAS Saver: If fresh within TTL and not a forced manual refresh, skip revalidation!
    if (cached && !forceRefresh && cache.isIliasSaverFresh(EXERCISE_OVERVIEW_PREFIX + exerciseRefId)) {
      setIsLoadingOverview(false);
      setIsRevalidatingOverview(false);
      return;
    }
    setOverviewData((current) => {
      if (!current) {
        setIsLoadingOverview(true);
      }
      return current;
    });
    setIsRevalidatingOverview(true);
    setOverviewError(null);

    api
      .getExerciseOverview(exerciseRefId, 'all')
      .then((data) => {
        setOverviewData(data);
        cache.setCachedExerciseOverview(exerciseRefId, data);
        setIsLoadingOverview(false);
        setIsRevalidatingOverview(false);

        // Pre-select first assignment for TA if not set
        setSelectedTaAssId((currentAssId) => {
          if (!currentAssId && data.assignments && data.assignments.length > 0) {
            const ongoing = data.assignments.find((a) => a.is_ongoing) || data.assignments[0];
            return ongoing.ass_id || null;
          }
          return currentAssId;
        });
      })
      .catch((err) => {
        setOverviewData((current) => {
          if (!current) {
            setOverviewError(err.message || t("Übersicht konnte nicht geladen werden."));
          }
          return current;
        });
        setIsLoadingOverview(false);
        setIsRevalidatingOverview(false);
      });
  }, [exerciseRefId]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // 2. Load Info tab when switched
  useEffect(() => {
    if (activeTab === 'info') {
      const cached = cache.getCachedExerciseInfo(exerciseRefId);
      if (cached && !infoData) {
        setInfoData(cached);
      }
      if (!cached && !infoData) {
        setIsLoadingInfo(true);
      }
      api
        .getExerciseInfo(exerciseRefId)
        .then((data) => {
          setInfoData(data);
          cache.setCachedExerciseInfo(exerciseRefId, data);
          setIsLoadingInfo(false);
        })
        .catch(() => {
          setIsLoadingInfo(false);
        });
    }
  }, [activeTab, exerciseRefId, infoData]);

  // 3. Load TA Submissions when in ta_grading tab (Cached + Race condition protection)
  const loadTaSubmissions = useCallback(
    (assId?: string, isInitialLoad = false, forceRefresh = false) => {
      const cacheKey = assId || 'default';
      // 1. Instant serve from memory ref cache or localStorage cache (0ms)
      let cached: ExerciseSubmissionsResponse | null = submissionsCacheRef.current[cacheKey] || null;
      if (!cached) {
        cached = cache.getCachedExerciseSubmissions(exerciseRefId, assId);
        if (cached) {
          submissionsCacheRef.current[cacheKey] = cached;
        }
      }

      if (cached) {
        setTaSubmissionsData(cached);
        // Seed local edits for any submissions not yet edited
        setLocalEdits((prev) => {
          const updated = { ...prev };
          for (const s of cached!.submissions) {
            if (!updated[s.member_id]) {
              updated[s.member_id] = {
                status: s.passed_status || 'not_graded',
                mark: s.mark || '',
                feedback: s.feedback || '',
                notice: s.notice || '',
                isDirty: false,
              };
            }
          }
          return updated;
        });
      }

      const storageKey = `${EXERCISE_SUBMISSIONS_PREFIX}${exerciseRefId}_${assId || 'default'}`;
      if (cached && !forceRefresh && cache.isIliasSaverFresh(storageKey)) {
        setIsLoadingTaSubmissions(false);
        return;
      }

      // 2. Network revalidation with sequence ID to prevent out-of-order responses
      const reqId = ++taRequestSeq.current;
      setIsLoadingTaSubmissions(true);

      api
        .getExerciseSubmissions(exerciseRefId, assId)
        .then((fresh) => {
          // Discard if a newer request was started
          if (reqId !== taRequestSeq.current) return;

          // Change detection: compare cached vs fresh to notify user
          if (cached) {
            const detected: ChangeNotification[] = [];
            const cachedMap = new Map(cached.submissions.map((s) => [s.member_id, s]));

            for (const freshSub of fresh.submissions) {
              const oldSub = cachedMap.get(freshSub.member_id);
              const freshHasSubmitted = Boolean(
                freshSub.download_url ||
                (freshSub.files && freshSub.files.length > 0) ||
                ['submitted', 'late'].includes(freshSub.submission_status)
              );
              const oldHasSubmitted = Boolean(
                oldSub?.download_url ||
                (oldSub?.files && oldSub.files.length > 0) ||
                ['submitted', 'late'].includes(oldSub?.submission_status || '')
              );

              if (freshHasSubmitted && !oldHasSubmitted) {
                detected.push({
                  id: `new-sub-${freshSub.member_id}-${Date.now()}`,
                  type: 'file',
                  title: freshSub.student_name,
                  subtitle: t("Neue Abgabe eingereicht"),
                });
              } else if (
                freshSub.submission_time &&
                oldSub?.submission_time &&
                freshSub.submission_time !== oldSub.submission_time
              ) {
                detected.push({
                  id: `updated-sub-${freshSub.member_id}-${Date.now()}`,
                  type: 'file',
                  title: freshSub.student_name,
                  subtitle: t("Abgabe aktualisiert ({p0})", { p0: freshSub.submission_time }),
                });
              }
            }

            if (detected.length > 0) {
              if (onNotifyChange) {
                onNotifyChange(detected);
              }
              setLocalNotifications((prev) => [...prev, ...detected]);
            }
          }

          // Cache the fresh data in BOTH memory and persistent localStorage
          submissionsCacheRef.current[cacheKey] = fresh;
          cache.setCachedExerciseSubmissions(exerciseRefId, assId, fresh);
          setTaSubmissionsData(fresh);

          // ONLY set selectedTaAssId if it was not already chosen by the user!
          if (isInitialLoad && fresh.active_assignment_id) {
            setSelectedTaAssId(fresh.active_assignment_id);
          }

          // Seed/merge local edits: preserve user's uncommitted edits (isDirty), update pristine ones
          setLocalEdits((prev) => {
            const updated = { ...prev };
            for (const s of fresh.submissions) {
              if (!updated[s.member_id] || !updated[s.member_id].isDirty) {
                updated[s.member_id] = {
                  status: s.passed_status || 'not_graded',
                  mark: s.mark || '',
                  feedback: s.feedback || '',
                  notice: s.notice || '',
                  isDirty: false,
                };
              }
            }
            return updated;
          });
        })
        .catch((err) => {
          if (reqId === taRequestSeq.current) {
            console.error('Error loading submissions', err);
          }
        })
        .finally(() => {
          if (reqId === taRequestSeq.current) {
            setIsLoadingTaSubmissions(false);
          }
        });
    },
    [exerciseRefId, onNotifyChange]
  );

  const handleSelectTaAssignment = useCallback(
    (newAssId: string) => {
      if (newAssId !== selectedTaAssId && hasDirtyGrades && !navigationGuard.confirmNavigation()) {
        return;
      }
      setSelectedTaAssId(newAssId);
      const cacheKey = newAssId || 'default';
      let cached: ExerciseSubmissionsResponse | null = submissionsCacheRef.current[cacheKey] || null;
      if (!cached) {
        cached = cache.getCachedExerciseSubmissions(exerciseRefId, newAssId);
        if (cached) {
          submissionsCacheRef.current[cacheKey] = cached;
        }
      }

      if (cached) {
        setTaSubmissionsData(cached);
        setLocalEdits((prev) => {
          const updated = { ...prev };
          for (const s of cached!.submissions) {
            if (!updated[s.member_id]) {
              updated[s.member_id] = {
                status: s.passed_status || 'not_graded',
                mark: s.mark || '',
                feedback: s.feedback || '',
                notice: s.notice || '',
                isDirty: false,
              };
            }
          }
          return updated;
        });
      } else {
        setTaSubmissionsData(null);
      }

      fetchedFeedbackMembersRef.current.clear();
      setRowFeedbackFiles({});
      lastRevalidatedAssKeyRef.current = `${exerciseRefId}_${newAssId}`;
      loadTaSubmissions(newAssId, false);
    },
    [exerciseRefId, loadTaSubmissions]
  );

  const uploadMemberFeedbackFile = async (memberId: string, file: File) => {
    if (!file) return;
    setUploadingMemberId(memberId);
    try {
      const sub = taSubmissionsData?.submissions?.find((s) => s.member_id === memberId);
      const res = await api.uploadFeedbackFile(
        exerciseRefId,
        memberId,
        file,
        selectedTaAssId || undefined,
        sub?.evaluation_by_file_url
      );
      setRowFeedbackFiles((prev) => ({
        ...prev,
        [memberId]: res.files || [],
      }));
      setFileUploadSuccessId(memberId);
      setTimeout(() => setFileUploadSuccessId(null), 3500);
    } catch (err: any) {
      alert(t("Fehler beim Hochladen der Korrekturdatei: {p0}", { p0: err.message }));
    } finally {
      setUploadingMemberId(null);
    }
  };

  const handleDeleteRowFeedbackFile = async (memberId: string, fileId: string, feedbackUrl?: string) => {
    if (!exerciseRefId || deletingFeedbackFileId) return;
    if (!window.confirm(t("Möchten Sie diese Korrekturdatei wirklich löschen?"))) return;

    setDeletingFeedbackFileId(fileId);
    try {
      const res = await api.deleteFeedbackFile(
        exerciseRefId,
        memberId,
        fileId,
        selectedTaAssId || undefined,
        feedbackUrl
      );
      setRowFeedbackFiles((prev) => ({
        ...prev,
        [memberId]: res.files || [],
      }));
    } catch (err: any) {
      alert(err.message || t("Fehler beim Löschen der Korrekturdatei"));
    } finally {
      setDeletingFeedbackFileId(null);
    }
  };

  // Auto-load feedback files in overview when file mode is active
  useEffect(() => {
    if (activeTab === 'ta_grading' && evalModeInOverview === 'file' && taSubmissionsData?.submissions && exerciseRefId) {
      const needed = taSubmissionsData.submissions.filter(
        (s) => s.evaluation_by_file_url && !fetchedFeedbackMembersRef.current.has(s.member_id)
      );
      if (needed.length === 0) return;

      needed.forEach((s) => fetchedFeedbackMembersRef.current.add(s.member_id));

      let isCancelled = false;
      const fetchBatch = async () => {
        const queue = [...needed];
        const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (queue.length > 0 && !isCancelled) {
            const sub = queue.shift();
            if (!sub || !sub.evaluation_by_file_url) continue;
            setLoadingFeedbackFilesFor((prev) => ({ ...prev, [sub.member_id]: true }));
            try {
              const res = await api.getFeedbackFiles(
                exerciseRefId,
                sub.member_id,
                selectedTaAssId || undefined,
                sub.evaluation_by_file_url
              );
              if (!isCancelled) {
                setRowFeedbackFiles((prev) => ({
                  ...prev,
                  [sub.member_id]: res.files || [],
                }));
              }
            } catch {
              if (!isCancelled) {
                setRowFeedbackFiles((prev) => ({
                  ...prev,
                  [sub.member_id]: [],
                }));
              }
            } finally {
              if (!isCancelled) {
                setLoadingFeedbackFilesFor((prev) => ({ ...prev, [sub.member_id]: false }));
              }
            }
          }
        });
        await Promise.all(workers);
      };

      fetchBatch();
      return () => {
        isCancelled = true;
      };
    }
  }, [activeTab, evalModeInOverview, taSubmissionsData?.submissions, exerciseRefId, selectedTaAssId]);

  const handleUploadFeedbackFile = async (
    memberId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadMemberFeedbackFile(memberId, file);
    }
    e.target.value = '';
  };

  useEffect(() => {
    if (activeTab === 'ta_grading' && overviewData?.has_ta_access) {
      const targetAssId = selectedTaAssId || 'default';
      const key = `${exerciseRefId}_${targetAssId}`;
      if (lastRevalidatedAssKeyRef.current !== key) {
        lastRevalidatedAssKeyRef.current = key;
        loadTaSubmissions(selectedTaAssId || undefined, !selectedTaAssId);
      }
    }
  }, [activeTab, overviewData?.has_ta_access, selectedTaAssId, exerciseRefId, loadTaSubmissions]);

  // List of assignments for TA dropdown
  const taAssignmentsList = useMemo(() => {
    if (taSubmissionsData?.available_assignments && taSubmissionsData.available_assignments.length > 0) {
      return taSubmissionsData.available_assignments;
    }
    return overviewData?.assignments || [];
  }, [taSubmissionsData?.available_assignments, overviewData?.assignments]);

  // Filter assignments list
  const filteredAssignments = useMemo(() => {
    if (!overviewData?.assignments) return [];
    let list = overviewData.assignments;

    if (assignmentFilterMode === 'ongoing') {
      list = list.filter((a) => a.is_ongoing);
    } else if (assignmentFilterMode === 'future') {
      list = list.filter((a) => !a.is_ongoing && !a.is_ended);
    } else if (assignmentFilterMode === 'past') {
      list = list.filter((a) => a.is_ended);
    }

    if (assignmentSearchQuery.trim()) {
      const q = assignmentSearchQuery.toLowerCase();
      list = list.filter(
        (a) => a.title.toLowerCase().includes(q) || (a.requirement && a.requirement.toLowerCase().includes(q))
      );
    }

    return list;
  }, [overviewData?.assignments, assignmentFilterMode, assignmentSearchQuery]);

  // Counts for TA Filter pills
  const filterCounts = useMemo(() => {
    const list = taSubmissionsData?.submissions || [];
    let toGrade = 0;
    let submitted = 0;
    let graded = 0;
    let passed = 0;
    let failed = 0;
    let notGraded = 0;

    for (const s of list) {
      const hasSubmitted = Boolean(
        s.download_url || s.files.length > 0 || ['submitted', 'late'].includes(s.submission_status)
      );
      const edit = localEdits[s.member_id];
      const isUnsaved = Boolean(edit?.isDirty);
      const curStatus = (isUnsaved ? s.passed_status : edit?.status) || s.passed_status || 'not_graded';
      const curMark = isUnsaved
        ? s.mark
        : (edit?.mark !== undefined ? edit.mark : s.mark);
      const isGraded = ['passed', 'failed'].includes(curStatus) || Boolean(curMark && curMark.trim());

      if (hasSubmitted) submitted++;
      if (isGraded) graded++;
      if (curStatus === 'passed') passed++;
      if (curStatus === 'failed') failed++;
      if (curStatus === 'not_graded' && !isGraded) notGraded++;
      if (hasSubmitted && !isGraded) toGrade++;
    }

    return {
      total: list.length,
      toGrade,
      submitted,
      notSubmitted: Math.max(0, list.length - submitted),
      graded,
      passed,
      failed,
      notGraded,
    };
  }, [taSubmissionsData?.submissions, localEdits]);

  const getQuickFilterClasses = (color: TAQuickFilter['color'], isActive: boolean) => {
    switch (color) {
      case 'emerald':
        return isActive
          ? 'bg-emerald-600 text-white shadow-2xs ring-2 ring-emerald-400/50'
          : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 dark:hover:bg-emerald-900/60';
      case 'amber':
        return isActive
          ? 'bg-amber-600 text-white shadow-2xs ring-2 ring-amber-400/50'
          : 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 dark:hover:bg-amber-900/60';
      case 'rose':
        return isActive
          ? 'bg-rose-600 text-white shadow-2xs ring-2 ring-rose-400/50'
          : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 dark:hover:bg-rose-900/60';
      case 'purple':
        return isActive
          ? 'bg-purple-600 text-white shadow-2xs ring-2 ring-purple-400/50'
          : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-900/60';
      case 'sky':
        return isActive
          ? 'bg-sky-600 text-white shadow-2xs ring-2 ring-sky-400/50'
          : 'bg-sky-50 text-sky-800 hover:bg-sky-100 border border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800 dark:hover:bg-sky-900/60';
      case 'slate':
        return isActive
          ? 'bg-slate-800 dark:bg-slate-700 text-white shadow-2xs ring-2 ring-slate-400/50'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700';
      case 'indigo':
      default:
        return isActive
          ? 'bg-indigo-600 text-white shadow-2xs ring-2 ring-indigo-400/50'
          : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800 dark:hover:bg-indigo-900/60';
    }
  };

  // Filter TA Submissions
  const filteredTaSubmissions = useMemo(() => {
    if (!taSubmissionsData?.submissions) return [];
    let list = taSubmissionsData.submissions;

    if (taSearchQuery.trim()) {
      const q = taSearchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.student_name.toLowerCase().includes(q) ||
          (s.login && s.login.toLowerCase().includes(q)) ||
          (s.team_id && s.team_id.toLowerCase().includes(q)) ||
          (s.team_members && s.team_members.some((m) => m.toLowerCase().includes(q)))
      );
    }

    if (taSubmissionFilter === 'submitted') {
      list = list.filter((s) =>
        Boolean(s.download_url || s.files.length > 0 || ['submitted', 'late'].includes(s.submission_status))
      );
    } else if (taSubmissionFilter === 'not_submitted') {
      list = list.filter(
        (s) =>
          !Boolean(s.download_url || s.files.length > 0 || ['submitted', 'late'].includes(s.submission_status))
      );
    }

    if (taGradeFilter.length > 0) {
      list = list.filter((s) => {
        if (savedSuccessId === s.member_id) {
          return true;
        }

        const edit = localEdits[s.member_id];
        const isUnsaved = Boolean(edit?.isDirty);
        const curStatus = (isUnsaved ? s.passed_status : edit?.status) || s.passed_status || 'not_graded';
        const curMark = isUnsaved
          ? s.mark
          : (edit?.mark !== undefined ? edit.mark : s.mark);
        const isGraded = ['passed', 'failed'].includes(curStatus) || Boolean(curMark && curMark.trim());

        return taGradeFilter.some((filterVal) => {
          if (filterVal === 'not_graded') {
            return curStatus === 'not_graded' && !isGraded;
          }
          if (filterVal === 'graded') {
            return isGraded;
          }
          if (filterVal === 'passed') {
            return curStatus === 'passed';
          }
          if (filterVal === 'failed') {
            return curStatus === 'failed';
          }
          return false;
        });
      });
    }

    // Sort TA Submissions
    const parseSubmissionTimestamp = (dateStr?: string): number => {
      if (!dateStr || !dateStr.trim()) return 0;
      const cleaned = dateStr.trim();
      const monthMap: Record<string, string> = {
        jan: '01', feb: '02', mar: '03', mär: '03', maerz: '03', apr: '04',
        mai: '05', may: '05', jun: '06', jul: '07', aug: '08',
        sep: '09', okt: '10', oct: '10', nov: '11', dez: '12', dec: '12',
      };

      const matchNamed = cleaned.match(
        /(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]{3,})\s*(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i
      );
      if (matchNamed) {
        const day = matchNamed[1].padStart(2, '0');
        const mPrefix = matchNamed[2].toLowerCase().slice(0, 3);
        const month = monthMap[mPrefix] || '01';
        const year = matchNamed[3];
        const hour = (matchNamed[4] || '00').padStart(2, '0');
        const minute = (matchNamed[5] || '00').padStart(2, '0');
        const second = (matchNamed[6] || '00').padStart(2, '0');
        const ts = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
        if (!isNaN(ts)) return ts;
      }

      const matchNum = cleaned.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s*(\d{1,2}):(\d{2}))?/);
      if (matchNum) {
        const day = matchNum[1].padStart(2, '0');
        const month = matchNum[2].padStart(2, '0');
        const year = matchNum[3];
        const hour = (matchNum[4] || '00').padStart(2, '0');
        const minute = (matchNum[5] || '00').padStart(2, '0');
        const ts = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00`);
        if (!isNaN(ts)) return ts;
      }

      const generic = Date.parse(cleaned);
      return isNaN(generic) ? 0 : generic;
    };

    const sorted = [...list].sort((a, b) => {
      let comparison = 0;
      if (taSortField === 'time') {
        const tA = parseSubmissionTimestamp(a.submission_time);
        const tB = parseSubmissionTimestamp(b.submission_time);
        comparison = tA - tB;
      } else if (taSortField === 'ilias') {
        const nameA = teamSortNames?.[a.member_id];
        const nameB = teamSortNames?.[b.member_id];
        // Unresolved teams stay last in either direction; never guess from display order.
        if (!nameA || !nameB) return nameA ? -1 : nameB ? 1 : 0;
        comparison = nameA.localeCompare(nameB, 'de');
      } else if (taSortField === 'name') {
        const nameA = (a.team_members && a.team_members.length > 0 ? a.team_members[0] : a.student_name) || '';
        const nameB = (b.team_members && b.team_members.length > 0 ? b.team_members[0] : b.student_name) || '';
        comparison = nameA.localeCompare(nameB, 'de');
      } else if (taSortField === 'status') {
        const editA = localEdits[a.member_id];
        const editB = localEdits[b.member_id];
        const statusA = (editA?.isDirty ? a.passed_status : editA?.status) || a.passed_status || 'not_graded';
        const statusB = (editB?.isDirty ? b.passed_status : editB?.status) || b.passed_status || 'not_graded';
        comparison = statusA.localeCompare(statusB);
      } else if (taSortField === 'mark') {
        const editA = localEdits[a.member_id];
        const editB = localEdits[b.member_id];
        const markA = editA?.isDirty
          ? (a.mark || '')
          : (editA?.mark !== undefined ? editA.mark : (a.mark || ''));
        const markB = editB?.isDirty
          ? (b.mark || '')
          : (editB?.mark !== undefined ? editB.mark : (b.mark || ''));
        const numA = parseFloat(String(markA).replace(',', '.'));
        const numB = parseFloat(String(markB).replace(',', '.'));
        if (!isNaN(numA) && !isNaN(numB)) {
          comparison = numA - numB;
        } else {
          comparison = String(markA).localeCompare(String(markB));
        }
      }

      return taSortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [
    taSubmissionsData?.submissions,
    taSearchQuery,
    taSubmissionFilter,
    taGradeFilter,
    localEdits,
    savedSuccessId,
    taSortField,
    taSortOrder,
    teamSortNames,
  ]);

  // TA Grading Handlers
  const handleStatusChange = (memberId: string, status: string) => {
    setLocalEdits((prev) => ({
      ...prev,
      [memberId]: {
        ...(prev[memberId] || { mark: '', feedback: '', notice: '' }),
        status,
        isDirty: true,
      },
    }));
  };

  const handleMarkChange = (memberId: string, mark: string) => {
    setLocalEdits((prev) => ({
      ...prev,
      [memberId]: {
        ...(prev[memberId] || { status: 'not_graded', feedback: '', notice: '' }),
        mark,
        isDirty: true,
      },
    }));
  };

  const handleFeedbackChange = (memberId: string, feedback: string) => {
    setLocalEdits((prev) => ({
      ...prev,
      [memberId]: {
        ...(prev[memberId] || { status: 'not_graded', mark: '', notice: '' }),
        feedback,
        isDirty: true,
      },
    }));
  };

  const handleNoticeChange = (memberId: string, notice: string) => {
    setLocalEdits((prev) => ({
      ...prev,
      [memberId]: {
        ...(prev[memberId] || { status: 'not_graded', mark: '', feedback: '' }),
        notice,
        isDirty: true,
      },
    }));
  };

  const handleSaveSubmission = async (memberId: string) => {
    const edit = localEdits[memberId];
    if (!edit) return;

    setSavingMemberId(memberId);
    try {
      await api.gradeSubmission(exerciseRefId, memberId, {
        member_id: memberId,
        ass_id: selectedTaAssId || undefined,
        status: edit.status,
        mark: edit.mark || undefined,
        feedback: edit.feedback,
        notice: edit.notice,
        rtoken: taSubmissionsData?.rtoken,
      });

      setLocalEdits((prev) => ({
        ...prev,
        [memberId]: {
          ...prev[memberId],
          isDirty: false,
        },
      }));

      // Update in-memory submissions data and caches
      setTaSubmissionsData((prev) => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          submissions: prev.submissions.map((s) => {
            if (s.member_id === memberId) {
              return {
                ...s,
                passed_status: edit.status,
                mark: edit.mark,
                feedback: edit.feedback,
                notice: edit.notice,
              };
            }
            return s;
          }),
        };
        const cacheKey = selectedTaAssId || 'default';
        submissionsCacheRef.current[cacheKey] = updated;
        cache.setCachedExerciseSubmissions(exerciseRefId, selectedTaAssId || undefined, updated);
        return updated;
      });

      setSavedSuccessId(memberId);
      setTimeout(() => setSavedSuccessId(null), 2500);

      // Trigger modeless feedback toast
      const sub = taSubmissionsData?.submissions.find((s) => s.member_id === memberId);
      const isNotGradedFilter = taGradeFilter.includes('not_graded');
      const isNowGraded = ['passed', 'failed'].includes(edit.status) || Boolean(edit.mark && edit.mark.trim());
      setGradingFeedback({
        id: `toast_${Date.now()}`,
        memberId,
        studentName: sub?.student_name || t("Einreichung"),
        teamId: sub?.team_id,
        status: edit.status,
        mark: edit.mark || undefined,
        wasFilteredOut: isNotGradedFilter && isNowGraded,
      });
    } catch (err: any) {
      alert(t("Fehler beim Speichern: {p0}", { p0: err.message }));
    } finally {
      setSavingMemberId(null);
    }
  };

  const handleSaveFromModal = async (
    memberId: string,
    updated: { status: string; mark: string; feedback: string; notice: string }
  ) => {
    await api.gradeSubmission(exerciseRefId, memberId, {
      member_id: memberId,
      ass_id: selectedTaAssId || undefined,
      status: updated.status,
      mark: updated.mark || undefined,
      feedback: updated.feedback,
      notice: updated.notice,
      rtoken: taSubmissionsData?.rtoken,
    });

    setLocalEdits((prev) => ({
      ...prev,
      [memberId]: {
        ...updated,
        isDirty: false,
      },
    }));

    setTaSubmissionsData((prev) => {
      if (!prev) return prev;
      const updatedData = {
        ...prev,
        submissions: prev.submissions.map((s) => {
          if (s.member_id === memberId) {
            return {
              ...s,
              passed_status: updated.status,
              mark: updated.mark,
              feedback: updated.feedback,
              notice: updated.notice,
            };
          }
          return s;
        }),
      };
      const cacheKey = selectedTaAssId || 'default';
      submissionsCacheRef.current[cacheKey] = updatedData;
      cache.setCachedExerciseSubmissions(exerciseRefId, selectedTaAssId || undefined, updatedData);
      return updatedData;
    });

    setSavedSuccessId(memberId);
    setTimeout(() => setSavedSuccessId(null), 2500);

    // Trigger modeless feedback toast
    const sub = taSubmissionsData?.submissions.find((s) => s.member_id === memberId);
    const isNotGradedFilter = taGradeFilter.includes('not_graded');
    const isNowGraded = ['passed', 'failed'].includes(updated.status) || Boolean(updated.mark && updated.mark.trim());
    setGradingFeedback({
      id: `toast_${Date.now()}`,
      memberId,
      studentName: sub?.student_name || t("Einreichung"),
      teamId: sub?.team_id,
      status: updated.status,
      mark: updated.mark || undefined,
      wasFilteredOut: isNotGradedFilter && isNowGraded,
    });
  };

  const handleRefresh = useCallback(() => {
    loadOverview(true);
    if (activeTab === 'ta_grading') {
      loadTaSubmissions(selectedTaAssId || undefined, false, true);
    } else if (activeTab === 'info') {
      setIsLoadingInfo(true);
      api
        .getExerciseInfo(exerciseRefId)
        .then((data) => {
          setInfoData(data);
          cache.setCachedExerciseInfo(exerciseRefId, data);
          setIsLoadingInfo(false);
        })
        .catch(() => {
          setIsLoadingInfo(false);
        });
    }
  }, [activeTab, loadOverview, loadTaSubmissions, selectedTaAssId, exerciseRefId]);

  const ongoingCount = (overviewData?.assignments || []).filter((a) => a.is_ongoing).length;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Top Header with Breadcrumbs & Sync Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <CompactBreadcrumbs
          rawBreadcrumbs={effectiveBreadcrumbs}
          courseNickname={courseNickname}
          courseRefId={courseRefId}
          currentFolderRefId={exerciseRefId}
          onNavigateHome={onNavigateHome}
          onNavigateRepository={onNavigateRepository}
          onNavigateSemester={onNavigateSemester}
          onNavigateCourse={(ref) => {
            if (!navigationGuard.confirmNavigation()) return;
            onNavigateCourse(ref);
            onBack();
          }}
          onNavigateFolder={(ref) => {
            if (!navigationGuard.confirmNavigation()) return;
            if (onNavigateFolder) onNavigateFolder(ref);
            onBack();
          }}
        />

        {/* Sync / Refresh status */}
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          {isLoadingOverview || isRevalidatingOverview ? (
            <div className="flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>{t("Synchronisiere...")}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              <span>{t("Lokal bereitgestellt")}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoadingOverview && !overviewData}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 transition disabled:opacity-50 cursor-pointer"
            title={t("Neu von ILIAS abrufen")}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                isLoadingOverview || isRevalidatingOverview || (activeTab === 'ta_grading' && isLoadingTaSubmissions)
                  ? 'animate-spin text-indigo-600 dark:text-indigo-400'
                  : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Main Title Row & Navigation Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Layers className="h-5 w-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-tight">
              {overviewData?.title || t("Übungsübersicht")}
            </h1>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            {(overviewData?.assignments || []).length} {t("Übungsblätter verfügbar")}
            {ongoingCount > 0 && ` • ${ongoingCount} ${t("aktuell aktiv")}`}
          </p>
        </div>

        {/* Navigation Bar / Tabs */}
        <div className="flex items-center gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200/60 dark:border-slate-700/60 self-start md:self-auto">
          <button
            type="button"
            onClick={() => switchTab('assignments')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
              activeTab === 'assignments' && taManagementMode === 'none'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>{t("Übungsblätter")}</span>
            <span className="rounded-full bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.2 text-[10px]">
              {(overviewData?.assignments || []).length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => switchTab('info')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
              activeTab === 'info'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Info className="h-3.5 w-3.5" />
            <span>{t("Informationen")}</span>
          </button>

          {/* Tutor Abgaben & Noten Tab: ONLY shown if tutor access is detected! */}
          {overviewData?.has_ta_access && (
            <button
              type="button"
              onClick={() => switchTab('submissions')}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                activeTab === 'ta_grading'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50'
              }`}
            >
              <Award className="h-3.5 w-3.5" />
              <span>{t("Abgaben & Noten (Tutor)")}</span>
            </button>
          )}
        </div>
      </div>

      {/* ========================================================
          TAB 1: ASSIGNMENTS LIST (Default view for students & tutors)
          ======================================================== */}
      {activeTab === 'assignments' && taManagementMode === 'list' && (
        <TAExerciseManagementView
          exerciseRefId={exerciseRefId}
          exerciseTitle={overviewData?.title}
          feedback={assignmentFeedback}
          onFeedbackChange={setAssignmentFeedback}
          onBack={() => {
            setAssignmentFeedback(null);
            switchTab('assignments');
            loadOverview();
          }}
          onEditAssignment={(assId, typeId) => {
            setAssignmentFeedback(null);
            setEditingTaAssId(assId);
            setEditingTaTypeId(typeId || 1);
            switchTab('manage-edit');
          }}
        />
      )}

      {activeTab === 'assignments' && taManagementMode === 'editor' && (
        <TAExerciseEditorView
          exerciseRefId={exerciseRefId}
          assId={editingTaAssId}
          initialTypeId={editingTaTypeId}
          onBack={() => switchTab('manage')}
          onSaved={(savedAssId, result) => {
            setAssignmentFeedback({ kind: result.created ? 'created' : 'updated', title: result.title });
            loadOverview();
            setEditingTaAssId(savedAssId);
            switchTab('manage');
          }}
        />
      )}

      {activeTab === 'assignments' && taManagementMode === 'none' && (
        <div className="space-y-6">
          {/* Filter Bar & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setAssignmentFilterMode('all')}
                className={`rounded-xl px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                  assignmentFilterMode === 'all'
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-2xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {t("Alle (")}{(overviewData?.assignments || []).length})
              </button>

              <button
                type="button"
                onClick={() => setAssignmentFilterMode('ongoing')}
                className={`flex items-center gap-1 rounded-xl px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                  assignmentFilterMode === 'ongoing'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                }`}
              >
                <Zap className="h-3 w-3" />
                <span>{t("Laufend (")}{ongoingCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setAssignmentFilterMode('future')}
                className={`rounded-xl px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                  assignmentFilterMode === 'future'
                    ? 'bg-sky-600 text-white shadow-2xs'
                    : 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60'
                }`}
              >
                {t("Zukünftig (")}{(overviewData?.assignments || []).filter((a) => !a.is_ongoing && !a.is_ended).length})
              </button>

              <button
                type="button"
                onClick={() => setAssignmentFilterMode('past')}
                className={`rounded-xl px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                  assignmentFilterMode === 'past'
                    ? 'bg-slate-700 dark:bg-slate-600 text-white shadow-2xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {t("Beendet (")}{(overviewData?.assignments || []).filter((a) => a.is_ended).length})
              </button>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {/* Search */}
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  placeholder={t("Übungsblatt suchen...")}
                  value={assignmentSearchQuery}
                  onChange={(e) => setAssignmentSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:border-indigo-500 focus:outline-hidden transition"
                />
              </div>

              {/* TA Exercise Management Button */}
              {overviewData?.has_ta_access && (
                <button
                  type="button"
                  onClick={() => switchTab('manage')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 font-bold text-xs transition cursor-pointer shrink-0 shadow-2xs"
                  title={t("Übungen verwalten & bearbeiten (Tutor)")}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>{t("Übungen verwalten")}</span>
                </button>
              )}
            </div>
          </div>

          {/* Assignments Grid */}
          {isLoadingOverview && !overviewData ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-600 dark:text-indigo-400" />
              <p className="text-xs font-semibold">{t("Lade Übungsblätter...")}</p>
            </div>
          ) : overviewError ? (
            <div className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/30 p-6 text-center space-y-2">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400 mx-auto" />
              <h3 className="text-sm font-bold text-red-900 dark:text-red-200">{t("Fehler beim Laden")}</h3>
              <p className="text-xs text-red-600 dark:text-red-300">{overviewError}</p>
            </div>
          ) : filteredAssignments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-slate-400 dark:text-slate-500 space-y-2">
              <Layers className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{t("Keine Übungsblätter gefunden")}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">{t("Keine Einträge für die gewählte Filterung vorhanden.")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredAssignments.map((assignment, idx) => {
                const isOngoing = assignment.is_ongoing;
                const isEnded = assignment.is_ended;

                return (
                  <div
                    key={assignment.ass_id || idx}
                    className={`rounded-2xl border bg-white dark:bg-slate-900 p-5 shadow-2xs transition hover:shadow-xs flex flex-col justify-between gap-4 ${
                      isOngoing
                        ? 'border-emerald-300 dark:border-emerald-700/80 ring-2 ring-emerald-100 dark:ring-emerald-950/60 bg-emerald-50/20 dark:bg-emerald-950/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          {isOngoing ? (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/70 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                              <Zap className="h-3 w-3 fill-emerald-600 dark:fill-emerald-400" />
                              <span>{t("Laufend")}</span>
                            </span>
                          ) : isEnded ? (
                            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              {t("Beendet")}
                            </span>
                          ) : (
                            <span className="rounded-full bg-sky-50 dark:bg-sky-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                              {t("Zukünftig")}
                            </span>
                          )}

                          {assignment.requirement && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                assignment.requirement.toLowerCase().includes('mandatory') ||
                                assignment.requirement.toLowerCase().includes('pflicht')
                                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {assignmentStatusText(assignment.requirement)}
                            </span>
                          )}

                          {assignment.ass_type && (
                            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">
                              {assignmentStatusText(assignment.ass_type)}
                            </span>
                          )}
                        </div>

                        {assignment.status && (
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                              assignment.status.toLowerCase().includes('passed') ||
                              assignment.status.toLowerCase().includes('bestanden')
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {assignment.status === 'not_submitted'
                              ? t("Noch keine Abgabe")
                              : assignment.status === 'not_graded'
                              ? t("Nicht bewertet")
                              : assignmentStatusText(assignment.status)}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {assignment.title}
                      </h3>

                      {/* Timeline info */}
                      <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                        {assignment.time_remaining && (
                          <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                            <Clock className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                            <span>{assignmentStatusText(assignment.time_remaining)}</span>
                          </div>
                        )}
                        {assignment.edit_until && (
                          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                            <Calendar className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                            <span>{t("Frist:")} {assignmentStatusText(assignment.edit_until)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Action Buttons */}
                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                      {/* Open Student Assignment Details Modal */}
                      {assignment.ass_id && (
                        <button
                          type="button"
                          onClick={() =>
                            setActiveModalAssignment({
                              assId: assignment.ass_id!,
                              title: assignment.title,
                            })
                          }
                          className="flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 px-4 py-1.5 text-xs font-bold text-white dark:text-slate-100 hover:bg-slate-800 dark:hover:bg-slate-700 transition shadow-2xs cursor-pointer ml-auto border dark:border-slate-700"
                        >
                          <span>{t("Details & Abgabe")}</span>
                          <span>→</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          TAB 2: INFORMATIONEN & KRITERIEN (Info Tab)
          ======================================================== */}
      {activeTab === 'info' && (
        <div className="space-y-6 max-w-4xl mx-auto">
          {isLoadingInfo && !infoData ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-600 dark:text-indigo-400" />
              <p className="text-xs font-semibold">{t("Lade Kriterien & Informationen...")}</p>
            </div>
          ) : infoData && infoData.sections.length > 0 ? (
            <div className="space-y-4">
              {infoData.sections.map((sec, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {sec.title}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {Object.entries(sec.properties).map(([k, v]) => (
                      <div key={k} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                          {k}
                        </span>
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-400 dark:text-slate-500">
              <Info className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-xs font-semibold">{t("Keine zusätzlichen Informationen verfügbar.")}</p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          TAB 3: TUTOR SUBMISSIONS & GRADING (Only for TAs / Instructors)
          ======================================================== */}
      {activeTab === 'ta_grading' && overviewData?.has_ta_access && (
        <div className="space-y-6">
          {/* Sub-Assignment Dropdown Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0 shadow-2xs">
                <Layers className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="ta-assignment-select"
                  className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block"
                >
                  {t("Zu korrigierendes Übungsblatt auswählen")}
                </label>
                <div className="mt-1 relative max-w-xl">
                  <select
                    id="ta-assignment-select"
                    value={selectedTaAssId || ''}
                    onChange={(e) => handleSelectTaAssignment(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden transition cursor-pointer shadow-2xs"
                  >
                    {taAssignmentsList.map((ass) => (
                      <option key={ass.ass_id || ass.title} value={ass.ass_id || ''}>
                        {ass.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Submissions Stats Pill & Background Sync Badge */}
            <div className="flex items-center gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800 flex-wrap">
              {isLoadingTaSubmissions && taSubmissionsData && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold animate-pulse">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
                  <span>{t("Wird synchronisiert...")}</span>
                </div>
              )}
              {taSubmissionsData?.exercise && (
                <>
                  <div className="px-3.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-center">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                      {t("Abgaben")}
                    </span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {taSubmissionsData.exercise.submitted_count}
                    </span>
                  </div>
                  <div className="px-3.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/80 text-center">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 dark:text-indigo-300 block">
                      {t("Bewertet")}
                    </span>
                    <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
                      {taSubmissionsData.exercise.graded_count}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* TA Grading Menu Bar (Left: Quick-Filters, Middle: Radio & Multi-select, Right: Search, Sorting indicator, Settings 3-dot) */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
            {/* Left: Quick-Filters collection */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1 hidden sm:inline">
                {t("Schnellfilter:")}
              </span>
              {quickFilters.map((qf) => {
                const isActive =
                  taSubmissionFilter === qf.submissionStatus &&
                  taGradeFilter.length === qf.gradeStatus.length &&
                  taGradeFilter.every((g) => qf.gradeStatus.includes(g));

                return (
                  <button
                    key={qf.id}
                    type="button"
                    onClick={() => handleApplyQuickFilter(qf)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${getQuickFilterClasses(
                      qf.color,
                      isActive
                    )}`}
                    title={t("Schnellfilter: {p0} (Klicken zum {p1})", { p0: qf.label, p1: isActive ? t('Deaktivieren') : t('Aktivieren') })}
                  >
                    {qf.id === 'to_grade' && <Clock className="h-3.5 w-3.5 shrink-0" />}
                    <span>{qf.label}</span>
                    {qf.id === 'to_grade' && (
                      <span className="text-[10px] opacity-80">({filterCounts.toGrade})</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Middle: Submission Radio toggle + Grade Multi-select */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Submission Radio Group */}
              <div className="flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/80 dark:border-slate-700 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1.5 hidden md:inline">
                  {t("Abgabe:")}
                </span>
                <button
                  type="button"
                  onClick={() => handleSetSubmissionFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                    taSubmissionFilter === 'all'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title={t("Alle Abgaben anzeigen")}
                >
                  {t("Alle (")}{filterCounts.total})
                </button>
                <button
                  type="button"
                  onClick={() => handleSetSubmissionFilter('submitted')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                    taSubmissionFilter === 'submitted'
                      ? 'bg-sky-600 text-white shadow-2xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title={t("Nur eingereichte Abgaben anzeigen")}
                >
                  {t("Eingereicht (")}{filterCounts.submitted})
                </button>
                <button
                  type="button"
                  onClick={() => handleSetSubmissionFilter('not_submitted')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                    taSubmissionFilter === 'not_submitted'
                      ? 'bg-slate-700 dark:bg-slate-600 text-white shadow-2xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title={t("Nur noch nicht eingereichte anzeigen")}
                >
                  {t("Nicht eingereicht (")}{filterCounts.notSubmitted})
                </button>
              </div>

              {/* Grade Status Multi-Select Group */}
              <div className="flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/80 dark:border-slate-700 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1.5 hidden md:inline">
                  {t("Bewertung:")}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setTaGradeFilter([]);
                    localStorage.setItem('ilias_ta_filter_grade', JSON.stringify([]));
                  }}
                  className={`rounded-lg px-2 py-1 text-xs font-semibold transition cursor-pointer ${
                    taGradeFilter.length === 0
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title={t("Alle Bewertungsstufen zulassen")}
                >
                  {t("Beliebig")}
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleGradeFilter('not_graded')}
                  className={`rounded-lg px-2 py-1 text-xs font-semibold transition cursor-pointer ${
                    taGradeFilter.includes('not_graded')
                      ? 'bg-amber-600 text-white shadow-2xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title={t("Offene / noch nicht bewertete Abgaben filtern")}
                >
                  {t("Offen (")}{filterCounts.notGraded})
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleGradeFilter('passed')}
                  className={`rounded-lg px-2 py-1 text-xs font-semibold transition cursor-pointer ${
                    taGradeFilter.includes('passed')
                      ? 'bg-emerald-600 text-white shadow-2xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title={t("Bestandene Abgaben filtern")}
                >
                  {t("Bestanden (")}{filterCounts.passed})
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleGradeFilter('failed')}
                  className={`rounded-lg px-2 py-1 text-xs font-semibold transition cursor-pointer ${
                    taGradeFilter.includes('failed')
                      ? 'bg-rose-600 text-white shadow-2xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  title={t("Nicht bestandene Abgaben filtern")}
                >
                  {t("Nicht bestanden (")}{filterCounts.failed})
                </button>
              </div>
            </div>

            {/* Right: Search, Sorting Indicator & 3-Dot Settings Menu */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex flex-col gap-0.5">
                <div className="relative w-full sm:w-44">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                  <input
                    type="text"
                    placeholder={t("Student / Team...")}
                    value={taSearchQuery}
                    onChange={(e) => setTaSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 pl-8 pr-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden transition"
                  />
                </div>
                {/* Greyed-out sorting indication under search */}
                <div className="flex items-center gap-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">
                  <span>{t("Sortiert:")}</span>
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">{sortFieldLabel}</span>
                  <span className="font-bold">{taSortOrder === 'asc' ? '↑' : '↓'}</span>
                </div>
              </div>

              {/* 3-Dot Settings Dialog Trigger */}
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition shadow-2xs cursor-pointer shrink-0"
                title={t("Filter-, Sortier- & Kursansicht-Einstellungen öffnen")}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Modeless Feedback Bar directly below filter bar (stays until dismissed with X) */}
          <GradingFeedbackBar
            feedback={gradingFeedback}
            onDismiss={() => setGradingFeedback(null)}
            onViewSubmission={(memberId) => {
              const sub = taSubmissionsData?.submissions.find((s) => s.member_id === memberId);
              if (sub) {
                setDetailModalSubmission(sub);
              }
            }}
            onResetFilter={() => {
              handleSetSubmissionFilter('all');
              setTaGradeFilter([]);
              localStorage.setItem('ilias_ta_filter_grade', JSON.stringify([]));
            }}
          />

          {taSortField === 'ilias' && (
            <div role="status" className="text-xs text-slate-500 dark:text-slate-400">
              {!teamSortNames ? t('ILIAS-Reihenfolge wird geladen…') : teamOrder?.error ? (
                <>{t('ILIAS-Reihenfolge konnte nicht geladen werden.')} <button type="button" className="underline" onClick={() => setTeamOrderRetry((value) => value + 1)}>{t('Erneut versuchen')}</button></>
              ) : taSubmissionsData?.submissions.some((s) => !teamSortNames[s.member_id]) ? (
                t('Abgaben ohne ermittelbaren Feedback-Empfänger stehen am Ende.')
              ) : null}
            </div>
          )}

          {/* Submissions List */}
          {isLoadingTaSubmissions && !taSubmissionsData ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-600 dark:text-indigo-400" />
              <p className="text-xs font-semibold">{t("Lade Abgaben zur Bewertung...")}</p>
            </div>
          ) : filteredTaSubmissions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-400 dark:text-slate-500">
              <p className="text-xs font-semibold">{t("Keine Abgaben für diesen Filter gefunden.")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTaSubmissions.map((sub) => {
                const edit = localEdits[sub.member_id] || {
                  status: sub.passed_status || 'not_graded',
                  mark: sub.mark || '',
                  feedback: sub.feedback || '',
                  notice: sub.notice || '',
                  isDirty: false,
                };
                const isSaving = savingMemberId === sub.member_id;
                const isSaved = savedSuccessId === sub.member_id;
                const hasSubmitted = Boolean(
                  sub.download_url ||
                  (sub.files && sub.files.length > 0) ||
                  ['submitted', 'late'].includes(sub.submission_status)
                );

                return (
                  <div
                    key={sub.member_id}
                    className={`rounded-2xl border bg-white dark:bg-slate-900 p-4 transition shadow-2xs space-y-3 ${
                      isSaved
                        ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30 ring-2 ring-emerald-500/20'
                        : edit.isDirty
                        ? 'border-amber-300 dark:border-amber-600/80 ring-1 ring-amber-200 dark:ring-amber-950/60'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {/* Saved success banner */}
                    {isSaved && (
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-900/50 px-2.5 py-1 rounded-lg w-fit animate-in fade-in duration-150">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>{t("Erfolgreich gespeichert — wird aus der Liste gefiltert")}</span>
                      </div>
                    )}

                    {/* Row Header: Student Info & Actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold shrink-0 ${
                            sub.team_members && sub.team_members.length > 1
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {sub.team_members && sub.team_members.length > 1 ? (
                            <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                          ) : (
                            <span>{sub.student_name.slice(0, 2).toUpperCase()}</span>
                          )}
                        </div>
                        <div>
                          {/* Student Names / Team Members with Clear Dividers */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {sub.team_members && sub.team_members.length > 1 ? (
                              sub.team_members.map((member, mIdx) => (
                                <span
                                  key={mIdx}
                                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200/80 dark:hover:bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xs transition"
                                >
                                  <User className="h-3 w-3 text-slate-400 dark:text-slate-500 shrink-0" />
                                  <span>{member}</span>
                                </span>
                              ))
                            ) : (
                              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {sub.student_name}
                              </span>
                            )}

                            {sub.team_id && (
                              <span className="rounded-lg bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                {t("Team #")}{sub.team_id}
                              </span>
                            )}
                          </div>

                          {/* Submission Timestamps */}
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                            {sub.submission_time ? (
                              <span className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-400">
                                <Clock className="h-3 w-3 text-sky-500 dark:text-sky-400" />
                                <span>{t("Abgabe:")} {sub.submission_time}</span>
                              </span>
                            ) : hasSubmitted ? (
                              <span className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
                                <span>{t("Eingereicht")}</span>
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500">{t("Keine Abgabe eingereicht")}</span>
                            )}
                            {sub.graded_on && (
                              <span className="text-slate-400 dark:text-slate-500">{t("• Bewertet:")} {sub.graded_on}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Direct Actions: Download, Details "i" */}
                      <div className="flex items-center gap-2 flex-wrap self-end sm:self-auto">
                        {sub.download_url ? (
                          <a
                            href={sub.download_url}
                            download
                            className="flex items-center gap-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition shadow-2xs border border-indigo-200 dark:border-indigo-800"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>{t("Abgabe herunterladen")}</span>
                          </a>
                        ) : (
                          <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                            {t("Keine Datei")}
                          </span>
                        )}

                        {/* "i" Info/Details Button (placed where Mail was) */}
                        <button
                          type="button"
                          onClick={() => setDetailModalSubmission(sub)}
                          className="flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-700 dark:hover:text-indigo-300 hover:border-indigo-200 dark:hover:border-indigo-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 transition shadow-2xs cursor-pointer"
                          title={t("Alle ILIAS-Spalten & Details anzeigen / bearbeiten")}
                        >
                          <Info className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                          <span className="hidden sm:inline">{t("Details")}</span>
                        </button>
                      </div>
                    </div>

                    {/* Grading & Evaluation Area */}
                    <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 p-3 border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-3">
                      {/* Left: Status Toggle & Grade */}
                      <div className="w-full md:w-56 shrink-0 space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
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
                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
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
                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/30'
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
                                ? 'bg-slate-700 dark:bg-slate-600 text-white border-slate-700 dark:border-slate-600 shadow-2xs'
                                : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            <span>{t("Nicht bewertet")}</span>
                            {edit.status === 'not_graded' && <Check className="h-3 w-3" />}
                          </button>
                        </div>

                        {/* Points / Mark input - only when showMarksInOverview is true */}
                        {showMarksInOverview ? (
                          <div>
                            <input
                              type="text"
                              value={edit.mark}
                              onChange={(e) => handleMarkChange(sub.member_id, e.target.value)}
                              placeholder={t("Note / Punkte (optional)")}
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:border-indigo-500 focus:outline-hidden"
                            />
                          </div>
                        ) : edit.mark ? (
                          <div className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                            <Award className="h-3 w-3 text-amber-500 dark:text-amber-400" />
                            <span>{t("Note/Pkt:")} <strong className="font-semibold">{edit.mark}</strong></span>
                          </div>
                        ) : null}
                      </div>

                      {/* Middle: According to evalModeInOverview */}
                      {evalModeInOverview === 'statement' ? (
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 dark:bg-slate-800 p-0.5 text-[11px]">
                              <button
                                type="button"
                                onClick={() =>
                                  setRowTabState((prev) => ({ ...prev, [sub.member_id]: 'feedback' }))
                                }
                                className={`px-2 py-0.5 rounded-md font-semibold transition cursor-pointer ${
                                  (rowTabState[sub.member_id] || 'feedback') === 'feedback'
                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                              >
                                {t("Kommentar")} {edit.feedback ? '•' : ''}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setRowTabState((prev) => ({ ...prev, [sub.member_id]: 'notice' }))
                                }
                                className={`px-2 py-0.5 rounded-md font-semibold transition cursor-pointer ${
                                  rowTabState[sub.member_id] === 'notice'
                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                              >
                                {t("Tutor-Notiz")} {edit.notice ? '•' : ''}
                              </button>
                            </div>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">
                              {(rowTabState[sub.member_id] || 'feedback') === 'feedback'
                                ? t("Für Studierende sichtbar")
                                : t("Nur intern für Tutoren")}
                            </span>
                          </div>

                          {(rowTabState[sub.member_id] || 'feedback') === 'feedback' ? (
                            <textarea
                              rows={3}
                              value={edit.feedback}
                              onChange={(e) => handleFeedbackChange(sub.member_id, e.target.value)}
                              placeholder={t("Korrektur-Kommentar für Studierende eingeben...")}
                              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-sans"
                            />
                          ) : (
                            <textarea
                              rows={3}
                              value={edit.notice}
                              onChange={(e) => handleNoticeChange(sub.member_id, e.target.value)}
                              placeholder={t("Interne Notiz für Tutoren (wird nicht an Studierende gesendet)...")}
                              className="w-full rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/30 p-2.5 text-xs text-slate-800 dark:text-amber-200 placeholder-slate-400 dark:placeholder-amber-400/60 focus:border-amber-500 focus:outline-hidden focus:ring-1 focus:ring-amber-500 font-sans"
                            />
                          )}
                        </div>
                      ) : evalModeInOverview === 'file' ? (
                        <div className="flex-1 space-y-2.5">
                          {/* Header row: Title, badge, and management buttons */}
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
                                {t("Korrektur per Datei")}
                              </span>
                              {rowFeedbackFiles[sub.member_id] && rowFeedbackFiles[sub.member_id].length > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 dark:bg-indigo-900/60 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                                  <FileText className="h-3 w-3" />
                                  <span>
                                    {rowFeedbackFiles[sub.member_id].length}{' '}
                                    {rowFeedbackFiles[sub.member_id].length === 1
                                      ? t("Datei")
                                      : t("Dateien")}
                                  </span>
                                </span>
                              )}
                              {edit.feedback && (
                                <span className="text-[10px] text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                                  {t("Kommentar hinterlegt")}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5">
                              {sub.evaluation_by_file_url && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setDetailModalSubmission(sub)}
                                    className="flex items-center gap-1 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 transition cursor-pointer"
                                    title={t("Dateien verwalten")}
                                  >
                                    <FileText className="h-3 w-3" />
                                    <span>{t("Verwalten")}</span>
                                  </button>
                                  <a
                                    href={sub.evaluation_by_file_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-indigo-400 bg-white dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700"
                                    title={t("In ILIAS öffnen")}
                                  >
                                    <span>{t("ILIAS")}</span>
                                    <ExternalLink className="h-3 w-3 opacity-60" />
                                  </a>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Uploaded Feedback Files List */}
                          {loadingFeedbackFilesFor[sub.member_id] && !rowFeedbackFiles[sub.member_id] ? (
                            <div className="p-2.5 text-xs text-slate-400 dark:text-slate-500 flex items-center gap-2 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800/80">
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
                              <span>{t("Lade Korrekturdateien aus ILIAS...")}</span>
                            </div>
                          ) : rowFeedbackFiles[sub.member_id] && rowFeedbackFiles[sub.member_id].length > 0 ? (
                            <div className="space-y-1.5">
                              {rowFeedbackFiles[sub.member_id].map((ff) => (
                                <div
                                  key={ff.id}
                                  className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 p-2 text-xs"
                                >
                                  <div className="flex items-center gap-2 min-w-0 pr-2">
                                    <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                    <div className="min-w-0">
                                      <p className="font-bold text-slate-800 dark:text-slate-200 truncate" title={ff.title}>
                                        {ff.title}
                                      </p>
                                      <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                                        {ff.size && `${ff.size} • `}
                                        {ff.created_on && t("Erstellt: {p0}", { p0: ff.created_on })}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {ff.download_url && (
                                      <a
                                        href={api.getDownloadUrl(exerciseRefId, ff.download_url)}
                                        download
                                        className="flex items-center gap-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 px-2 py-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition border border-indigo-200 dark:border-indigo-800"
                                        title={t("Korrekturdatei herunterladen")}
                                      >
                                        <Download className="h-3 w-3" />
                                        <span>{t("Download")}</span>
                                      </a>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRowFeedbackFile(sub.member_id, ff.id, sub.evaluation_by_file_url)}
                                      disabled={deletingFeedbackFileId === ff.id}
                                      className="flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition border border-transparent hover:border-rose-200 dark:hover:border-rose-800 disabled:opacity-50 cursor-pointer"
                                      title={t("Korrekturdatei löschen")}
                                    >
                                      {deletingFeedbackFileId === ff.id ? (
                                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-rose-600" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {/* Upload Dropzone Box */}
                          <div
                            onDragOver={(e) => {
                              if (!sub.evaluation_by_file_url) return;
                              e.preventDefault();
                              e.stopPropagation();
                              if (draggingMemberId !== sub.member_id) setDraggingMemberId(sub.member_id);
                            }}
                            onDragLeave={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                setDraggingMemberId((prev) => (prev === sub.member_id ? null : prev));
                              }
                            }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDraggingMemberId(null);
                              if (!sub.evaluation_by_file_url) return;
                              const file = e.dataTransfer.files?.[0];
                              if (file) {
                                await uploadMemberFeedbackFile(sub.member_id, file);
                              }
                            }}
                            className={`rounded-xl border p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                              draggingMemberId === sub.member_id
                                ? 'border-indigo-500 border-dashed bg-indigo-100/70 dark:bg-indigo-950/60 ring-2 ring-indigo-500/20'
                                : 'border-indigo-100 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/30'
                            }`}
                          >
                            <div className="text-xs text-indigo-900 dark:text-indigo-200">
                              {fileUploadSuccessId === sub.member_id ? (
                                <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                                  <Check className="h-3.5 w-3.5" />
                                  <span>{t("Korrekturdatei erfolgreich hochgeladen!")}</span>
                                </span>
                              ) : draggingMemberId === sub.member_id ? (
                                <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                                  {t("Datei hier loslassen zum Hochladen...")}
                                </span>
                              ) : rowFeedbackFiles[sub.member_id] && rowFeedbackFiles[sub.member_id].length > 0 ? (
                                <span>{t("Weitere Korrekturdatei per Drag & Drop hierher ziehen oder auswählen.")}</span>
                              ) : sub.evaluation_by_file_url ? (
                                <span>{t("Korrekturdatei per Drag & Drop hierher ziehen oder Button nutzen.")}</span>
                              ) : (
                                <span className="text-slate-500 dark:text-slate-400">{t("Keine separate Datei-Rückmeldung in ILIAS konfiguriert.")}</span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {sub.evaluation_by_file_url && (
                                <>
                                  <label
                                    htmlFor={`row-upload-${sub.member_id}`}
                                    className={`flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 transition shrink-0 shadow-2xs cursor-pointer ${
                                      uploadingMemberId === sub.member_id ? 'opacity-50 cursor-wait' : ''
                                    }`}
                                  >
                                    {uploadingMemberId === sub.member_id ? (
                                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Upload className="h-3.5 w-3.5" />
                                    )}
                                    <span>
                                      {uploadingMemberId === sub.member_id
                                        ? t("Lädt...")
                                        : rowFeedbackFiles[sub.member_id] && rowFeedbackFiles[sub.member_id].length > 0
                                        ? t("Datei hinzufügen")
                                        : t("Datei hochladen")}
                                    </span>
                                  </label>
                                  <input
                                    id={`row-upload-${sub.member_id}`}
                                    type="file"
                                    className="hidden"
                                    disabled={uploadingMemberId === sub.member_id}
                                    onChange={(e) => handleUploadFeedbackFile(sub.member_id, e)}
                                  />
                                </>
                              )}
                            </div>
                          </div>

                          {/* Tutor Notice */}
                          <div className="pt-1">
                            <input
                              type="text"
                              value={edit.notice}
                              onChange={(e) => handleNoticeChange(sub.member_id, e.target.value)}
                              placeholder={t("Tutor-Notiz (intern)...")}
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:border-indigo-500 focus:outline-hidden"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                              {t("Korrektur per E-Mail")}
                            </span>
                            {edit.feedback && (
                              <span className="text-[10px] text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                                {t("Kommentar hinterlegt")}
                              </span>
                            )}
                          </div>

                          <div className="rounded-xl border border-sky-100 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/30 p-2.5 flex items-center justify-between gap-3">
                            <div className="text-xs text-sky-900 dark:text-sky-200">
                              {sub.feedback_mail_url ? (
                                <span>{t("Feedback direkt per ILIAS-Mail an die/den Studierende(n) senden.")}</span>
                              ) : (
                                <span className="text-slate-500 dark:text-slate-400">{t("Kein Mail-Link für diese Abgabe hinterlegt.")}</span>
                              )}
                            </div>
                            {sub.feedback_mail_url && (
                              <a
                                href={sub.feedback_mail_url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 transition shrink-0 shadow-2xs"
                              >
                                <Mail className="h-3.5 w-3.5" />
                                <span>{t("Mail verfassen")}</span>
                              </a>
                            )}
                          </div>

                          {/* Tutor Notice */}
                          <div className="pt-1">
                            <input
                              type="text"
                              value={edit.notice}
                              onChange={(e) => handleNoticeChange(sub.member_id, e.target.value)}
                              placeholder={t("Tutor-Notiz (intern)...")}
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:border-indigo-500 focus:outline-hidden"
                            />
                          </div>
                        </div>
                      )}

                      {/* Right: Save Button */}
                      <div className="flex md:flex-col justify-end items-end gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSaveSubmission(sub.member_id)}
                          disabled={isSaving || isLoadingTaSubmissions}
                          title={isLoadingTaSubmissions ? t("Aktualisierung läuft... Bitte warten") : t("Speichern")}
                          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer ${
                            isSaved
                              ? 'bg-emerald-600'
                              : edit.isDirty
                              ? 'bg-indigo-600 hover:bg-indigo-700'
                              : 'bg-slate-700 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 border dark:border-slate-700'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {isSaving ? (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              <span>{t("Speichern...")}</span>
                            </>
                          ) : isLoadingTaSubmissions ? (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-300 dark:text-slate-500" />
                              <span>{t("Lädt...")}</span>
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
                          <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
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
      )}

      {/* Student Assignment Presentation Modal (Closes on outside click and ESC) */}
      {activeModalAssignment && (
        <StudentAssignmentModal
          exerciseRefId={exerciseRefId}
          assId={activeModalAssignment.assId}
          assignmentTitle={activeModalAssignment.title}
          onClose={() => setActiveModalAssignment(null)}
        />
      )}

      {/* Submission Detail Modal (TA view "i" / Details button, closes on outside click and ESC) */}
      {detailModalSubmission && (
        <SubmissionDetailModal
          submission={detailModalSubmission}
          exerciseTitle={overviewData?.title}
          assignmentTitle={
            taAssignmentsList.find((a) => a.ass_id === selectedTaAssId)?.title
          }
          exerciseRefId={exerciseRefId}
          assId={selectedTaAssId || undefined}
          isUpdating={isLoadingTaSubmissions}
          initialEdit={localEdits[detailModalSubmission.member_id]}
          initialFeedbackFiles={rowFeedbackFiles[detailModalSubmission.member_id]}
          onFeedbackFilesChange={(memberId, files) => {
            setRowFeedbackFiles((prev) => ({ ...prev, [memberId]: files }));
          }}
          onSave={handleSaveFromModal}
          onClose={() => setDetailModalSubmission(null)}
        />
      )}

      {/* TA Filter & Course Settings Modal */}
      <TAFilterSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        courseRefId={courseRefId}
        showMarksInOverview={showMarksInOverview}
        onToggleShowMarksInOverview={toggleShowMarksInOverview}
        evalModeInOverview={evalModeInOverview}
        onSetEvalMode={handleSetEvalMode}
        sortField={taSortField}
        onSetSortField={(field) => {
          setTaSortField(field);
          if (field === 'ilias' && taSortField !== 'ilias') setTaSortOrder('asc');
        }}
        sortOrder={taSortOrder}
        onSetSortOrder={setTaSortOrder}
        quickFilters={quickFilters}
        onAddQuickFilter={handleAddQuickFilter}
        onDeleteQuickFilter={handleDeleteQuickFilter}
      />

      {/* Toast Notification for changes detected during background revalidation */}
      {localNotifications.length > 0 && (
        <NotificationToast
          notifications={localNotifications}
          onDismiss={() => setLocalNotifications([])}
        />
      )}


    </div>
  );
};

export default ExerciseView;

