import {
  AuthStatus,
  CourseLogsResponse,
  CourseMaterialsResponse,
  DashboardResponse,
  ExerciseOverviewResponse,
  PodcastSeriesResponse,
  SemesterScreenResponse,
} from '../types';

const API_BASE = '/api';

export const api = {
  async getAuthStatus(): Promise<AuthStatus> {
    const res = await fetch(`${API_BASE}/auth/status`);
    if (!res.ok) throw new Error('Failed to fetch auth status');
    return res.json();
  },

  async triggerBrowserLogin(): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/auth/login-browser`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Browser login failed');
    }
    return res.json();
  },

  async getSemesters(semester?: string): Promise<SemesterScreenResponse> {
    const query = semester ? `?semester=${encodeURIComponent(semester)}` : '';
    const res = await fetch(`${API_BASE}/dashboard/semesters${query}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch semester courses');
    }
    return res.json();
  },

  async getDashboardCourses(): Promise<DashboardResponse> {
    const res = await fetch(`${API_BASE}/dashboard/courses`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch courses');
    }
    return res.json();
  },

  async getMaterials(courseOrFolderId: string): Promise<CourseMaterialsResponse> {
    const res = await fetch(`${API_BASE}/courses/${encodeURIComponent(courseOrFolderId)}/materials`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch course materials');
    }
    return res.json();
  },

  async getCourseLogs(courseId: string, page: number = 1): Promise<CourseLogsResponse> {
    const res = await fetch(`${API_BASE}/courses/${encodeURIComponent(courseId)}/logs?page=${page}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch course logs');
    }
    return res.json();
  },

  async getExerciseOverview(exerciseId: string): Promise<ExerciseOverviewResponse> {
    const res = await fetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/overview`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch exercise overview');
    }
    return res.json();
  },

  async getPodcasts(refId: string): Promise<PodcastSeriesResponse> {
    const res = await fetch(`${API_BASE}/podcasts/${encodeURIComponent(refId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch podcasts');
    }
    return res.json();
  },

  getDownloadUrl(refId: string, customUrl?: string): string {
    const params = customUrl ? `?custom_url=${encodeURIComponent(customUrl)}` : '';
    return `${API_BASE}/materials/${encodeURIComponent(refId)}/download${params}`;
  }
};

