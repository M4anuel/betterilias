import {
  AuthStatus,
  CourseLogsResponse,
  CourseMaterialsResponse,
  DashboardResponse,
  ExerciseInfoResponse,
  ExerciseOverviewResponse,
  ExerciseSubmissionsResponse,
  GradeSubmissionRequest,
  GradeSubmissionResponse,
  PodcastSeriesResponse,
  SemesterScreenResponse,
  StudentAssignmentDetail,
  FeedbackFilesResponse,
  MaterialItem,
} from '../types';


const API_BASE = '/api';

// Protected API responses confirm the current session, including expiry.
async function sessionFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('ilias-session', { detail: false }));
  } else if (response.ok && !input.startsWith(`${API_BASE}/auth/`)) {
    window.dispatchEvent(new CustomEvent('ilias-session', { detail: true }));
  }
  return response;
}

export const api = {
  async getAuthStatus(): Promise<AuthStatus> {
    const res = await sessionFetch(`${API_BASE}/auth/status`);
    if (!res.ok) throw new Error('Failed to fetch auth status');
    return res.json();
  },

  async triggerBrowserLogin(): Promise<{ success: boolean; message: string }> {
    const res = await sessionFetch(`${API_BASE}/auth/login-browser`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Browser login failed');
    }
    return res.json();
  },

  async getSemesters(semester?: string): Promise<SemesterScreenResponse> {
    const query = semester ? `?semester=${encodeURIComponent(semester)}` : '';
    const res = await sessionFetch(`${API_BASE}/dashboard/semesters${query}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch semester courses');
    }
    return res.json();
  },

  async getDashboardCourses(): Promise<DashboardResponse> {
    const res = await sessionFetch(`${API_BASE}/dashboard/courses`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch courses');
    }
    return res.json();
  },

  async getMaterials(courseOrFolderId: string): Promise<CourseMaterialsResponse> {
    const res = await sessionFetch(`${API_BASE}/courses/${encodeURIComponent(courseOrFolderId)}/materials`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch course materials');
    }
    return res.json();
  },

  async getSessionMaterials(
    courseId: string,
    sessionId: string,
    expandId?: string
  ): Promise<MaterialItem[]> {
    const query = expandId ? `?expand_id=${encodeURIComponent(expandId)}` : '';
    const res = await sessionFetch(
      `${API_BASE}/courses/${encodeURIComponent(courseId)}/sessions/${encodeURIComponent(sessionId)}/materials${query}`
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch session materials');
    }
    return res.json();
  },


  async getCourseLogs(courseId: string, page: number = 1): Promise<CourseLogsResponse> {
    const res = await sessionFetch(`${API_BASE}/courses/${encodeURIComponent(courseId)}/logs?page=${page}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch course logs');
    }
    return res.json();
  },

  async getExerciseOverview(exerciseId: string, mode: string = 'all'): Promise<ExerciseOverviewResponse> {
    const res = await sessionFetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/overview?mode=${encodeURIComponent(mode)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch exercise overview');
    }
    return res.json();
  },

  async getExerciseInfo(exerciseId: string): Promise<ExerciseInfoResponse> {
    const res = await sessionFetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/info`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch exercise info');
    }
    return res.json();
  },

  async getExerciseSubmissions(exerciseId: string, assId?: string): Promise<ExerciseSubmissionsResponse> {
    const query = assId ? `?ass_id=${encodeURIComponent(assId)}` : '';
    const res = await sessionFetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/submissions${query}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch exercise submissions');
    }
    return res.json();
  },

  async getStudentAssignment(exerciseId: string, assId: string): Promise<StudentAssignmentDetail> {
    const res = await sessionFetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/assignment/${encodeURIComponent(assId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch student assignment detail');
    }
    return res.json();
  },

  async uploadStudentAssignmentFile(
    exerciseRefId: string,
    assId: string,
    file: File
  ): Promise<StudentAssignmentDetail> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseRefId)}/assignment/${encodeURIComponent(assId)}/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to upload submission file');
    }
    return res.json();
  },

  async deleteStudentAssignmentFile(
    exerciseId: string,
    assId: string,
    deliveredId: string
  ): Promise<StudentAssignmentDetail> {
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/assignment/${encodeURIComponent(assId)}/submission/${encodeURIComponent(deliveredId)}`,
      {
        method: 'DELETE',
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete submission file');
    }
    return res.json();
  },

  async gradeSubmission(
    exerciseId: string,
    memberId: string,
    data: GradeSubmissionRequest
  ): Promise<GradeSubmissionResponse> {
    const res = await sessionFetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/submissions/${encodeURIComponent(memberId)}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to save grade');
    }
    return res.json();
  },

  async getFeedbackFiles(
    exerciseRefId: string,
    memberId: string,
    assId?: string
  ): Promise<FeedbackFilesResponse> {
    const params = assId ? `?ass_id=${encodeURIComponent(assId)}` : '';
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseRefId)}/submissions/${encodeURIComponent(memberId)}/feedback-files${params}`
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch feedback files');
    }
    return res.json();
  },

  async uploadFeedbackFile(
    exerciseRefId: string,
    memberId: string,
    file: File,
    assId?: string
  ): Promise<FeedbackFilesResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (assId) {
      formData.append('ass_id', assId);
    }
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseRefId)}/submissions/${encodeURIComponent(memberId)}/feedback-files`,
      {
        method: 'POST',
        body: formData,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to upload feedback file');
    }
    return res.json();
  },


  async getPodcasts(refId: string): Promise<PodcastSeriesResponse> {
    const res = await sessionFetch(`${API_BASE}/podcasts/${encodeURIComponent(refId)}`);
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
