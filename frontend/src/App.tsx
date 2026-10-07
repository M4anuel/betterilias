import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { SemesterView } from './components/SemesterView';
import { CourseView } from './components/CourseView';
import { NicknameModal } from './components/NicknameModal';
import { NotificationToast, ChangeNotification } from './components/NotificationToast';
import {
  AuthStatus,
  CourseItem,
  CourseMaterialsResponse,
  SemesterScreenResponse,
} from './types';
import { api } from './lib/api';
import { cache } from './lib/cache';

export const App: React.FC = () => {
  // --- Auth & Session State ---
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const authRequestSeq = useRef(0);
  const [changeNotifications, setChangeNotifications] = useState<ChangeNotification[]>([]);

  // --- Semester & Courses State ---
  const [semesterData, setSemesterData] = useState<SemesterScreenResponse | null>(() => {
    const sem = cache.getSelectedSemester();
    const raw = localStorage.getItem(`ilias_semester_cache_${sem}`);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
    return null;
  });
  const [isLoadingSemester, setIsLoadingSemester] = useState(false);
  const [selectedSemester, setSelectedSemester] = useState<string>(() =>
    cache.getSelectedSemester()
  );
  const semesterRequestSeq = useRef<number>(0);

  // --- Navigation & Course State ---
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(() =>
    cache.getLastOpenedCourseId()
  );
  const [currentContainerId, setCurrentContainerId] = useState<string | null>(() =>
    cache.getLastOpenedCourseId()
  );
  const [materialsData, setMaterialsData] = useState<CourseMaterialsResponse | null>(() => {
    const lastId = cache.getLastOpenedCourseId();
    return lastId ? cache.getCachedMaterials(lastId) : null;
  });
  const [isRevalidatingMaterials, setIsRevalidatingMaterials] = useState(false);
  const [loadMaterialsError, setLoadMaterialsError] = useState<string | null>(null);
  const materialsRequestSeq = useRef<number>(0);
  const activeContainerRef = useRef<string | null>(cache.getLastOpenedCourseId());

  // --- Sidebar & Modal State ---
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    cache.getSidebarCollapsed()
  );
  const [isNicknameModalOpen, setIsNicknameModalOpen] = useState(false);
  const [nicknamesVersion, setNicknamesVersion] = useState(0);

  // Flat list of all courses across categories
  const allCourses: CourseItem[] = semesterData?.courses || [];

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
    const cacheKey = `ilias_semester_cache_${semId}`;

    // 1. Immediately read cache or clear stale semester data
    let cached: SemesterScreenResponse | null = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) cached = JSON.parse(raw);
    } catch {}

    if (reqId === semesterRequestSeq.current) {
      setSemesterData(cached);
    }

    // 2. Fetch fresh semester data
    try {
      const fresh = await api.getSemesters(semId);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(fresh));
      } catch {}

      if (reqId === semesterRequestSeq.current) {
        setSemesterData(fresh);
      }
    } catch (err) {
      if (reqId === semesterRequestSeq.current) {
        console.error('Error fetching semester data', err);
      }
    } finally {
      if (reqId === semesterRequestSeq.current) {
        setIsLoadingSemester(false);
      }
    }
  }, []);

  // --- Semester Selection Handler ---
  const handleSelectSemester = useCallback(
    (semId: string) => {
      setSelectedSemester(semId);
      cache.setSelectedSemester(semId);
      loadSemesters(semId);
    },
    [loadSemesters]
  );

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
                subtitle: item.item_type === 'file' ? 'Neue Datei hinzugefügt' : 'Neues Material',
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
                subtitle: 'Neuer Vorlesungstermin / Sitzung',
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
                subtitle: 'Neuer Anhang in Sitzung hinterlegt',
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
          setLoadMaterialsError(err?.message || 'Fehler beim Abrufen der Vorlesungsinhalte');
        }
      } finally {
        if (reqId === materialsRequestSeq.current) {
          setIsRevalidatingMaterials(false);
        }
      }
    },
    []
  );

  // --- Initial Mount Effect ---
  useEffect(() => {
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
    window.addEventListener('ilias-session', handleSession);
    window.addEventListener('focus', checkAuth);
    checkAuth();
    const initialSemester = cache.getSelectedSemester();
    loadSemesters(initialSemester);

    // If there is a last opened course, load it instantly
    const initialCourseId = cache.getLastOpenedCourseId();
    if (initialCourseId) {
      loadCourseMaterials(initialCourseId, true);
    }
    return () => {
      ++authRequestSeq.current;
      window.removeEventListener('ilias-session', handleSession);
      window.removeEventListener('focus', checkAuth);
    };
  }, [checkAuth, loadSemesters, loadCourseMaterials]);

  // --- Course Selection Handler ---
  const handleSelectCourse = (courseRefId: string) => {
    setSelectedCourseId(courseRefId);
    setCurrentContainerId(courseRefId);
    activeContainerRef.current = courseRefId;
    cache.setLastOpenedCourseId(courseRefId);
    loadCourseMaterials(courseRefId, true);
  };

  // --- Subfolder Navigation Handler ---
  const handleNavigateFolder = (folderRefId: string) => {
    setCurrentContainerId(folderRefId);
    activeContainerRef.current = folderRefId;
    loadCourseMaterials(folderRefId, false);
  };

  // --- Return to Course Root ---
  const handleNavigateCourseRoot = (courseRefId: string) => {
    setCurrentContainerId(courseRefId);
    activeContainerRef.current = courseRefId;
    loadCourseMaterials(courseRefId, true);
  };

  // --- Return to Semester Overview ---
  const handleNavigateHome = () => {
    materialsRequestSeq.current++;
    activeContainerRef.current = null;
    setSelectedCourseId(null);
    setCurrentContainerId(null);
    cache.setLastOpenedCourseId(null);
    setMaterialsData(null);
    setLoadMaterialsError(null);
  };

  // --- Toggle Sidebar ---
  const handleToggleSidebar = () => {
    const next = !isSidebarCollapsed;
    setIsSidebarCollapsed(next);
    cache.setSidebarCollapsed(next);
  };

  // --- Trigger Playwright Login ---
  const handleTriggerLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await api.triggerBrowserLogin();
      if (!result.success) throw new Error(result.message || 'Anmeldung fehlgeschlagen');
      ++authRequestSeq.current;
      setAuthStatus({ authenticated: true, cookies_present: true });
      loadSemesters(selectedSemester);
    } catch (err: any) {
      alert(`Login Fehler: ${err.message}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const currentCourse = allCourses.find((c) => c.ref_id === selectedCourseId);
  const currentNickname = selectedCourseId
    ? cache.getDisplayName(selectedCourseId, currentCourse?.title || materialsData?.title || '')
    : '';

  // Enforce strict container matching so CourseView NEVER receives data from a different lecture/container
  const isMatchingContainer =
    materialsData !== null && materialsData.container_ref_id === currentContainerId;
  const effectiveMaterialsData = isMatchingContainer ? materialsData : null;

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-50 overflow-hidden text-slate-900 font-sans">
      {/* Top Header */}
      <Header
        authStatus={authStatus}
        onHomeClick={handleNavigateHome}
        onToggleSidebar={handleToggleSidebar}
        isSidebarCollapsed={isSidebarCollapsed}
        onTriggerLogin={handleTriggerLogin}
        isLoggingIn={isLoggingIn}
      />

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          courses={allCourses}
          selectedCourseId={selectedCourseId}
          onSelectCourse={handleSelectCourse}
          onSelectSemesterOverview={handleNavigateHome}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          onOpenNicknameModal={() => setIsNicknameModalOpen(true)}
          nicknamesVersion={nicknamesVersion}
        />

        {/* Center Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-50/50">
          {selectedCourseId && currentContainerId ? (
            <CourseView
              key={`${selectedCourseId}_${currentContainerId}`}
              courseRefId={selectedCourseId}
              courseNickname={currentNickname}
              materialsData={effectiveMaterialsData}
              onNavigateFolder={handleNavigateFolder}
              onNavigateHome={handleNavigateHome}
              onNavigateCourseRoot={handleNavigateCourseRoot}
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

      {/* Nickname & Icon Editor Modal */}
      <NicknameModal
        courses={allCourses}
        isOpen={isNicknameModalOpen}
        onClose={() => setIsNicknameModalOpen(false)}
        onNicknamesUpdated={() => setNicknamesVersion((v) => v + 1)}
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
