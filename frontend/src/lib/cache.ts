import {
  CourseMaterialsResponse,
  ExerciseOverviewResponse,
  ExerciseSubmissionsResponse,
  ExerciseInfoResponse,
  StudentAssignmentDetail,
  SemesterScreenResponse,
  BreadcrumbItem,
  RepositoryLocation,
  RepositoryResponse,
  SidebarOrderItem,
  ManagementResponse,
  TAAssignmentListResponse,
} from '../types';
import { getDefaultCourseIcon } from './courseIcons';
import { getCurrentSemester } from './semesterUtils';
import { t } from './i18n';

export type ContentSectionId =
  | 'folders'
  | 'files'
  | 'podcasts'
  | 'sessions'
  | 'exercises'
  | 'richtext'
  | 'sections';

export interface CourseBlocksCustomization {
  layoutHash: string;
  blockOrder: string[];
  hiddenBlockIds?: string[];
  showAllFilesBlock?: boolean;
}

export const DEFAULT_SECTION_ORDER: ContentSectionId[] = [
  'folders',
  'files',
  'podcasts',
  'sessions',
  'exercises',
  'richtext',
  'sections',
];

const CONTENT_SECTION_ORDER_KEY = 'ilias_content_section_order';
const NICKNAMES_KEY = 'ilias_course_nicknames';
const COURSE_ICONS_KEY = 'ilias_course_icons';
const SELECTED_SEMESTER_KEY = 'ilias_selected_semester';
const SEMESTER_START_KEY = 'ilias_semester_start';
const LAST_OPENED_KEY = 'ilias_last_opened_course';
const SIDEBAR_COLLAPSED_KEY = 'ilias_sidebar_collapsed';
const SIDEBAR_ORDER_KEY = 'ilias_sidebar_order';
export const MATERIALS_CACHE_PREFIX = 'ilias_materials_cache_';
export const SEMESTER_CACHE_PREFIX = 'ilias_semester_cache_';
export const EXERCISE_OVERVIEW_PREFIX = 'ilias_exercise_overview_';
export const EXERCISE_SUBMISSIONS_PREFIX = 'ilias_exercise_submissions_';
export const EXERCISE_INFO_PREFIX = 'ilias_exercise_info_';
export const STUDENT_ASSIGNMENT_PREFIX = 'ilias_student_assignment_';
export const CACHE_TS_PREFIX = 'ilias_ts_';
export const MANAGEMENT_CACHE_PREFIX = 'ilias_management_';
export const TA_ASSIGNMENTS_CACHE_PREFIX = 'ilias_ta_assignments_';
export const ILIAS_SAVER_ENABLED_KEY = 'betterilias_saver_enabled';
export const ILIAS_SAVER_TTL_KEY = 'betterilias_saver_ttl';
const SESSION_ID_KEY = 'betterilias_session_id';
let inMemorySessionId: string | null = null;

export const cache = {
  // --- Multi-Tenant Session ID ---
  getSessionId(): string | null {
    try {
      return localStorage.getItem(SESSION_ID_KEY) || inMemorySessionId;
    } catch {
      return inMemorySessionId;
    }
  },

  setSessionId(sessionId: string | null) {
    inMemorySessionId = sessionId?.trim() || null;
    try {
      if (sessionId && sessionId.trim()) {
        localStorage.setItem(SESSION_ID_KEY, sessionId.trim());
      } else {
        localStorage.removeItem(SESSION_ID_KEY);
      }
    } catch (e) {
      console.error('Failed to update session ID', e);
    }
  },

  clearSessionContent() {
    try {
      const prefixes = ['ilias_materials_cache_', 'ilias_semester_cache_', 'ilias_podcast_cache_', CACHE_TS_PREFIX,
        EXERCISE_OVERVIEW_PREFIX, EXERCISE_SUBMISSIONS_PREFIX, EXERCISE_INFO_PREFIX, STUDENT_ASSIGNMENT_PREFIX, 'ilias_repository_', MANAGEMENT_CACHE_PREFIX, TA_ASSIGNMENTS_CACHE_PREFIX];
      for (const key of Object.keys(localStorage)) {
        if (prefixes.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key);
      }
      localStorage.removeItem(LAST_OPENED_KEY);
    } catch { /* Storage can be disabled in private browsers. */ }
  },

  // --- ILIAS Saver & Cache Timestamping ---
  getIliasSaverEnabled(): boolean {
    try {
      return localStorage.getItem(ILIAS_SAVER_ENABLED_KEY) === 'true';
    } catch {
      return false;
    }
  },

  setIliasSaverEnabled(enabled: boolean) {
    try {
      localStorage.setItem(ILIAS_SAVER_ENABLED_KEY, enabled ? 'true' : 'false');
      window.dispatchEvent(new CustomEvent('betterilias-saver-changed', { detail: { enabled } }));
    } catch (e) {
      console.error('Failed to save ILIAS Saver setting', e);
    }
  },

  getIliasSaverTtl(): number {
    try {
      const stored = localStorage.getItem(ILIAS_SAVER_TTL_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch {
      // fallback
    }
    return 5; // default 5 minutes
  },

  setIliasSaverTtl(minutes: number) {
    try {
      localStorage.setItem(ILIAS_SAVER_TTL_KEY, String(minutes));
      window.dispatchEvent(new CustomEvent('betterilias-saver-changed', { detail: { ttl: minutes } }));
    } catch (e) {
      console.error('Failed to save ILIAS Saver TTL', e);
    }
  },

  setCacheTimestamp(key: string, timestamp: number = Date.now()) {
    try {
      localStorage.setItem(`${CACHE_TS_PREFIX}${key}`, String(timestamp));
    } catch (e) {
      console.warn('Failed to save cache timestamp', e);
    }
  },

  getCacheTimestamp(key: string): number | null {
    try {
      const raw = localStorage.getItem(`${CACHE_TS_PREFIX}${key}`);
      return raw ? parseInt(raw, 10) : null;
    } catch {
      return null;
    }
  },

  isIliasSaverFresh(key: string): boolean {
    if (!this.getIliasSaverEnabled()) return false;
    const ts = this.getCacheTimestamp(key);
    if (!ts) return false;
    const ttlMs = this.getIliasSaverTtl() * 60 * 1000;
    return Date.now() - ts < ttlMs;
  },

  // --- Nicknames ---
  getNicknames(): Record<string, string> {
    try {
      const data = localStorage.getItem(NICKNAMES_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  },

  setNickname(refId: string, nickname: string) {
    try {
      const current = this.getNicknames();
      if (nickname.trim()) {
        current[refId] = nickname.trim();
      } else {
        delete current[refId];
      }
      localStorage.setItem(NICKNAMES_KEY, JSON.stringify(current));
    } catch (e) {
      console.error('Failed to save nickname', e);
    }
  },

  getDisplayName(refId: string, officialTitle: string): string {
    const nicknames = this.getNicknames();
    if (nicknames[refId]) {
      return nicknames[refId];
    }
    // Clean default title by trimming course code if helpful
    // e.g., "2414-HS2026-0: Mensch-Maschine-Schnittstelle" -> "Mensch-Maschine-Schnittstelle"
    const colonIdx = officialTitle.indexOf(': ');
    if (colonIdx > 0 && colonIdx < 25) {
      return officialTitle.slice(colonIdx + 2).trim();
    }
    return officialTitle;
  },

  // --- Course Icons ---
  getCourseIcons(): Record<string, string> {
    try {
      const data = localStorage.getItem(COURSE_ICONS_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  },

  setCourseIcon(refId: string, iconName: string) {
    try {
      const current = this.getCourseIcons();
      if (iconName) {
        current[refId] = iconName;
      } else {
        delete current[refId];
      }
      localStorage.setItem(COURSE_ICONS_KEY, JSON.stringify(current));
    } catch (e) {
      console.error('Failed to save course icon', e);
    }
  },

  getDefaultCourseIcon(refId: string, context?: { subject?: string; faculty?: string; breadcrumbs?: BreadcrumbItem[] }): string {
    const path = context?.breadcrumbs || this.getCachedMaterials(refId)?.breadcrumbs || this.getRepositoryLocation(refId)?.breadcrumbs || [];
    return getDefaultCourseIcon([context?.subject || '', context?.faculty || '', ...path.map((b) => b.title)]);
  },

  getCourseIcon(refId: string, context?: { subject?: string; faculty?: string; breadcrumbs?: BreadcrumbItem[] }): string {
    const icons = this.getCourseIcons();
    return icons[refId] || this.getDefaultCourseIcon(refId, context);
  },

  // --- Selected Semester ---
  getSelectedSemester(): string {
    try {
      const stored = localStorage.getItem(SELECTED_SEMESTER_KEY);
      if (stored) return stored;
    } catch {
      // fallback
    }
    return getCurrentSemester();
  },

  // --- Semester Custom Start (e.g. Studienbeginn) ---
  getSemesterStart(): string | null {
    try {
      return localStorage.getItem(SEMESTER_START_KEY) || null;
    } catch {
      return null;
    }
  },

  setSemesterStart(semesterId: string | null) {
    try {
      if (semesterId) {
        localStorage.setItem(SEMESTER_START_KEY, semesterId);
      } else {
        localStorage.removeItem(SEMESTER_START_KEY);
      }
    } catch (e) {
      console.error('Failed to save semester start preference', e);
    }
  },

  setSelectedSemester(semesterId: string) {
    try {
      localStorage.setItem(SELECTED_SEMESTER_KEY, semesterId);
    } catch (e) {
      console.error('Failed to save selected semester', e);
    }
  },

  // --- Semester View Mode (Cards vs Compact List) ---
  getSemesterViewMode(): 'cards' | 'list' {
    try {
      return (localStorage.getItem('ilias_semester_view_mode') as 'cards' | 'list') || 'cards';
    } catch {
      return 'cards';
    }
  },

  setSemesterViewMode(mode: 'cards' | 'list') {
    try {
      localStorage.setItem('ilias_semester_view_mode', mode);
    } catch (e) {
      console.error('Failed to save semester view mode', e);
    }
  },

  // --- Content Section Order (Customizable Layout) ---
  getContentSectionOrder(): ContentSectionId[] {
    try {
      const raw = localStorage.getItem(CONTENT_SECTION_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const set = new Set<ContentSectionId>(parsed);
          const fullOrder = [...parsed];
          for (const s of DEFAULT_SECTION_ORDER) {
            if (!set.has(s)) fullOrder.push(s);
          }
          return fullOrder;
        }
      }
    } catch {
      // fallback
    }
    return DEFAULT_SECTION_ORDER;
  },

  setContentSectionOrder(order: ContentSectionId[]) {
    try {
      localStorage.setItem(CONTENT_SECTION_ORDER_KEY, JSON.stringify(order));
    } catch (e) {
      console.error('Failed to save content section order', e);
    }
  },

  // --- Per-Course Content Blocks Customization & Order ---
  getCourseBlocksCustomization(courseRefId: string): CourseBlocksCustomization | null {
    try {
      const raw = localStorage.getItem(`ilias_course_blocks_order_${courseRefId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCourseBlocksCustomization(courseRefId: string, custom: CourseBlocksCustomization) {
    try {
      localStorage.setItem(`ilias_course_blocks_order_${courseRefId}`, JSON.stringify(custom));
    } catch (e) {
      console.error('Failed to save course blocks customization', e);
    }
  },

  clearCourseBlocksCustomization(courseRefId: string) {
    try {
      localStorage.removeItem(`ilias_course_blocks_order_${courseRefId}`);
    } catch (e) {
      console.error('Failed to clear course blocks customization', e);
    }
  },

  // --- Per-Course Drawers Open/Closed State Persistence ---
  getCourseDrawersState(courseRefId: string): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(`ilias_course_drawers_${courseRefId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  setCourseDrawersState(courseRefId: string, state: Record<string, boolean>) {
    try {
      localStorage.setItem(`ilias_course_drawers_${courseRefId}`, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save course drawers state', e);
    }
  },


  // --- Last Opened Course ---
  getLastOpenedCourseId(): string | null {
    try {
      return localStorage.getItem(LAST_OPENED_KEY);
    } catch {
      return null;
    }
  },

  setLastOpenedCourseId(refId: string | null) {
    try {
      if (refId) {
        localStorage.setItem(LAST_OPENED_KEY, refId);
      } else {
        localStorage.removeItem(LAST_OPENED_KEY);
      }
    } catch (e) {
      console.error('Failed to save last opened course', e);
    }
  },

  // --- Sidebar State ---
  getSidebarCollapsed(): boolean {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  },

  setSidebarCollapsed(collapsed: boolean) {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save sidebar state', e);
    }
  },

  // --- Sidebar Custom Order & Sections ---
  getSidebarOrder(): SidebarOrderItem[] | null {
    try {
      const raw = localStorage.getItem(SIDEBAR_ORDER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  },

  setSidebarOrder(order: SidebarOrderItem[] | null) {
    try {
      if (order && order.length > 0) {
        localStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(order));
      } else {
        localStorage.removeItem(SIDEBAR_ORDER_KEY);
      }
    } catch (e) {
      console.error('Failed to save sidebar order', e);
    }
  },

  clearSidebarOrder() {
    try {
      localStorage.removeItem(SIDEBAR_ORDER_KEY);
    } catch (e) {
      console.error('Failed to clear sidebar order', e);
    }
  },

  // --- Semester Courses Cache ---
  getCachedSemester(semId: string): SemesterScreenResponse | null {
    try {
      const raw = localStorage.getItem(`ilias_semester_cache_${semId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCachedSemester(semId: string, data: SemesterScreenResponse) {
    try {
      const existing = this.getCachedSemester(semId);
      const existingCount = existing?.courses?.length || 0;
      const incomingCount = data?.courses?.length || 0;

      // GUARD: Never overwrite populated cache with empty response!
      if (existingCount > 0 && incomingCount === 0) {
        console.warn(`Prevented overwriting populated semester cache for ${semId} with empty data`);
        return;
      }

      localStorage.setItem(`ilias_semester_cache_${semId}`, JSON.stringify(data));
      this.setCacheTimestamp(`ilias_semester_cache_${semId}`);
    } catch (e) {
      console.warn('Storage quota exceeded for semester cache', e);
    }
  },

  // --- Repository pages and paths known before their contents are loaded ---
  getCachedRepository(refId: string): RepositoryResponse | null {
    try {
      const raw = localStorage.getItem(`ilias_repository_${this.getSessionId() || 'default'}_${refId}`);
      const data = raw ? JSON.parse(raw) : null;
      return data?.container_ref_id === refId && Array.isArray(data.items) ? data : null;
    } catch {
      return null;
    }
  },

  getRepositoryLocation(refId: string): RepositoryLocation | null {
    const page = this.getCachedRepository(refId);
    if (page) return page;
    try {
      const raw = localStorage.getItem(`ilias_repository_path_${this.getSessionId() || 'default'}_${refId}`);
      const location = raw ? JSON.parse(raw) : null;
      if (location?.container_ref_id === refId && Array.isArray(location.breadcrumbs)) return location;
    } catch { /* Navigation also works when storage is unavailable. */ }
    return refId === '1' ? { container_ref_id: '1', title: t('Magazin'), breadcrumbs: [] } : null;
  },

  rememberRepositoryPath(breadcrumbs: BreadcrumbItem[]) {
    try {
      const scope = this.getSessionId() || 'default';
      breadcrumbs.forEach((crumb, index) => {
        if (!crumb.ref_id) return;
        const location: RepositoryLocation = {
          container_ref_id: crumb.ref_id, title: crumb.title,
          breadcrumbs: breadcrumbs.slice(0, index + 1),
        };
        localStorage.setItem(`ilias_repository_path_${scope}_${crumb.ref_id}`, JSON.stringify(location));
      });
    } catch (e) {
      console.warn('Could not cache repository path', e);
    }
  },

  setCachedRepository(data: RepositoryResponse) {
    // Some ILIAS pages include the current node in the path; others omit it.
    const currentIndex = data.breadcrumbs.findIndex((b) => b.ref_id === data.container_ref_id);
    const ancestors = currentIndex < 0 ? data.breadcrumbs : data.breadcrumbs.slice(0, currentIndex);
    const path = [...ancestors, { ref_id: data.container_ref_id, title: data.title }];
    this.rememberRepositoryPath(path);
    data.items.filter((item) => ['cat', 'fold', 'grp', 'crs'].includes(item.item_type)).forEach((item) => {
      this.rememberRepositoryPath([...path, { ref_id: item.ref_id, title: item.title }]);
    });
    try {
      localStorage.setItem(`ilias_repository_${this.getSessionId() || 'default'}_${data.container_ref_id}`, JSON.stringify(data));
      this.setCacheTimestamp(`ilias_repository_${this.getSessionId() || 'default'}_${data.container_ref_id}`);
    } catch (e) {
      console.warn('Could not cache repository page', e);
    }
  },

  invalidateCourseMembership(refId: string) {
    try {
      const repositoryPrefix = `ilias_repository_${this.getSessionId() || 'default'}_`;
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('ilias_semester_cache_')) localStorage.removeItem(key);
        if (key.startsWith(MATERIALS_CACHE_PREFIX)) {
          const page = JSON.parse(localStorage.getItem(key) || 'null');
          if (page?.container_ref_id === refId || page?.breadcrumbs?.some((b: BreadcrumbItem) => b.ref_id === refId)) localStorage.removeItem(key);
        }
        if (key.startsWith(repositoryPrefix)) {
          const page = JSON.parse(localStorage.getItem(key) || 'null');
          if (page?.items?.some((item: { ref_id: string }) => item.ref_id === refId)) localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.warn('Could not invalidate course membership caches', e);
    }
  },

  // --- Course Materials Cache (Instant Serving) ---
  invalidateManagedMaterials(refIds: string[]) {
    for (const refId of new Set(refIds)) {
      try {
        localStorage.removeItem(MATERIALS_CACHE_PREFIX + refId);
        localStorage.removeItem(CACHE_TS_PREFIX + MATERIALS_CACHE_PREFIX + refId);
      } catch { /* A fresh request still updates the visible page when storage is unavailable. */ }
    }
  },

  getCachedMaterials(refId: string): CourseMaterialsResponse | null {
    try {
      const raw = localStorage.getItem(MATERIALS_CACHE_PREFIX + refId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCachedMaterials(refId: string, data: CourseMaterialsResponse) {
    try {
      const existing = this.getCachedMaterials(refId);
      const incomingCount =
        (data?.items?.length || 0) +
        (data?.sections?.length || 0) +
        (data?.sessions?.length || 0) +
        (data?.blocks?.length || 0);
      const existingCount =
        (existing?.items?.length || 0) +
        (existing?.sections?.length || 0) +
        (existing?.sessions?.length || 0) +
        (existing?.blocks?.length || 0);

      // An empty scrape preserves content; an explicit loss of membership replaces it.
      if (existingCount > 0 && incomingCount === 0 && data.is_enrolled !== false) {
        console.warn(
          `Prevented overwriting populated course materials cache for ${refId} with empty data`
        );
        return;
      }

      localStorage.setItem(MATERIALS_CACHE_PREFIX + refId, JSON.stringify(data));
      this.setCacheTimestamp(MATERIALS_CACHE_PREFIX + refId);
    } catch (e) {
      console.warn('Storage quota exceeded for course materials cache', e);
    }
  },

  // --- Podcast Series Cache ---
  getCachedPodcasts(refId: string): any | null {
    try {
      const raw = localStorage.getItem('ilias_podcast_cache_' + refId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCachedPodcasts(refId: string, data: any) {
    try {
      const existing = this.getCachedPodcasts(refId);
      const incomingCount = (data?.episodes?.length || 0) + (data?.clips?.length || 0);
      const existingCount = (existing?.episodes?.length || 0) + (existing?.clips?.length || 0);

      // GUARD: Never overwrite populated cache with empty response!
      if (existingCount > 0 && incomingCount === 0) {
        console.warn(
          `Prevented overwriting populated podcast cache for ${refId} with empty data`
        );
        return;
      }

      localStorage.setItem('ilias_podcast_cache_' + refId, JSON.stringify(data));
      this.setCacheTimestamp('ilias_podcast_cache_' + refId);
    } catch (e) {
      console.warn('Storage quota exceeded for podcast cache', e);
    }
  },

  // --- Accumulated Course Logs Cache ---
  getAccumulatedLogs(courseId: string): any[] {
    try {
      const raw = localStorage.getItem('ilias_course_logs_' + courseId);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  mergeAccumulatedLogs(courseId: string, newLogs: any[]): any[] {
    try {
      const existing = this.getAccumulatedLogs(courseId);
      const seen = new Set<string>();
      const merged: any[] = [];

      // Add new logs first (newest first)
      for (const item of newLogs || []) {
        const key = `${item.title}_${item.target || ''}_${item.date || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }

      // Add existing older logs
      for (const item of existing || []) {
        const key = `${item.title}_${item.target || ''}_${item.date || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }

      localStorage.setItem('ilias_course_logs_' + courseId, JSON.stringify(merged));
      return merged;
    } catch (e) {
      console.warn('Failed to merge logs', e);
      return newLogs || [];
    }
  },

  // --- Stale-While-Revalidate Helper ---
  async fetchWithSWR<T>(
    cacheKey: string,
    fetcher: () => Promise<T>,
    onCached: (cached: T) => void,
    onFresh: (fresh: T, hasChanged: boolean) => void,
    onError?: (err: any) => void
  ) {
    // 1. Immediately return cached if exists
    let cachedData: T | null = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        cachedData = JSON.parse(raw);
        if (cachedData) onCached(cachedData);
      }
    } catch (e) {
      console.warn('Error reading cache for', cacheKey, e);
    }

    // 2. Fetch fresh data in background
    try {
      const freshData = await fetcher();

      // Guard against overwriting populated cache with empty data
      const isIncomingEmpty =
        Array.isArray(freshData)
          ? freshData.length === 0
          : freshData && typeof freshData === 'object'
          ? (Array.isArray((freshData as any).courses) && (freshData as any).courses.length === 0) ||
            (Array.isArray((freshData as any).items) && (freshData as any).items.length === 0)
          : false;

      const isCachedEmpty =
        !cachedData ||
        (Array.isArray(cachedData)
          ? cachedData.length === 0
          : cachedData && typeof cachedData === 'object'
          ? (Array.isArray((cachedData as any).courses) && (cachedData as any).courses.length === 0) ||
            (Array.isArray((cachedData as any).items) && (cachedData as any).items.length === 0)
          : false);

      if (isIncomingEmpty && !isCachedEmpty) {
        console.warn(`fetchWithSWR: Ignored empty fresh data for ${cacheKey} to preserve cache`);
        onFresh(cachedData!, false);
        return;
      }

      const freshJson = JSON.stringify(freshData);
      const cachedJson = cachedData ? JSON.stringify(cachedData) : null;
      const hasChanged = freshJson !== cachedJson;

      if (hasChanged) {
        try {
          localStorage.setItem(cacheKey, freshJson);
        } catch (e) {
          console.warn('Error updating cache for', cacheKey, e);
        }
      }

      onFresh(freshData, hasChanged);
    } catch (err) {
      if (onError) onError(err);
    }
  },

  // --- Exercise Overview Cache ---
  getCachedExerciseOverview(refId: string): ExerciseOverviewResponse | null {
    try {
      const raw = localStorage.getItem(EXERCISE_OVERVIEW_PREFIX + refId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCachedExerciseOverview(refId: string, data: ExerciseOverviewResponse) {
    try {
      localStorage.setItem(EXERCISE_OVERVIEW_PREFIX + refId, JSON.stringify(data));
      this.setCacheTimestamp(EXERCISE_OVERVIEW_PREFIX + refId);
    } catch (e) {
      console.warn('Storage quota exceeded for exercise overview cache', e);
    }
  },

  // --- Exercise Submissions Cache ---
  getCachedExerciseSubmissions(refId: string, assId?: string): ExerciseSubmissionsResponse | null {
    try {
      const key = `${EXERCISE_SUBMISSIONS_PREFIX}${refId}_${assId || 'default'}`;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCachedExerciseSubmissions(refId: string, assId: string | undefined, data: ExerciseSubmissionsResponse) {
    try {
      const key = `${EXERCISE_SUBMISSIONS_PREFIX}${refId}_${assId || 'default'}`;
      localStorage.setItem(key, JSON.stringify(data));
      this.setCacheTimestamp(key);
    } catch (e) {
      console.warn('Storage quota exceeded for exercise submissions cache', e);
    }
  },

  // --- Exercise Info Cache ---
  getCachedExerciseInfo(refId: string): ExerciseInfoResponse | null {
    try {
      const raw = localStorage.getItem(EXERCISE_INFO_PREFIX + refId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCachedExerciseInfo(refId: string, data: ExerciseInfoResponse) {
    try {
      localStorage.setItem(EXERCISE_INFO_PREFIX + refId, JSON.stringify(data));
      this.setCacheTimestamp(EXERCISE_INFO_PREFIX + refId);
    } catch (e) {
      console.warn('Storage quota exceeded for exercise info cache', e);
    }
  },

  // --- Student Assignment Detail Cache ---
  getCachedStudentAssignment(refId: string, assId: string): StudentAssignmentDetail | null {
    try {
      const raw = localStorage.getItem(`${STUDENT_ASSIGNMENT_PREFIX}${refId}_${assId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCachedStudentAssignment(refId: string, assId: string, data: StudentAssignmentDetail) {
    try {
      localStorage.setItem(`${STUDENT_ASSIGNMENT_PREFIX}${refId}_${assId}`, JSON.stringify(data));
      this.setCacheTimestamp(`${STUDENT_ASSIGNMENT_PREFIX}${refId}_${assId}`);
    } catch (e) {
      console.warn('Storage quota exceeded for student assignment cache', e);
    }
  },

  // --- Course Management Cache ---
  getCachedManagement(refId: string): ManagementResponse | null {
    try {
      const raw = localStorage.getItem(`${MANAGEMENT_CACHE_PREFIX}${refId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCachedManagement(refId: string, data: ManagementResponse) {
    try {
      const key = `${MANAGEMENT_CACHE_PREFIX}${refId}`;
      localStorage.setItem(key, JSON.stringify(data));
      this.setCacheTimestamp(key);
    } catch (e) {
      console.warn('Storage quota exceeded for management cache', e);
    }
  },

  invalidateCachedManagement(refId: string) {
    try {
      localStorage.removeItem(`${MANAGEMENT_CACHE_PREFIX}${refId}`);
      localStorage.removeItem(`${CACHE_TS_PREFIX}${MANAGEMENT_CACHE_PREFIX}${refId}`);
    } catch {}
  },

  // --- TA Assignments List Cache ---
  getCachedTAAssignments(exerciseRefId: string): TAAssignmentListResponse | null {
    try {
      const raw = localStorage.getItem(`${TA_ASSIGNMENTS_CACHE_PREFIX}${exerciseRefId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCachedTAAssignments(exerciseRefId: string, data: TAAssignmentListResponse) {
    try {
      const key = `${TA_ASSIGNMENTS_CACHE_PREFIX}${exerciseRefId}`;
      localStorage.setItem(key, JSON.stringify(data));
      this.setCacheTimestamp(key);
    } catch (e) {
      console.warn('Storage quota exceeded for TA assignments cache', e);
    }
  },

  invalidateCachedTAAssignments(exerciseRefId: string) {
    try {
      localStorage.removeItem(`${TA_ASSIGNMENTS_CACHE_PREFIX}${exerciseRefId}`);
      localStorage.removeItem(`${CACHE_TS_PREFIX}${TA_ASSIGNMENTS_CACHE_PREFIX}${exerciseRefId}`);
    } catch {}
  },
};


