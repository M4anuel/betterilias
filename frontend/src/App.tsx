import { t, useLanguage } from './lib/i18n';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ConnectionNotice } from './components/ConnectionNotice';
import { ErrorNotice } from './components/ErrorNotice';
import { useConnectionRetry } from './lib/connection';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { SidebarResizer, SIDEBAR_MIN_WIDTH, SIDEBAR_COLLAPSE_WIDTH } from './components/SidebarResizer';
import { SidebarPin, SidebarPinsProvider } from './lib/sidebarPins';
import { WorkspaceWidth } from './lib/workspaceWidth';
import { SemesterView } from './components/SemesterView';
import { LandingView } from './components/LandingView';
import { LegalModal } from './components/LegalModal';
import { CalendarView } from './components/CalendarView';
import { CourseView } from './components/CourseView';
import { MyCoursesView } from './components/MyCoursesView';
import { RepositoryView } from './components/RepositoryView';
import { CourseMembershipModal } from './components/CourseMembershipModal';
import { NicknameModal } from './components/NicknameModal';
import { ExtensionInfoModal } from './components/ExtensionInfoModal';
import { ConfirmModal } from './components/ConfirmModal';
import { DownloadProgressBar } from './components/DownloadProgressBar';
import { NotificationToast, ChangeNotification } from './components/NotificationToast';
import {
  AuthStatus,
  CourseItem,
  CourseMaterialsResponse,
  ExerciseTab,
  SemesterScreenResponse,
  MembershipAction,
} from './types';
import { api } from './lib/api';
import { cache, MATERIALS_CACHE_PREFIX } from './lib/cache';
import { CourseAssignmentTarget, upsertCourseTreeContainer } from './lib/courseTree';
import { useMobileViewport } from './lib/useMobileViewport';
import { theme } from './lib/theme';
import { navigationGuard } from './lib/navigationGuard';
import { appHistoryDepth, pushAppHistory, replaceAppHistory } from './lib/appHistory';
import { useEscapeNavigation } from './lib/useEscapeNavigation';

export interface NavigationState {
  semester: string;
  courseId: string | null;
  containerId: string | null;
  exerciseId: string | null;
  exerciseTab?: ExerciseTab | null;
  repositoryId?: string | null;
  isCalendarOpen?: boolean;
  myCourses?: boolean;
  isLandingOpen?: boolean;
}

export function stateToUrl(state: NavigationState): string {
  const params = new URLSearchParams();
  if (state.isLandingOpen) {
    params.set('view', 'about');
  } else if (state.myCourses) {
    params.set('view', 'my-courses');
  } else if (state.repositoryId) {
    params.set('repository', state.repositoryId);
  } else if (state.courseId) {
    params.set('course', state.courseId);
    if (state.containerId && state.containerId !== state.courseId) {
      params.set('folder', state.containerId);
    }
    if (state.exerciseId) {
      params.set('exercise', state.exerciseId);
      if (state.exerciseTab) {
        params.set('tab', state.exerciseTab);
      }
    }
  } else {
    if (state.isCalendarOpen) {
      params.set('view', 'calendar');
    }
    if (state.semester) {
      params.set('semester', state.semester);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : window.location.pathname;
}

export function parseStateFromUrl(defaultSemester: string): NavigationState {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  const isLandingOpen = viewParam === 'about' || viewParam === 'landing';
  const myCourses = !isLandingOpen && viewParam === 'my-courses';
  const repositoryId = isLandingOpen || myCourses ? null : params.get('repository');
  const isCalendarOpen = !isLandingOpen && !myCourses && !repositoryId && !params.get('course') && viewParam === 'calendar';
  const courseId = isLandingOpen || myCourses || repositoryId ? null : params.get('course');
  const folderId = isLandingOpen || myCourses || repositoryId ? null : params.get('folder');
  const exerciseId = isLandingOpen || myCourses || repositoryId ? null : params.get('exercise');
  const tabParam = isLandingOpen || myCourses || repositoryId ? null : params.get('tab');
  const semester = params.get('semester') || defaultSemester;

  let exerciseTab: ExerciseTab | null = null;
  if (exerciseId && tabParam) {
    if (tabParam === 'info') exerciseTab = 'info';
    else if (tabParam === 'submissions' || tabParam === 'ta_grading' || tabParam === 'grades') exerciseTab = 'submissions';
    else if (tabParam === 'manage') exerciseTab = 'manage';
    else if (tabParam === 'manage-edit' || tabParam === 'edit') exerciseTab = 'manage-edit';
    else if (tabParam === 'assignments' || tabParam === 'overview') exerciseTab = 'assignments';
  }

  return {
    semester,
    repositoryId,
    isCalendarOpen,
    myCourses,
    isLandingOpen,
    courseId: courseId || null,
    containerId: folderId || courseId || null,
    exerciseId: exerciseId || null,
    exerciseTab,
  };
}

export const App: React.FC = () => {
  const language = useLanguage();
  const approvedHistoryNavigation = useRef(false);
  const isMobile = useMobileViewport();
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { return Math.max(SIDEBAR_MIN_WIDTH, Math.min(1600, Number(localStorage.getItem('betterilias_sidebar_width')) || 256)); }
    catch { return 256; }
  });
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth);
  const workspaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    const observer = new ResizeObserver(([entry]) => setWorkspaceWidth(entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width));
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    return () => { window.removeEventListener('resize', resize); observer.disconnect(); };
  }, []);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const mobileNavigation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = mobileNavigation.current;
    if (isMobile && mobileNavigationOpen) dialog?.showModal();
    else dialog?.close();
    if (!isMobile) setMobileNavigationOpen(false);
  }, [isMobile, mobileNavigationOpen]);
  // --- Auth & Session State ---
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false);
  const initialParamsForLegal = new URLSearchParams(window.location.search);
  const initialViewForLegal = initialParamsForLegal.get('view');
  const isInitialImprint = initialViewForLegal === 'imprint' || initialViewForLegal === 'impressum';
  const isInitialPrivacy = initialViewForLegal === 'privacy' || initialViewForLegal === 'datenschutz';
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(isInitialImprint || isInitialPrivacy);
  const [legalModalTab, setLegalModalTab] = useState<'imprint' | 'privacy'>(
    isInitialPrivacy ? 'privacy' : 'imprint'
  );
  const handleOpenLegal = useCallback((tab: 'imprint' | 'privacy' = 'imprint') => {
    setLegalModalTab(tab);
    setIsLegalModalOpen(true);
  }, []);
  const authRequestSeq = useRef(0);
  const [changeNotifications, setChangeNotifications] = useState<ChangeNotification[]>([]);
  const [membershipDialog, setMembershipDialog] = useState<{ refId: string; title: string; action: MembershipAction } | null>(null);
  const [membershipVersion, setMembershipVersion] = useState(0);

  // --- URL Search Params Initialization ---
  const initialParams = new URLSearchParams(window.location.search);
  const initialViewParam = initialParams.get('view');
  const isExplicitLanding = initialViewParam === 'about' || initialViewParam === 'landing';
  const hasSpecificView = Boolean(
    initialParams.has('semester') ||
    initialParams.get('course') ||
    initialParams.get('repository') ||
    initialParams.get('folder') ||
    initialParams.get('exercise') ||
    initialViewParam === 'my-courses' ||
    initialViewParam === 'calendar'
  );

  const [isLandingOpen, setIsLandingOpen] = useState<boolean>(() => {
    if (isExplicitLanding) return true;
    if (hasSpecificView) return false;
    return !cache.hasCachedSemesterData();
  });

  const [myCourses, setMyCourses] = useState(!isLandingOpen && initialViewParam === 'my-courses');
  const initialRepositoryParam = isLandingOpen || myCourses ? null : initialParams.get('repository');
  const [repositoryId, setRepositoryId] = useState<string | null>(initialRepositoryParam);
  const [isCalendarOpen, setIsCalendarOpen] = useState<boolean>(() => !isLandingOpen && !initialRepositoryParam && !initialParams.get('course') && initialViewParam === 'calendar');
  const initialSemesterParam = initialParams.get('semester');
  const initialCourseParam = isLandingOpen || myCourses ? null : initialParams.get('course');
  const initialFolderParam = isLandingOpen || myCourses ? null : initialParams.get('folder');
  const initialExerciseParam = isLandingOpen || myCourses ? null : initialParams.get('exercise');
  const initialTabParam = initialParams.get('tab');

  // --- Semester & Courses State ---
  const [selectedSemester, setSelectedSemester] = useState<string>(() => {
    return initialSemesterParam || cache.getSelectedSemester();
  });
  const [semesterData, setSemesterData] = useState<SemesterScreenResponse | null>(() => {
    const sem = initialSemesterParam || cache.getSelectedSemester();
    return cache.getCachedSemester(sem);
  });
  const [isLoadingSemester, setIsLoadingSemester] = useState(false);
  const semesterRequestSeq = useRef<number>(0);

  // --- Navigation & Course State (Always land on semester overview when accessing site) ---
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(() => {
    if (initialRepositoryParam) return null;
    return initialCourseParam || null;
  });
  const [isManagingCourse, setIsManagingCourse] = useState(false);
  useEffect(() => { setIsManagingCourse(false); }, [selectedCourseId]);
  const [currentContainerId, setCurrentContainerId] = useState<string | null>(() => {
    if (initialRepositoryParam) return null;
    return initialFolderParam || initialCourseParam || null;
  });
  const [activeExerciseRefId, setActiveExerciseRefId] = useState<string | null>(() => {
    return initialExerciseParam || null;
  });
  const [activeExerciseTab, setActiveExerciseTab] = useState<ExerciseTab | null>(() => {
    if (!initialExerciseParam || !initialTabParam) return null;
    if (initialTabParam === 'info') return 'info';
    if (initialTabParam === 'submissions' || initialTabParam === 'ta_grading' || initialTabParam === 'grades') return 'submissions';
    if (initialTabParam === 'manage') return 'manage';
    if (initialTabParam === 'manage-edit' || initialTabParam === 'edit') return 'manage-edit';
    if (initialTabParam === 'assignments' || initialTabParam === 'overview') return 'assignments';
    return null;
  });

  const [materialsData, setMaterialsData] = useState<CourseMaterialsResponse | null>(() => {
    const containerId = initialFolderParam || initialCourseParam || null;
    return containerId ? cache.getCachedMaterials(containerId) : null;
  });
  const [isRevalidatingMaterials, setIsRevalidatingMaterials] = useState(false);
  const [semesterError, setSemesterError] = useState<string | null>(null);
  const [loadMaterialsError, setLoadMaterialsError] = useState<string | null>(null);
  const materialsRequestSeq = useRef<number>(0);
  const currentNavStateRef = useRef<NavigationState>({
    semester: selectedSemester,
    courseId: selectedCourseId,
    containerId: currentContainerId,
    exerciseId: activeExerciseRefId,
    exerciseTab: activeExerciseTab,
    repositoryId,
    isCalendarOpen,
    myCourses,
    isLandingOpen,
  });
  useEffect(() => {
    currentNavStateRef.current = {
      semester: selectedSemester,
      courseId: selectedCourseId,
      containerId: currentContainerId,
      exerciseId: activeExerciseRefId,
      exerciseTab: activeExerciseTab,
      repositoryId,
      isCalendarOpen,
      myCourses,
      isLandingOpen,
    };
  }, [selectedSemester, selectedCourseId, currentContainerId, activeExerciseRefId, activeExerciseTab, repositoryId, isCalendarOpen, myCourses, isLandingOpen]);
  const activeContainerRef = useRef<string | null>(
    initialFolderParam || initialCourseParam || null
  );

  const [enrolledCourses, setEnrolledCourses] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!selectedCourseId) return;
    let active = true;
    const root = materialsData?.container_ref_id === selectedCourseId
      ? materialsData : cache.getCachedMaterials(selectedCourseId);
    if (root?.is_enrolled != null) setEnrolledCourses((prev) => prev[selectedCourseId] === root.is_enrolled ? prev : ({ ...prev, [selectedCourseId]: root.is_enrolled! }));
    // A direct link to a subfolder may not have loaded its course root yet.
    if (currentContainerId !== selectedCourseId && !root?.membership) {
      api.getMaterials(selectedCourseId).then((data) => {
        if (active) {
          cache.setCachedMaterials(selectedCourseId, data);
          if (data.is_enrolled != null) setEnrolledCourses((prev) => ({ ...prev, [selectedCourseId]: data.is_enrolled! }));
        }
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [selectedCourseId, currentContainerId, materialsData]);

  // --- Sidebar & Modal State ---
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    isLandingOpen && !cache.getSessionId() ? true : cache.getSidebarCollapsed()
  );
  useEffect(() => {
    if (isLandingOpen && authStatus?.authenticated === false) setIsSidebarCollapsed(true);
  }, [isLandingOpen, authStatus?.authenticated]);
  useEffect(() => {
    const connect = () => setIsExtensionModalOpen(true);
    window.addEventListener('betterilias-connect', connect);
    return () => window.removeEventListener('betterilias-connect', connect);
  }, []);
  const [isNicknameModalOpen, setIsNicknameModalOpen] = useState(false);
  const [nicknamesVersion, setNicknamesVersion] = useState(0);
  const effectiveSidebarWidth = Math.min(sidebarWidth, viewportWidth / 2);
  const resizeSidebar = (width: number, save: boolean) => {
    const collapsed = width < SIDEBAR_COLLAPSE_WIDTH;
    setIsSidebarCollapsed(collapsed);
    if (!collapsed) setSidebarWidth(Math.min(Math.max(SIDEBAR_MIN_WIDTH, width), viewportWidth / 2));
    if (save) {
      cache.setSidebarCollapsed(collapsed);
      if (!collapsed) {
        try { localStorage.setItem('betterilias_sidebar_width', String(Math.min(Math.max(SIDEBAR_MIN_WIDTH, width), viewportWidth / 2))); } catch { /* Storage may be disabled. */ }
      }
    }
  };

  // Flat list of all courses across categories
  const allCourses: CourseItem[] = (semesterData?.courses || []).map((course) => ({
    ...course,
    subject: course.subject || Object.entries(semesterData?.grouped_by_category || {}).find(([, courses]) => courses.some((c) => c.ref_id === course.ref_id))?.[0],
  }));

  // --- Check Auth Status ---
  const checkAuth = useCallback(async () => {
    const reqId = ++authRequestSeq.current;
    try {
      const status = await api.getAuthStatus();
      if (reqId === authRequestSeq.current) setAuthStatus(status);
    } catch (e) {
      console.warn('Auth check failed', e);
    }
  }, []);

  // --- Fetch Semester Courses with SWR and Race-Condition Protection ---
  const loadSemesters = useCallback(async (semId: string, forceRefresh: boolean = false) => {
    const reqId = ++semesterRequestSeq.current;
    setIsLoadingSemester(true);
    setSemesterError(null);

    // 1. Immediately read cache or clear stale semester data
    const cached = cache.getCachedSemester(semId);
    if (reqId === semesterRequestSeq.current) {
      setSemesterData(cached);
    }

    // 2. ILIAS Saver: If fresh within TTL and not a forced manual refresh, skip revalidation!
    if (cached && !forceRefresh && cache.isIliasSaverFresh(`ilias_semester_cache_${semId}`)) {
      if (reqId === semesterRequestSeq.current) {
        setIsLoadingSemester(false);
      }
      return;
    }

    // 3. Fetch fresh semester data
    try {
      const fresh = await api.getSemesters(semId);
      const freshCount = fresh?.courses?.length || 0;
      const cachedCount = cached?.courses?.length || 0;

      // Guard: if fresh returned empty courses but we have cached courses, preserve cache!
      if (freshCount > 0 || cachedCount === 0) {
        cache.setCachedSemester(semId, fresh);
        if (reqId === semesterRequestSeq.current) {
          setSemesterData(fresh);
        }
      } else {
        console.warn(`Preserving cached courses for ${semId} because fresh response returned empty`);
        if (reqId === semesterRequestSeq.current && cached) {
          setSemesterData(cached);
        }
      }
    } catch (err) {
      if (reqId === semesterRequestSeq.current) {
        setSemesterError(err instanceof Error ? err.message : t('errors.load_failed'));
        if (cached) {
          setSemesterData(cached);
        }
      }
    } finally {
      if (reqId === semesterRequestSeq.current) {
        setIsLoadingSemester(false);
      }
    }
  }, []);


  // --- Load Course Materials with Instant Serve + SWR Revalidation & Race-Condition Protection ---
  const loadCourseMaterials = useCallback(
    async (refId: string, isCourseRoot: boolean = true, forceRefresh: boolean = false) => {
      const reqId = ++materialsRequestSeq.current;
      activeContainerRef.current = refId;
      setLoadMaterialsError(null);

      // 1. Instant serve from cache (0ms)
      // CRITICAL: If cached data exists for this specific container, serve it immediately.
      // If uncached, set to null so the previous course's contents are NEVER displayed!
      const cached = cache.getCachedMaterials(refId);
      setMaterialsData(cached || null);

      // 2. ILIAS Saver: If fresh within TTL and not a forced manual refresh, skip revalidation!
      if (cached && !forceRefresh && cache.isIliasSaverFresh(MATERIALS_CACHE_PREFIX + refId)) {
        setIsRevalidatingMaterials(false);
        return;
      }

      // 3. Background revalidation
      setIsRevalidatingMaterials(true);
      try {
        const fresh = await api.getMaterials(refId);

        const incomingCount =
          (fresh?.items?.length || 0) +
          (fresh?.sections?.length || 0) +
          (fresh?.sessions?.length || 0) +
          (fresh?.blocks?.length || 0);
        const cachedCount =
          (cached?.items?.length || 0) +
          (cached?.sections?.length || 0) +
          (cached?.sessions?.length || 0) +
          (cached?.blocks?.length || 0);

        // Preserve cached contents after an empty scrape, but respect an explicit loss of membership.
        if (incomingCount === 0 && cachedCount > 0 && fresh.is_enrolled !== false) {
          console.warn(`Preserving cached materials for ${refId} because fresh response was empty`);
          if (reqId === materialsRequestSeq.current && activeContainerRef.current === refId && cached) {
            setMaterialsData(cached);
          }
          return;
        }

        // Always cache fresh result so subsequent loads are instant
        cache.setCachedMaterials(refId, fresh);
        if (isCourseRoot) {
          upsertCourseTreeContainer({
            courseRefId: refId,
            courseTitle: fresh.title || refId,
            materials: fresh,
            parentRefId: null,
            depth: 0,
            path: [fresh.title || refId],
            pathRefIds: [refId],
          });
          const cachedCal = cache.getCachedCalendar('ALL');
          const existingCalCourse = cachedCal?.courses?.find((c) => c.course_ref_id === refId);
          const isChecked =
            existingCalCourse &&
            ['imported_with_lectures', 'imported_deadlines_only', 'valid_empty'].includes(existingCalCourse.status);
          if (!isChecked) {
            api
              .getCalendar()
              .then((cal) => {
                if (cal && (cal.courses.length > 0 || cal.events.length > 0 || !cachedCal)) {
                  cache.setCachedCalendar('ALL', cal);
                }
              })
              .catch(() => {});
          }
        }

        // Discard stale responses from out-of-order network requests
        if (reqId === materialsRequestSeq.current && activeContainerRef.current === refId) {
          // Change detection: compare cached vs fresh to notify user
          if (cached) {
            const detected: ChangeNotification[] = [];

            // 1. Check for newly added materials/files
            const cachedItemIds = new Set(cached.items.map((i) => i.ref_id));
            const newItems = fresh.items.filter((i) => !cachedItemIds.has(i.ref_id));
            for (const item of newItems) {
              detected.push({
                id: `item-${item.ref_id}`,
                type: item.item_type === 'file' ? 'file' : item.item_type === 'mcst' ? 'podcast' : 'general',
                title: item.title,
                subtitle: item.item_type === 'file' ? t("Neue Datei hinzugefügt") : t("Neues Material"),
              });
            }

            // 2. Check for newly added sessions
            const cachedSessionIds = new Set((cached.sessions || []).map((s) => s.ref_id));
            const newSessions = (fresh.sessions || []).filter((s) => !cachedSessionIds.has(s.ref_id));
            for (const s of newSessions) {
              detected.push({
                id: `sess-${s.ref_id}`,
                type: 'session',
                title: s.title,
                subtitle: t('Neuer Vorlesungstermin / Sitzung'),
              });
            }

            // 3. Check for newly added files inside sessions
            const cachedSessionMatIds = new Set(
              (cached.sessions || []).flatMap((s) => s.materials.map((m) => m.ref_id))
            );
            const newSessionMats = (fresh.sessions || []).flatMap((s) =>
              s.materials.filter((m) => !cachedSessionMatIds.has(m.ref_id))
            );
            for (const sm of newSessionMats) {
              detected.push({
                id: `sess-mat-${sm.ref_id}`,
                type: 'file',
                title: sm.title,
                subtitle: t("Neuer Anhang in Sitzung hinterlegt"),
              });
            }

            // 4. Check for new logs
            const cachedLogKeys = new Set(
              (cached.logs || []).map((l) => `${l.title}_${l.target || ''}_${l.date || ''}`)
            );
            const newLogs = (fresh.logs || []).filter(
              (l) => !cachedLogKeys.has(`${l.title}_${l.target || ''}_${l.date || ''}`)
            );
            for (const nl of newLogs) {
              detected.push({
                id: `log-${nl.title}-${nl.date || Date.now()}`,
                type: 'log',
                title: nl.title,
                subtitle: nl.target || nl.date,
              });
            }

            if (detected.length > 0) {
              setChangeNotifications((prev) => [...prev, ...detected]);
            }
          }

          setMaterialsData(fresh);
        }
      } catch (err: any) {
        if (reqId === materialsRequestSeq.current && activeContainerRef.current === refId) {
          console.error(`Error revalidating materials for ${refId}`, err);
          if (cached) {
            setMaterialsData(cached);
          }
          setLoadMaterialsError(err?.message || t("Fehler beim Abrufen der Vorlesungsinhalte"));
        }
      } finally {
        if (reqId === materialsRequestSeq.current) {
          setIsRevalidatingMaterials(false);
        }
      }
    },
    []
  );

  // --- Semester Selection Handler ---
  const handleSelectSemester = useCallback(
    async (semId: string) => {
      if (!await navigationGuard.confirmNavigation()) return;
      if (!isLandingOpen && !myCourses && !repositoryId && semId === selectedSemester && selectedCourseId === null && !activeExerciseRefId) {
        return;
      }
      setIsLandingOpen(false);
      setMyCourses(false);
      setRepositoryId(null);
      materialsRequestSeq.current++;
      activeContainerRef.current = null;
      setSelectedSemester(semId);
      cache.setSelectedSemester(semId);
      setSelectedCourseId(null);
      setCurrentContainerId(null);
      setActiveExerciseRefId(null);
      setActiveExerciseTab(null);
      setMaterialsData(null);
      setLoadMaterialsError(null);
      loadSemesters(semId);

      const nextState: NavigationState = {
        semester: semId,
        courseId: null,
        containerId: null,
        exerciseId: null,
        exerciseTab: null,
        isCalendarOpen,
      };
      pushAppHistory(nextState, '', stateToUrl(nextState));
    },
    [isLandingOpen, myCourses, repositoryId, isCalendarOpen, selectedSemester, selectedCourseId, activeExerciseRefId, loadSemesters]
  );

  // --- Course Selection Handler ---
  const handleSelectCourseAssignment = useCallback(
    async (courseRefId: string, target: CourseAssignmentTarget) => {
      if (!await navigationGuard.confirmNavigation()) return;
      const containerId = target.kind === 'exercise' ? target.containerRefId || courseRefId : target.folderRefId;
      const exerciseId = target.kind === 'exercise' ? target.exerciseRefId : null;
      if (
        !isLandingOpen &&
        courseRefId === selectedCourseId &&
        currentContainerId === containerId &&
        activeExerciseRefId === exerciseId
      ) {
        return;
      }
      setIsLandingOpen(false);
      setMyCourses(false);
      setRepositoryId(null);
      setIsCalendarOpen(false);
      setSelectedCourseId(courseRefId);
      setCurrentContainerId(containerId);
      setActiveExerciseRefId(exerciseId);
      setActiveExerciseTab(null);
      activeContainerRef.current = containerId;
      loadCourseMaterials(containerId, containerId === courseRefId);

      const nextState: NavigationState = {
        semester: selectedSemester,
        courseId: courseRefId,
        containerId,
        exerciseId,
        exerciseTab: null,
      };
      pushAppHistory(nextState, '', stateToUrl(nextState));
      setMobileNavigationOpen(false);
    },
    [isLandingOpen, selectedCourseId, currentContainerId, activeExerciseRefId, selectedSemester, loadCourseMaterials]
  );
  const handleSelectCourse = useCallback(
    async (courseRefId: string) => {
      if (!await navigationGuard.confirmNavigation()) return;
      if (
        !isLandingOpen &&
        courseRefId === selectedCourseId &&
        currentContainerId === courseRefId &&
        !activeExerciseRefId
      ) {
        return;
      }
      setIsLandingOpen(false);
      setMyCourses(false);
      setRepositoryId(null);
      setIsCalendarOpen(false);
      setSelectedCourseId(courseRefId);
      setCurrentContainerId(courseRefId);
      setActiveExerciseRefId(null);
      setActiveExerciseTab(null);
      activeContainerRef.current = courseRefId;
      loadCourseMaterials(courseRefId, true);

      const nextState: NavigationState = {
        semester: selectedSemester,
        courseId: courseRefId,
        containerId: courseRefId,
        exerciseId: null,
        exerciseTab: null,
      };
      pushAppHistory(nextState, '', stateToUrl(nextState));
    },
    [isLandingOpen, selectedCourseId, currentContainerId, activeExerciseRefId, selectedSemester, loadCourseMaterials]
  );

  // --- Subfolder Navigation Handler ---
  const handleNavigateFolder = useCallback(
    async (folderRefId: string) => {
      if (!await navigationGuard.confirmNavigation()) return;
      if (!selectedCourseId) return;
      if (folderRefId === currentContainerId && !activeExerciseRefId) return;

      setCurrentContainerId(folderRefId);
      setActiveExerciseRefId(null);
      setActiveExerciseTab(null);
      activeContainerRef.current = folderRefId;
      loadCourseMaterials(folderRefId, false);

      const nextState: NavigationState = {
        semester: selectedSemester,
        courseId: selectedCourseId,
        containerId: folderRefId,
        exerciseId: null,
        exerciseTab: null,
      };
      pushAppHistory(nextState, '', stateToUrl(nextState));
    },
    [selectedCourseId, currentContainerId, activeExerciseRefId, selectedSemester, loadCourseMaterials]
  );

  // --- Return to Course Root ---
  const handleNavigateCourseRoot = useCallback(
    async (courseRefId: string) => {
      if (!await navigationGuard.confirmNavigation()) return;
      if (currentContainerId === courseRefId && !activeExerciseRefId) return;

      setCurrentContainerId(courseRefId);
      setActiveExerciseRefId(null);
      setActiveExerciseTab(null);
      activeContainerRef.current = courseRefId;
      loadCourseMaterials(courseRefId, true);

      const nextState: NavigationState = {
        semester: selectedSemester,
        courseId: courseRefId,
        containerId: courseRefId,
        exerciseId: null,
        exerciseTab: null,
      };
      pushAppHistory(nextState, '', stateToUrl(nextState));
    },
    [currentContainerId, activeExerciseRefId, selectedSemester, loadCourseMaterials]
  );

  // --- Return to Semester Overview ---
  const handleNavigateHome = useCallback(async () => {
    if (!await navigationGuard.confirmNavigation()) return false;
    if (!isLandingOpen && !myCourses && !repositoryId && !isCalendarOpen && selectedCourseId === null && !activeExerciseRefId) return true;
    setIsLandingOpen(false);
    setMyCourses(false);
    setRepositoryId(null);
    setIsCalendarOpen(false);

    materialsRequestSeq.current++;
    activeContainerRef.current = null;
    setSelectedCourseId(null);
    setCurrentContainerId(null);
    setActiveExerciseRefId(null);
    setActiveExerciseTab(null);
    setMaterialsData(null);
    setLoadMaterialsError(null);

    const nextState: NavigationState = {
      semester: selectedSemester,
      courseId: null,
      containerId: null,
      exerciseId: null,
      exerciseTab: null,
    };
    pushAppHistory(nextState, '', stateToUrl(nextState));
    return true;
  }, [isLandingOpen, myCourses, repositoryId, isCalendarOpen, selectedCourseId, activeExerciseRefId, selectedSemester]);

  // --- Open App from Landing ---
  const handleOpenApp = useCallback(async () => {
    if (await handleNavigateHome()) cache.markVisited();
  }, [handleNavigateHome]);

  const handleNavigateLanding = useCallback(async () => {
    if (!await navigationGuard.confirmNavigation()) return;
    setIsLandingOpen(true);
    setMyCourses(false);
    setRepositoryId(null);
    setIsCalendarOpen(false);
    setSelectedCourseId(null);
    setCurrentContainerId(null);
    setActiveExerciseRefId(null);
    setActiveExerciseTab(null);
    setMaterialsData(null);
    setLoadMaterialsError(null);
    const nextState: NavigationState = {
      semester: selectedSemester,
      courseId: null,
      containerId: null,
      exerciseId: null,
      isLandingOpen: true,
    };
    pushAppHistory(nextState, '', stateToUrl(nextState));
  }, [selectedSemester]);

  const handleEscapeBack = useCallback(async (): Promise<boolean> => {
    if ((appHistoryDepth() ?? 0) === 0) return handleNavigateHome();
    if (!await navigationGuard.confirmNavigation()) return false;
    // The popstate handler must not ask a second time for a pending upload.
    approvedHistoryNavigation.current = true;
    return new Promise(resolve => {
      const finish = () => { window.clearTimeout(timeout); resolve(true); };
      const timeout = window.setTimeout(() => {
        window.removeEventListener('popstate', finish);
        approvedHistoryNavigation.current = false;
        resolve(false);
      }, 1500);
      window.addEventListener('popstate', finish, { once: true });
      window.history.back();
    });
  }, [handleNavigateHome]);
  useEscapeNavigation(handleEscapeBack, handleNavigateHome);

  const handleNavigateCalendar = useCallback(async () => {
    if (!await navigationGuard.confirmNavigation()) return;
    setIsLandingOpen(false);
    if (isCalendarOpen && !myCourses && !repositoryId && selectedCourseId === null) return;
    setMyCourses(false);
    setRepositoryId(null);
    setIsCalendarOpen(true);
    materialsRequestSeq.current++;
    activeContainerRef.current = null;
    setSelectedCourseId(null);
    setCurrentContainerId(null);
    setActiveExerciseRefId(null);
    setActiveExerciseTab(null);
    setMaterialsData(null);
    setLoadMaterialsError(null);
    const nextState: NavigationState = {
      semester: selectedSemester,
      courseId: null,
      containerId: null,
      exerciseId: null,
      exerciseTab: null,
      isCalendarOpen: true,
    };
    pushAppHistory(nextState, '', stateToUrl(nextState));
  }, [isCalendarOpen, myCourses, repositoryId, selectedCourseId, selectedSemester]);

  const handleNavigateRepository = useCallback(async (refId: string) => {
    if (!await navigationGuard.confirmNavigation()) return;
    setIsLandingOpen(false);
    if (repositoryId === refId) return;
    cache.rememberRepositoryPath(materialsData?.breadcrumbs || []);
    materialsRequestSeq.current++;
    activeContainerRef.current = null;
    setMyCourses(false);
    setRepositoryId(refId);
    setIsCalendarOpen(false);
    setSelectedCourseId(null);
    setCurrentContainerId(null);
    setActiveExerciseRefId(null);
    setActiveExerciseTab(null);
    setMaterialsData(null);
    setLoadMaterialsError(null);
    const nextState: NavigationState = {
      semester: selectedSemester, courseId: null, containerId: null, exerciseId: null,
      exerciseTab: null,
      repositoryId: refId,
    };
    pushAppHistory(nextState, '', stateToUrl(nextState));
  }, [repositoryId, selectedSemester, materialsData]);

  const handleNavigateMyCourses = useCallback(async () => {
    if (!await navigationGuard.confirmNavigation() || myCourses) return;
    setIsLandingOpen(false);
    materialsRequestSeq.current++;
    activeContainerRef.current = null;
    setMyCourses(true);
    setRepositoryId(null);
    setIsCalendarOpen(false);
    setSelectedCourseId(null);
    setCurrentContainerId(null);
    setActiveExerciseRefId(null);
    setActiveExerciseTab(null);
    setMaterialsData(null);
    setLoadMaterialsError(null);
    const state: NavigationState = { semester: selectedSemester, courseId: null,
      containerId: null, exerciseId: null, myCourses: true };
    pushAppHistory(state, '', stateToUrl(state));
  }, [myCourses, selectedSemester]);

  // --- Exercise View Handler ---
  const handleSelectExercise = useCallback(
    async (exerciseRefId: string | null, tab: ExerciseTab | null = null) => {
      if (exerciseRefId !== activeExerciseRefId && !await navigationGuard.confirmNavigation()) return;
      if (exerciseRefId === activeExerciseRefId && tab === activeExerciseTab) return;

      if (exerciseRefId === null) {
        if (window.history.state?.exerciseId) {
          window.history.back();
          return;
        }
      }

      setActiveExerciseRefId(exerciseRefId);
      setActiveExerciseTab(tab);
      const nextState: NavigationState = {
        semester: selectedSemester,
        courseId: selectedCourseId,
        containerId: currentContainerId,
        exerciseId: exerciseRefId,
        exerciseTab: tab,
      };
      pushAppHistory(nextState, '', stateToUrl(nextState));
    },
    [activeExerciseRefId, activeExerciseTab, selectedSemester, selectedCourseId, currentContainerId]
  );

  const handleExerciseTabChange = useCallback(
    async (tab: ExerciseTab) => {
      if (tab !== activeExerciseTab && !await navigationGuard.confirmNavigation()) return;
      if (tab === activeExerciseTab) return;
      setActiveExerciseTab(tab);
      const nextState: NavigationState = {
        semester: selectedSemester,
        courseId: selectedCourseId,
        containerId: currentContainerId,
        exerciseId: activeExerciseRefId,
        exerciseTab: tab,
      };
      pushAppHistory(nextState, '', stateToUrl(nextState));
    },
    [activeExerciseTab, selectedSemester, selectedCourseId, currentContainerId, activeExerciseRefId]
  );

  // --- Initial Mount Effect & History Priming ---
  useEffect(() => {
    // Session links have already been imported before the first render.
    // Prime History Stack
    const currentState: NavigationState = {
      isLandingOpen,
      repositoryId,
      myCourses,
      isCalendarOpen,
      semester: selectedSemester,
      courseId: selectedCourseId,
      containerId: currentContainerId,
      exerciseId: activeExerciseRefId,
      exerciseTab: activeExerciseTab,
    };

    if (appHistoryDepth() === null) {
      if (selectedCourseId || repositoryId || myCourses || isCalendarOpen) {
        // Give deep links an in-app overview entry so Back/Escape never leave the app.
        const baseState: NavigationState = {
          semester: selectedSemester,
          courseId: null,
          containerId: null,
          exerciseId: null,
          exerciseTab: null,
        };
        replaceAppHistory(baseState, '', stateToUrl(baseState));
        pushAppHistory(currentState, '', stateToUrl(currentState));
      } else {
        replaceAppHistory(currentState, '', stateToUrl(currentState));
      }
    }

    const handleSession = (event: Event) => {
      const authenticated = (event as CustomEvent<boolean>).detail;
      ++authRequestSeq.current;
      setAuthStatus((previous) => ({
        ...previous,
        authenticated,
        cookies_present: authenticated || Boolean(previous?.cookies_present) || Boolean(cache.getSessionId()),
        user_name: authenticated ? previous?.user_name : undefined,
      }));
    };

    const reloadContent = () => {
      checkAuth();
      loadSemesters(selectedSemester);
      if (currentContainerId) {
        loadCourseMaterials(currentContainerId, currentContainerId === selectedCourseId);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.source === window && event.origin === window.location.origin && event.data?.type === 'BETTERILIAS_SESSION_SYNCED' && event.data?.sessionId) {
        const changed = localStorage.getItem('betterilias_cache_owner') !== event.data.sessionId;
        cache.setSessionId(event.data.sessionId);
        if (changed) { window.location.reload(); return; }
        reloadContent();
      }
    };

    const handleCustomSync = (event: Event) => {
      const customEvt = event as CustomEvent<{ sessionId?: string }>;
      if (customEvt.detail?.sessionId) {
        const changed = localStorage.getItem('betterilias_cache_owner') !== customEvt.detail.sessionId;
        cache.setSessionId(customEvt.detail.sessionId);
        if (changed) { window.location.reload(); return; }
        reloadContent();
      }
    };

    theme.initTheme();
    window.addEventListener('ilias-session', handleSession);
    window.addEventListener('message', handleMessage);
    document.addEventListener('BETTERILIAS_SESSION_SYNCED', handleCustomSync);
    window.addEventListener('focus', checkAuth);
    checkAuth();

    loadSemesters(selectedSemester);

    // If there is an active container, load its materials
    if (currentContainerId) {
      loadCourseMaterials(currentContainerId, currentContainerId === selectedCourseId);
    }

    return () => {
      ++authRequestSeq.current;
      window.removeEventListener('ilias-session', handleSession);
      window.removeEventListener('message', handleMessage);
      document.removeEventListener('BETTERILIAS_SESSION_SYNCED', handleCustomSync);
      window.removeEventListener('focus', checkAuth);
    };
  }, [checkAuth, loadSemesters, loadCourseMaterials]);

  // --- History Navigation & PopState Effect ---
  useEffect(() => {
    const handlePopState = async (event: PopStateEvent) => {
      const approved = approvedHistoryNavigation.current;
      approvedHistoryNavigation.current = false;
      if (!approved && !await navigationGuard.confirmNavigation()) {
        const current = currentNavStateRef.current;
        pushAppHistory(current, '', stateToUrl(current));
        return;
      }
      const state: NavigationState =
        (event.state as NavigationState) || parseStateFromUrl(cache.getSelectedSemester());

      setIsLandingOpen(Boolean(state.isLandingOpen));
      setMyCourses(Boolean(state.myCourses));
      setRepositoryId(state.repositoryId || null);
      setIsCalendarOpen(Boolean(state.isCalendarOpen));

      // 1. Update semester if changed
      if (state.semester) {
        setSelectedSemester(state.semester);
        cache.setSelectedSemester(state.semester);
        loadSemesters(state.semester);
      }

      // 2. Update exercise & tab
      setActiveExerciseRefId(state.exerciseId || null);
      setActiveExerciseTab(state.exerciseTab || null);

      // 3. Update course & container
      if (state.courseId && state.containerId) {
        setSelectedCourseId(state.courseId);
        setCurrentContainerId(state.containerId);
        activeContainerRef.current = state.containerId;

        // Instant serve from cache (0ms) + SWR revalidate
        loadCourseMaterials(state.containerId, state.containerId === state.courseId);
      } else {
        // Return to Semester Overview
        materialsRequestSeq.current++;
        activeContainerRef.current = null;
        setSelectedCourseId(null);
        setCurrentContainerId(null);
        setMaterialsData(null);
        setLoadMaterialsError(null);
      }
    };

    // Close any open modal on Mouse 4 (Back) if modal is open
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        if (isNicknameModalOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsNicknameModalOpen(false);
          return;
        }
        if (isExtensionModalOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsExtensionModalOpen(false);
          return;
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [loadSemesters, loadCourseMaterials, isNicknameModalOpen, isExtensionModalOpen]);

  // --- Logout Handler ---
  const handleLogout = async () => {
    try {
      await api.logout();
      setAuthStatus({ authenticated: false, cookies_present: false });
    } catch (err: any) {
      console.error('Logout error', err);
      setAuthStatus({ authenticated: false, cookies_present: false });
    }
  };

  useConnectionRetry(() => {
    void checkAuth();
    void loadSemesters(selectedSemester, true);
    if (currentContainerId) void loadCourseMaterials(currentContainerId, false, true);
  });

  // --- Toggle Sidebar ---
  const handleToggleSidebar = () => {
    if (isMobile) {
      setMobileNavigationOpen(open => !open);
      return;
    }
    const next = !isSidebarCollapsed;
    setIsSidebarCollapsed(next);
    cache.setSidebarCollapsed(next);
  };

  const currentCourse = allCourses.find((c) => c.ref_id === selectedCourseId);
  const courseTitle = currentCourse?.title
    || materialsData?.breadcrumbs.find((b) => b.ref_id === selectedCourseId)?.title
    || (selectedCourseId ? cache.getCachedMaterials(selectedCourseId)?.title : '')
    || (currentContainerId === selectedCourseId ? materialsData?.title : '')
    || '';
  const currentNickname = selectedCourseId
    ? cache.getDisplayName(selectedCourseId, courseTitle)
    : '';

  // --- Dynamic Document Title ---
  useEffect(() => {
    if (isLandingOpen) {
      document.title = t("BetterIlias – Das moderne Lernportal");
    } else if (myCourses) {
      document.title = `BetterIlias – ${t('my_courses.title')}`;
    } else if (repositoryId) {
      document.title = t("BetterIlias - Magazin");
    } else if (isCalendarOpen) {
      document.title = `BetterIlias – ${t("calendar.title")} (${selectedSemester})`;
    } else if (activeExerciseRefId) {
      document.title = t("BetterIlias – Übungen ({p0})", { p0: currentNickname || currentCourse?.title || t('Vorlesung') });
    } else if (selectedCourseId) {
      const courseTitle = currentNickname || currentCourse?.title || t("Vorlesung");
      const folderTitle =
        currentContainerId && currentContainerId !== selectedCourseId && materialsData?.title
          ? ` – ${materialsData.title}`
          : '';
      document.title = t("BetterIlias – {p0}{p1}", { p0: courseTitle, p1: folderTitle });
    } else {
      document.title = t("BetterIlias – {p0} Vorlesungsübersicht", { p0: selectedSemester });
    }
  }, [
    language,
    isLandingOpen,
    myCourses,
    repositoryId,
    activeExerciseRefId,
    selectedCourseId,
    currentContainerId,
    currentNickname,
    currentCourse,
    materialsData,
    selectedSemester,
  ]);

  // Enforce strict container matching so CourseView NEVER receives data from a different lecture/container
  const isMatchingContainer =
    materialsData !== null && materialsData.container_ref_id === currentContainerId;
  const effectiveMaterialsData = isMatchingContainer ? materialsData : null;

  const navigatePin = async (pin: SidebarPin) => {
    if (!await navigationGuard.confirmNavigation()) return;
    const url = new URL(pin.href, location.href);
    const courseId = url.searchParams.get('course');
    if (!courseId) return;
    const containerId = url.searchParams.get('folder') || courseId;
    const exerciseId = url.searchParams.get('exercise');
    setIsLandingOpen(false); setMyCourses(false); setRepositoryId(null); setIsCalendarOpen(false);
    setSelectedCourseId(courseId); setCurrentContainerId(containerId);
    setActiveExerciseRefId(exerciseId); setActiveExerciseTab(null);
    activeContainerRef.current = containerId;
    loadCourseMaterials(containerId, containerId === courseId);
    const state: NavigationState = { semester: selectedSemester, courseId, containerId, exerciseId };
    pushAppHistory(state, '', pin.href);
    setMobileNavigationOpen(false);
    if (url.hash) requestAnimationFrame(() => {
      try { document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ block: 'start' }); }
      catch { /* Ignore malformed saved anchors. */ }
    });
  };

  const sidebar = <Sidebar
    width={effectiveSidebarWidth}
    onSelectPin={navigatePin}
    semester={selectedSemester}
    courses={allCourses}
    selectedCourseId={selectedCourseId}
    onSelectCourse={refId => { handleSelectCourse(refId); setMobileNavigationOpen(false); }}
    onSelectCourseAssignment={(courseRefId, target) => { handleSelectCourseAssignment(courseRefId, target); }}
    onSelectSemesterOverview={() => { handleNavigateHome(); setMobileNavigationOpen(false); }}
    onSelectRepository={() => { handleNavigateRepository('1'); setMobileNavigationOpen(false); }}
    onSelectMyCourses={() => { handleNavigateMyCourses(); setMobileNavigationOpen(false); }}
    isMyCoursesSelected={myCourses}
    isRepositorySelected={repositoryId !== null}
    onSelectCalendar={() => { handleNavigateCalendar(); setMobileNavigationOpen(false); }}
    isCalendarSelected={isCalendarOpen}
    isCollapsed={isMobile ? false : isSidebarCollapsed}
    onToggleCollapse={isMobile ? () => setMobileNavigationOpen(false) : handleToggleSidebar}
    onOpenNicknameModal={() => { setMobileNavigationOpen(false); setIsNicknameModalOpen(true); }}
    nicknamesVersion={nicknamesVersion}
    isMobile={isMobile}
  />;

  return (
    <SidebarPinsProvider><div className="app-shell flex w-full flex-col bg-slate-50 dark:bg-slate-950 overflow-hidden text-slate-900 dark:text-slate-100 font-sans transition-colors duration-150">
      {/* Top Header */}
      <Header
        authStatus={authStatus}
        onHomeClick={handleNavigateHome}
        onOpenLanding={handleNavigateLanding}
        onToggleSidebar={handleToggleSidebar}
        isSidebarCollapsed={isMobile ? !mobileNavigationOpen : isSidebarCollapsed}
        onLogout={handleLogout}
        onOpenExtensionInfo={() => setIsExtensionModalOpen(true)}
        onOpenLegal={handleOpenLegal}
      />

      {/* Main Workspace Layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar */}
        {isMobile ? <dialog ref={mobileNavigation} id="course-navigation" aria-label={t("Meine Vorlesungen")}
          className="mobile-navigation border-0 bg-white p-0 text-slate-900 dark:bg-slate-900 dark:text-slate-100 backdrop:bg-slate-900/60"
          onCancel={() => setMobileNavigationOpen(false)}
          onClick={event => { if (event.target === event.currentTarget) setMobileNavigationOpen(false); }}>
          {sidebar}
        </dialog> : <div id="course-navigation" className="relative flex shrink-0">{sidebar}
          <SidebarResizer width={effectiveSidebarWidth} collapsed={isSidebarCollapsed} maximum={viewportWidth / 2} onResize={resizeSidebar} />
        </div>}

        {/* Center Content Area */}
        <div className="flex min-w-0 flex-1 flex-col">
        <main ref={workspaceRef} className={`@container/workspace min-w-0 flex-1 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/50 ${workspaceWidth < 768 ? 'workspace-compact' : ''}`}>
          <WorkspaceWidth.Provider value={workspaceWidth}>
          {isLandingOpen ? (
            <LandingView
              onOpenApp={handleOpenApp}
              onOpenExtensionInfo={() => setIsExtensionModalOpen(true)}
              isAuthenticated={Boolean(authStatus?.authenticated)}
              onOpenLegal={handleOpenLegal}
            />
          ) : myCourses ? (
            <MyCoursesView key={`${cache.getSessionId()}_${membershipVersion}`} onOpenCourse={handleSelectCourse}
              onOpenGroup={handleNavigateRepository} />
          ) : repositoryId ? (
            <RepositoryView key={`${repositoryId}_${membershipVersion}`} refId={repositoryId} onNavigate={handleNavigateRepository} onOpenCourse={handleSelectCourse}
              onManageMembership={(refId, title, action) => setMembershipDialog({ refId, title, action })} />
          ) : selectedCourseId && currentContainerId ? (
            <CourseView
              managementMode={isManagingCourse}
              onManagementModeChange={setIsManagingCourse}
              key={`${selectedCourseId}_${currentContainerId}`}
              courseRefId={selectedCourseId}
              courseNickname={currentNickname}
              materialsData={effectiveMaterialsData}
              membership={(effectiveMaterialsData?.container_ref_id === selectedCourseId ? effectiveMaterialsData : cache.getCachedMaterials(selectedCourseId))?.membership}
              onManageMembership={(action) => setMembershipDialog({ refId: selectedCourseId, title: currentNickname, action })}
              onNavigateFolder={handleNavigateFolder}
              onNavigateHome={handleNavigateHome}
              onNavigateRepository={handleNavigateRepository}
              onNavigateSemester={(enrolledCourses[selectedCourseId] ?? allCourses.some((c) => c.ref_id === selectedCourseId))
                ? handleSelectSemester : undefined}
              onNavigateCourseRoot={handleNavigateCourseRoot}
              activeExerciseRefId={activeExerciseRefId}
              activeExerciseTab={activeExerciseTab}
              onSelectExercise={handleSelectExercise}
              onExerciseTabChange={handleExerciseTabChange}
              isRevalidating={isRevalidatingMaterials}
              onManualRefresh={() => loadCourseMaterials(currentContainerId, false, true)}
              onNotifyChange={(notifs) => setChangeNotifications((prev) => [...prev, ...notifs])}
              loadError={loadMaterialsError}
            />
          ) : isCalendarOpen ? (
            <CalendarView
              selectedSemester={selectedSemester}
              coursesList={allCourses}
              onSelectCourse={handleSelectCourse}
            />
          ) : (
            <>
            {semesterError && <div className="p-4"><ErrorNotice message={semesterError} onRetry={() => loadSemesters(selectedSemester, true)} /></div>}
            <SemesterView
              semesterData={semesterData}
              selectedSemester={selectedSemester}
              onSelectSemester={handleSelectSemester}
              onSelectCourse={handleSelectCourse}
              onSelectCourseAssignment={handleSelectCourseAssignment}
              coursesList={allCourses}
              isLoading={isLoadingSemester}
              onManualRefresh={() => loadSemesters(selectedSemester, true)}
              onOpenCalendar={handleNavigateCalendar}
            /></>
          )}
          </WorkspaceWidth.Provider>
        </main>
        <ConnectionNotice auth={authStatus} landing={isLandingOpen} onConnect={() => setIsExtensionModalOpen(true)} />
        </div>
      </div>

      {/* Voluntary course membership */}
      {membershipDialog && <CourseMembershipModal key={`${membershipDialog.refId}_${membershipDialog.action}`} {...membershipDialog}
        onClose={() => setMembershipDialog(null)}
        onChanged={(result) => {
          const refId = membershipDialog.refId;
          cache.invalidateCourseMembership(refId);
          setEnrolledCourses((prev) => {
            const next = { ...prev };
            if (result.is_enrolled != null) next[refId] = result.is_enrolled;
            else delete next[refId];
            return next;
          });
          setMembershipVersion((v) => v + 1);
          loadSemesters(selectedSemester);
          if (selectedCourseId === refId && activeContainerRef.current === currentContainerId) {
            if (membershipDialog.action === 'leave' && result.is_enrolled === false) {
              const path = materialsData?.breadcrumbs || [];
              const courseIndex = path.findIndex((b) => b.ref_id === refId);
              const parent = (courseIndex >= 0 ? path.slice(0, courseIndex) : path).filter((b) => b.ref_id).at(-1);
              if (parent?.ref_id) handleNavigateRepository(parent.ref_id);
              else handleNavigateHome();
            } else if (currentContainerId !== refId) handleNavigateCourseRoot(refId);
            else loadCourseMaterials(refId, true);
          }
          setChangeNotifications((prev) => [...prev, { id: `membership-${Date.now()}`, type: 'general', title: result.message }]);
          setMembershipDialog(null);
        }} />}

      {/* Nickname & Icon Editor Modal */}
      <NicknameModal
        semester={selectedSemester}
        courses={allCourses}
        isOpen={isNicknameModalOpen}
        onClose={() => setIsNicknameModalOpen(false)}
        onNicknamesUpdated={() => setNicknamesVersion((v) => v + 1)}
      />

      {/* Extension Info Modal */}
      <ExtensionInfoModal
        isOpen={isExtensionModalOpen}
        onClose={() => setIsExtensionModalOpen(false)}
        onSuccessSync={checkAuth}
      />

      {/* VS Code-style Bottom-Right Change Notification */}
      {changeNotifications.length > 0 && (
        <NotificationToast
          notifications={changeNotifications}
          onDismiss={() => setChangeNotifications([])}
        />
      )}

      {/* Global Download Progress Bar & Dock */}
      <DownloadProgressBar />

      {/* Legal & Privacy Policy Modal */}
      <LegalModal
        isOpen={isLegalModalOpen}
        onClose={() => setIsLegalModalOpen(false)}
        initialTab={legalModalTab}
      />

      {/* Global Confirmation & Alert Dialog */}
      <ConfirmModal />
    </div></SidebarPinsProvider>
  );
};
export default App;
