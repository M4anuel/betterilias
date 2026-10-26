import { t, useLanguage } from './lib/i18n';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AlertCircle, ExternalLink, Puzzle } from 'lucide-react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { SemesterView } from './components/SemesterView';
import { CourseView } from './components/CourseView';
import { RepositoryView } from './components/RepositoryView';
import { CourseMembershipModal } from './components/CourseMembershipModal';
import { NicknameModal } from './components/NicknameModal';
import { ExtensionInfoModal } from './components/ExtensionInfoModal';
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
import { cache } from './lib/cache';
import { theme } from './lib/theme';

export interface NavigationState {
  semester: string;
  courseId: string | null;
  containerId: string | null;
  exerciseId: string | null;
  exerciseTab?: ExerciseTab | null;
  repositoryId?: string | null;
}

export function stateToUrl(state: NavigationState): string {
  const params = new URLSearchParams();
  if (state.repositoryId) {
    params.set('repository', state.repositoryId);
  } else if (state.courseId) {
    params.set('course', state.courseId);
    if (state.containerId && state.containerId !== state.courseId) {
      params.set('folder', state.containerId);
    }
    if (state.exerciseId) {
      params.set('exercise', state.exerciseId);
      if (state.exerciseTab && state.exerciseTab !== 'assignments') {
        params.set('tab', state.exerciseTab);
      }
    }
  } else {
    if (state.semester) {
      params.set('semester', state.semester);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : window.location.pathname;
}

export function parseStateFromUrl(defaultSemester: string): NavigationState {
  const params = new URLSearchParams(window.location.search);
  const repositoryId = params.get('repository');
  const courseId = repositoryId ? null : params.get('course');
  const folderId = repositoryId ? null : params.get('folder');
  const exerciseId = repositoryId ? null : params.get('exercise');
  const tabParam = repositoryId ? null : params.get('tab');
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
    courseId: courseId || null,
    containerId: folderId || courseId || null,
    exerciseId: exerciseId || null,
    exerciseTab,
  };
}

export const App: React.FC = () => {
  const language = useLanguage();
  // --- Auth & Session State ---
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false);
  const authRequestSeq = useRef(0);
  const [changeNotifications, setChangeNotifications] = useState<ChangeNotification[]>([]);
  const [membershipDialog, setMembershipDialog] = useState<{ refId: string; title: string; action: MembershipAction } | null>(null);
  const [membershipVersion, setMembershipVersion] = useState(0);

  // --- URL Search Params Initialization ---
  const initialParams = new URLSearchParams(window.location.search);
  const initialRepositoryParam = initialParams.get('repository');
  const [repositoryId, setRepositoryId] = useState<string | null>(initialRepositoryParam);
  const initialSemesterParam = initialParams.get('semester');
  const initialCourseParam = initialParams.get('course');
  const initialFolderParam = initialParams.get('folder');
  const initialExerciseParam = initialParams.get('exercise');
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

  // --- Navigation & Course State ---
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(() => {
    if (initialRepositoryParam) return null;
    if (initialCourseParam) return initialCourseParam;
    if (!initialSemesterParam && !initialRepositoryParam) {
      return cache.getLastOpenedCourseId();
    }
    return null;
  });
  const [currentContainerId, setCurrentContainerId] = useState<string | null>(() => {
    if (initialRepositoryParam) return null;
    if (initialFolderParam) return initialFolderParam;
    if (initialCourseParam) return initialCourseParam;
    if (!initialSemesterParam && !initialRepositoryParam) {
      return cache.getLastOpenedCourseId();
    }
    return null;
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
    const containerId =
      initialFolderParam ||
      initialCourseParam ||
      (!initialSemesterParam && !initialRepositoryParam ? cache.getLastOpenedCourseId() : null);
    return containerId ? cache.getCachedMaterials(containerId) : null;
  });
  const [isRevalidatingMaterials, setIsRevalidatingMaterials] = useState(false);
  const [loadMaterialsError, setLoadMaterialsError] = useState<string | null>(null);
  const materialsRequestSeq = useRef<number>(0);
  const activeContainerRef = useRef<string | null>(
    initialFolderParam ||
      initialCourseParam ||
      (!initialSemesterParam && !initialRepositoryParam ? cache.getLastOpenedCourseId() : null)
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
    cache.getSidebarCollapsed()
  );
  const [isNicknameModalOpen, setIsNicknameModalOpen] = useState(false);
  const [nicknamesVersion, setNicknamesVersion] = useState(0);

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
  const loadSemesters = useCallback(async (semId: string) => {
    const reqId = ++semesterRequestSeq.current;
    setIsLoadingSemester(true);

    // 1. Immediately read cache or clear stale semester data
    const cached = cache.getCachedSemester(semId);
    if (reqId === semesterRequestSeq.current) {
      setSemesterData(cached);
    }

    // 2. Fetch fresh semester data
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
        console.error('Error fetching semester data', err);
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
    async (refId: string, isCourseRoot: boolean = true) => {
      const reqId = ++materialsRequestSeq.current;
      activeContainerRef.current = refId;
      setLoadMaterialsError(null);

      // 1. Instant serve from cache (0ms)
      // CRITICAL: If cached data exists for this specific container, serve it immediately.
      // If uncached, set to null so the previous course's contents are NEVER displayed!
      const cached = cache.getCachedMaterials(refId);
      setMaterialsData(cached || null);

      // 2. Background revalidation
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
    (semId: string) => {
      if (!repositoryId && semId === selectedSemester && selectedCourseId === null && !activeExerciseRefId) {
        return;
      }
      setRepositoryId(null);
      materialsRequestSeq.current++;
      activeContainerRef.current = null;
      setSelectedSemester(semId);
      cache.setSelectedSemester(semId);
      setSelectedCourseId(null);
      setCurrentContainerId(null);
      setActiveExerciseRefId(null);
      setActiveExerciseTab(null);
      cache.setLastOpenedCourseId(null);
      setMaterialsData(null);
      setLoadMaterialsError(null);
      loadSemesters(semId);

      const nextState: NavigationState = {
        semester: semId,
        courseId: null,
        containerId: null,
        exerciseId: null,
        exerciseTab: null,
      };
      window.history.pushState(nextState, '', stateToUrl(nextState));
    },
    [repositoryId, selectedSemester, selectedCourseId, activeExerciseRefId, loadSemesters]
  );

  // --- Course Selection Handler ---
  const handleSelectCourse = useCallback(
    (courseRefId: string) => {
      if (
        courseRefId === selectedCourseId &&
        currentContainerId === courseRefId &&
        !activeExerciseRefId
      ) {
        return;
      }
      setRepositoryId(null);
      setSelectedCourseId(courseRefId);
      setCurrentContainerId(courseRefId);
      setActiveExerciseRefId(null);
      setActiveExerciseTab(null);
      activeContainerRef.current = courseRefId;
      cache.setLastOpenedCourseId(courseRefId);
      loadCourseMaterials(courseRefId, true);

      const nextState: NavigationState = {
        semester: selectedSemester,
        courseId: courseRefId,
        containerId: courseRefId,
        exerciseId: null,
        exerciseTab: null,
      };
      window.history.pushState(nextState, '', stateToUrl(nextState));
    },
    [selectedCourseId, currentContainerId, activeExerciseRefId, selectedSemester, loadCourseMaterials]
  );

  // --- Subfolder Navigation Handler ---
  const handleNavigateFolder = useCallback(
    (folderRefId: string) => {
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
      window.history.pushState(nextState, '', stateToUrl(nextState));
    },
    [selectedCourseId, currentContainerId, activeExerciseRefId, selectedSemester, loadCourseMaterials]
  );

  // --- Return to Course Root ---
  const handleNavigateCourseRoot = useCallback(
    (courseRefId: string) => {
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
      window.history.pushState(nextState, '', stateToUrl(nextState));
    },
    [currentContainerId, activeExerciseRefId, selectedSemester, loadCourseMaterials]
  );

  // --- Return to Semester Overview ---
  const handleNavigateHome = useCallback(() => {
    if (!repositoryId && selectedCourseId === null && !activeExerciseRefId) return;
    setRepositoryId(null);

    materialsRequestSeq.current++;
    activeContainerRef.current = null;
    setSelectedCourseId(null);
    setCurrentContainerId(null);
    setActiveExerciseRefId(null);
    setActiveExerciseTab(null);
    cache.setLastOpenedCourseId(null);
    setMaterialsData(null);
    setLoadMaterialsError(null);

    const nextState: NavigationState = {
      semester: selectedSemester,
      courseId: null,
      containerId: null,
      exerciseId: null,
      exerciseTab: null,
    };
    window.history.pushState(nextState, '', stateToUrl(nextState));
  }, [repositoryId, selectedCourseId, activeExerciseRefId, selectedSemester]);

  const handleNavigateRepository = useCallback((refId: string) => {
    if (repositoryId === refId) return;
    cache.rememberRepositoryPath(materialsData?.breadcrumbs || []);
    materialsRequestSeq.current++;
    activeContainerRef.current = null;
    setRepositoryId(refId);
    setSelectedCourseId(null);
    setCurrentContainerId(null);
    setActiveExerciseRefId(null);
    setActiveExerciseTab(null);
    setMaterialsData(null);
    setLoadMaterialsError(null);
    cache.setLastOpenedCourseId(null);
    const nextState: NavigationState = {
      semester: selectedSemester, courseId: null, containerId: null, exerciseId: null,
      exerciseTab: null,
      repositoryId: refId,
    };
    window.history.pushState(nextState, '', stateToUrl(nextState));
  }, [repositoryId, selectedSemester, materialsData]);

  // --- Exercise View Handler ---
  const handleSelectExercise = useCallback(
    (exerciseRefId: string | null, tab: ExerciseTab | null = null) => {
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
      window.history.pushState(nextState, '', stateToUrl(nextState));
    },
    [activeExerciseRefId, activeExerciseTab, selectedSemester, selectedCourseId, currentContainerId]
  );

  const handleExerciseTabChange = useCallback(
    (tab: ExerciseTab) => {
      if (tab === activeExerciseTab) return;
      setActiveExerciseTab(tab);
      const nextState: NavigationState = {
        semester: selectedSemester,
        courseId: selectedCourseId,
        containerId: currentContainerId,
        exerciseId: activeExerciseRefId,
        exerciseTab: tab === 'assignments' ? null : tab,
      };
      window.history.pushState(nextState, '', stateToUrl(nextState));
    },
    [activeExerciseTab, selectedSemester, selectedCourseId, currentContainerId, activeExerciseRefId]
  );

  // --- Initial Mount Effect & History Priming ---
  useEffect(() => {
    // Session links have already been imported before the first render.
    // Prime History Stack
    const currentState: NavigationState = {
      repositoryId,
      semester: selectedSemester,
      courseId: selectedCourseId,
      containerId: currentContainerId,
      exerciseId: activeExerciseRefId,
      exerciseTab: activeExerciseTab,
    };

    if (!window.history.state) {
      if (selectedCourseId) {
        // If cold-loaded directly into a course (via last opened course or URL),
        // prime the base history entry with Semester Overview so Mouse 4 / Back navigates to it!
        const baseState: NavigationState = {
          semester: selectedSemester,
          courseId: null,
          containerId: null,
          exerciseId: null,
          exerciseTab: null,
        };
        window.history.replaceState(baseState, '', stateToUrl(baseState));
        window.history.pushState(currentState, '', stateToUrl(currentState));
      } else {
        window.history.replaceState(currentState, '', stateToUrl(currentState));
      }
    }

    const handleSession = (event: Event) => {
      const authenticated = (event as CustomEvent<boolean>).detail;
      ++authRequestSeq.current;
      setAuthStatus((previous) => ({
        ...previous,
        authenticated,
        cookies_present: authenticated,
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
      if (event.data?.type === 'BETTERILIAS_SESSION_SYNCED' && event.data?.sessionId) {
        cache.setSessionId(event.data.sessionId);
        reloadContent();
      }
    };

    const handleCustomSync = (event: Event) => {
      const customEvt = event as CustomEvent<{ sessionId?: string }>;
      if (customEvt.detail?.sessionId) {
        cache.setSessionId(customEvt.detail.sessionId);
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
    const handlePopState = (event: PopStateEvent) => {
      const state: NavigationState =
        (event.state as NavigationState) || parseStateFromUrl(cache.getSelectedSemester());

      setRepositoryId(state.repositoryId || null);

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
        cache.setLastOpenedCourseId(state.courseId);

        // Instant serve from cache (0ms) + SWR revalidate
        loadCourseMaterials(state.containerId, state.containerId === state.courseId);
      } else {
        // Return to Semester Overview
        materialsRequestSeq.current++;
        activeContainerRef.current = null;
        setSelectedCourseId(null);
        setCurrentContainerId(null);
        cache.setLastOpenedCourseId(null);
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

  // --- Toggle Sidebar ---
  const handleToggleSidebar = () => {
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
    if (repositoryId) {
      document.title = t("BetterIlias - Magazin");
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

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-50 dark:bg-slate-950 overflow-hidden text-slate-900 dark:text-slate-100 font-sans transition-colors duration-150">
      {/* Top Header */}
      <Header
        authStatus={authStatus}
        onHomeClick={handleNavigateHome}
        onToggleSidebar={handleToggleSidebar}
        isSidebarCollapsed={isSidebarCollapsed}
        onLogout={handleLogout}
        onOpenExtensionInfo={() => setIsExtensionModalOpen(true)}
      />

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          courses={allCourses}
          selectedCourseId={selectedCourseId}
          onSelectCourse={handleSelectCourse}
          onSelectSemesterOverview={handleNavigateHome}
          onSelectRepository={() => handleNavigateRepository('1')}
          isRepositorySelected={repositoryId !== null}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          onOpenNicknameModal={() => setIsNicknameModalOpen(true)}
          nicknamesVersion={nicknamesVersion}
        />

        {/* Center Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/50">
          {authStatus && !authStatus.authenticated && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 shadow-2xs dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  <strong>{t("Sitzung nicht aktiv:")}</strong> {t("Du bist aktuell nicht bei ILIAS angemeldet. Gespeicherte Inhalte werden aus dem Cache angezeigt.")}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href="https://ilias.unibe.ch"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 shadow-2xs hover:bg-amber-100 transition dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-slate-800"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>{t("Bei ILIAS anmelden")}</span>
                </a>
                <button
                  type="button"
                  onClick={() => setIsExtensionModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0AACA5] px-2.5 py-1 text-xs font-semibold text-white shadow-2xs hover:opacity-90 transition cursor-pointer"
                >
                  <Puzzle className="h-3.5 w-3.5" />
                  <span>{t("Browser-Erweiterung")}</span>
                </button>
              </div>
            </div>
          )}
          {repositoryId ? (
            <RepositoryView key={`${repositoryId}_${membershipVersion}`} refId={repositoryId} onNavigate={handleNavigateRepository} onOpenCourse={handleSelectCourse}
              onManageMembership={(refId, title, action) => setMembershipDialog({ refId, title, action })} />
          ) : selectedCourseId && currentContainerId ? (
            <CourseView
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
              onManualRefresh={() => loadCourseMaterials(currentContainerId, false)}
              onNotifyChange={(notifs) => setChangeNotifications((prev) => [...prev, ...notifs])}
              loadError={loadMaterialsError}
            />
          ) : (
            <SemesterView
              semesterData={semesterData}
              selectedSemester={selectedSemester}
              onSelectSemester={handleSelectSemester}
              onSelectCourse={handleSelectCourse}
              lastOpenedCourseId={cache.getLastOpenedCourseId()}
              coursesList={allCourses}
              isLoading={isLoadingSemester}
            />
          )}
        </main>
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
    </div>
  );
};
export default App;
