import {
  CourseMaterialsResponse,
  ExerciseOverviewResponse,
  ExerciseSubmissionsResponse,
  ExerciseInfoResponse,
  StudentAssignmentDetail,
} from '../types';

export type ContentSectionId =
  | 'folders'
  | 'files'
  | 'podcasts'
  | 'sessions'
  | 'exercises'
  | 'richtext'
  | 'sections';

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
const LAST_OPENED_KEY = 'ilias_last_opened_course';
const SIDEBAR_COLLAPSED_KEY = 'ilias_sidebar_collapsed';
const MATERIALS_CACHE_PREFIX = 'ilias_materials_cache_';
const SEMESTER_CACHE_KEY = 'ilias_semester_cache';
const EXERCISE_OVERVIEW_PREFIX = 'ilias_exercise_overview_';
const EXERCISE_SUBMISSIONS_PREFIX = 'ilias_exercise_submissions_';
const EXERCISE_INFO_PREFIX = 'ilias_exercise_info_';
const STUDENT_ASSIGNMENT_PREFIX = 'ilias_student_assignment_';

export const cache = {
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
      if (iconName && iconName !== 'BookOpen') {
        current[refId] = iconName;
      } else {
        delete current[refId];
      }
      localStorage.setItem(COURSE_ICONS_KEY, JSON.stringify(current));
    } catch (e) {
      console.error('Failed to save course icon', e);
    }
  },

  getCourseIcon(refId: string): string {
    const icons = this.getCourseIcons();
    return icons[refId] || 'BookOpen';
  },

  // --- Selected Semester ---
  getSelectedSemester(): string {
    try {
      return localStorage.getItem(SELECTED_SEMESTER_KEY) || 'HS2026';
    } catch {
      return 'HS2026';
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

  // --- Course Materials Cache (Instant Serving) ---
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
      localStorage.setItem(MATERIALS_CACHE_PREFIX + refId, JSON.stringify(data));
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
      localStorage.setItem('ilias_podcast_cache_' + refId, JSON.stringify(data));
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
    } catch (e) {
      console.warn('Storage quota exceeded for student assignment cache', e);
    }
  },
};


