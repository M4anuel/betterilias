import { t, getLanguage } from './i18n';
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
  RepositoryResponse,
  MembershipAction, MembershipFormResponse, MembershipResult,
  TeamCandidatesResponse,
  TAAssignmentListItem,
  TAAssignmentListResponse,
  AssignmentOrderUpdateRequest,
  TAInstructionFileItem,
  TAAssignmentDetailResponse,
  SaveTAAssignmentRequest,
} from '../types';
import { cache } from './cache';


const API_BASE = '/api';

function apiError(error: { detail?: unknown }): string | undefined {
  if (typeof error.detail === 'string') return error.detail;
  if (Array.isArray(error.detail)) return error.detail.map(item => item.msg).filter(Boolean).join(' ');
  return undefined;
}

// Protected API responses confirm the current session, including expiry.
async function sessionFetch(input: string, init?: RequestInit): Promise<Response> {
  const sessionId = cache.getSessionId();
  const headers = new Headers(init?.headers);
  headers.set('Accept-Language', getLanguage());
  if (sessionId && !headers.has('X-Session-Id')) {
    headers.set('X-Session-Id', sessionId);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('ilias-session', { detail: false }));
  } else if (response.ok && !input.startsWith(`${API_BASE}/auth/`)) {
    window.dispatchEvent(new CustomEvent('ilias-session', { detail: true }));
  }
  return response;
}

export const api = {
  async prepareMobileSession(): Promise<{ session_id: string }> {
    const res = await sessionFetch(`${API_BASE}/auth/mobile-session`, { method: 'POST', cache: 'no-store' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Die mobile Verbindung konnte nicht vorbereitet werden"));
    }
    return res.json();
  },
  async getMembershipForm(refId: string, action: MembershipAction): Promise<MembershipFormResponse> {
    const res = await sessionFetch(`${API_BASE}/courses/${encodeURIComponent(refId)}/membership?action=${action}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Kursaktion konnte nicht geladen werden"));
    }
    return res.json();
  },

  async changeMembership(refId: string, action: MembershipAction, values: Record<string, string>): Promise<MembershipResult> {
    const res = await sessionFetch(`${API_BASE}/courses/${encodeURIComponent(refId)}/membership`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, values }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Kursaktion fehlgeschlagen"));
    }
    return res.json();
  },
  async getRepository(refId: string): Promise<RepositoryResponse> {
    const res = await sessionFetch(`${API_BASE}/repository/${encodeURIComponent(refId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Magazin konnte nicht geladen werden"));
    }
    return res.json();
  },
  async getAuthStatus(): Promise<AuthStatus> {
    const res = await sessionFetch(`${API_BASE}/auth/status`);
    if (!res.ok) throw new Error(t("Failed to fetch auth status"));
    return res.json();
  },

  async triggerBrowserLogin(): Promise<{ success: boolean; session_id?: string; message: string }> {
    const res = await sessionFetch(`${API_BASE}/auth/login-browser`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(apiError(err) || t("Browser login failed"));
    }
    const data = await res.json();
    if (data.session_id) {
      cache.setSessionId(data.session_id);
    }
    return data;
  },

  async syncExtensionCookies(payload: {
    cookies: Record<string, string>;
    sessionId?: string;
  }): Promise<{ success: boolean; session_id: string; authenticated: boolean; user_name?: string; message: string }> {
    const res = await sessionFetch(`${API_BASE}/auth/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Fehler beim Synchronisieren der Cookies"));
    }
    const data = await res.json();
    if (data.session_id) {
      cache.setSessionId(data.session_id);
    }
    return data;
  },

  async setManualCookies(phpsessid: string, ilClientId: string = 'ilias3_unibe'): Promise<{ success: boolean; session_id?: string; message: string }> {
    const res = await sessionFetch(`${API_BASE}/auth/cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phpsessid, il_client_id: ilClientId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Fehler beim Speichern der Cookies"));
    }
    const data = await res.json();
    if (data.session_id) {
      cache.setSessionId(data.session_id);
    }
    return data;
  },

  async logout(): Promise<void> {
    try {
      await sessionFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } finally {
      // Retain the revoked key so a paired device cannot fall back to another
      // active/default desktop session on its next request.
      cache.clearSessionContent();
    }
  },

  async getSemesters(semester?: string): Promise<SemesterScreenResponse> {
    const query = semester ? `?semester=${encodeURIComponent(semester)}` : '';
    const res = await sessionFetch(`${API_BASE}/dashboard/semesters${query}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to fetch semester courses"));
    }
    return res.json();
  },

  async getDashboardCourses(): Promise<DashboardResponse> {
    const res = await sessionFetch(`${API_BASE}/dashboard/courses`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to fetch courses"));
    }
    return res.json();
  },

  async getMaterials(courseOrFolderId: string): Promise<CourseMaterialsResponse> {
    const res = await sessionFetch(`${API_BASE}/courses/${encodeURIComponent(courseOrFolderId)}/materials`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to fetch course materials"));
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
      throw new Error(apiError(err) || t("Failed to fetch session materials"));
    }
    return res.json();
  },


  async getCourseLogs(courseId: string, page: number = 1): Promise<CourseLogsResponse> {
    const res = await sessionFetch(`${API_BASE}/courses/${encodeURIComponent(courseId)}/logs?page=${page}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to fetch course logs"));
    }
    return res.json();
  },

  async getExerciseOverview(exerciseId: string, mode: string = 'all'): Promise<ExerciseOverviewResponse> {
    const res = await sessionFetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/overview?mode=${encodeURIComponent(mode)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to fetch exercise overview"));
    }
    return res.json();
  },

  async getExerciseInfo(exerciseId: string): Promise<ExerciseInfoResponse> {
    const res = await sessionFetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/info`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to fetch exercise info"));
    }
    return res.json();
  },

  async getExerciseSubmissions(exerciseId: string, assId?: string, includeTeamOrder = false): Promise<ExerciseSubmissionsResponse> {
    const params = new URLSearchParams();
    if (assId) params.set('ass_id', assId);
    if (includeTeamOrder) params.set('include_team_order', 'true');
    const query = params.size ? `?${params}` : '';
    const res = await sessionFetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/submissions${query}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to fetch exercise submissions"));
    }
    return res.json();
  },

  async getStudentAssignment(exerciseId: string, assId: string): Promise<StudentAssignmentDetail> {
    const res = await sessionFetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/assignment/${encodeURIComponent(assId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to fetch student assignment detail"));
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
      throw new Error(apiError(err) || t("Failed to upload submission file"));
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
      throw new Error(apiError(err) || t("Failed to delete submission file"));
    }
    return res.json();
  },

  async createStudentTeam(
    exerciseId: string,
    assId: string
  ): Promise<StudentAssignmentDetail> {
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/assignment/${encodeURIComponent(assId)}/team/create`,
      { method: 'POST' }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Fehler beim Erstellen des Teams"));
    }
    return res.json();
  },

  async getTeamCandidates(
    exerciseId: string,
    assId: string
  ): Promise<TeamCandidatesResponse> {
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/assignment/${encodeURIComponent(assId)}/team/candidates`
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Fehler beim Laden der Kursteilnehmenden"));
    }
    return res.json();
  },

  async addStudentTeamMembers(
    exerciseId: string,
    assId: string,
    payload: { user_ids?: string[]; user_logins?: string[] }
  ): Promise<StudentAssignmentDetail> {
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/assignment/${encodeURIComponent(assId)}/team/add`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Fehler beim Hinzufügen von Teammitgliedern"));
    }
    return res.json();
  },

  async removeStudentTeamMembers(
    exerciseId: string,
    assId: string,
    memberIds: string[]
  ): Promise<StudentAssignmentDetail> {
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/assignment/${encodeURIComponent(assId)}/team/remove`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_ids: memberIds }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Fehler beim Entfernen von Teammitgliedern"));
    }
    return res.json();
  },

  async deleteStudentTeam(
    exerciseId: string,
    assId: string
  ): Promise<StudentAssignmentDetail> {
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseId)}/assignment/${encodeURIComponent(assId)}/team`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Fehler beim Löschen des Teams"));
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
      throw new Error(apiError(err) || t("Failed to save grade"));
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
      throw new Error(apiError(err) || t("Failed to fetch feedback files"));
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
      throw new Error(apiError(err) || t("Failed to upload feedback file"));
    }
    return res.json();
  },


  async deleteFeedbackFile(
    exerciseRefId: string,
    memberId: string,
    fileId: string,
    assId?: string
  ): Promise<FeedbackFilesResponse> {
    const params = assId ? `?ass_id=${encodeURIComponent(assId)}` : '';
    const res = await sessionFetch(
      `${API_BASE}/exercises/${encodeURIComponent(exerciseRefId)}/submissions/${encodeURIComponent(memberId)}/feedback-files/${encodeURIComponent(fileId)}${params}`,
      {
        method: 'DELETE',
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to delete feedback file"));
    }
    return res.json();
  },

  async getPodcasts(refId: string): Promise<PodcastSeriesResponse> {
    const res = await sessionFetch(`${API_BASE}/podcasts/${encodeURIComponent(refId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiError(err) || t("Failed to fetch podcasts"));
    }
    return res.json();
  },

  getDownloadUrl(refId: string, customUrl?: string): string {
    const params = new URLSearchParams();
    params.set('lang', getLanguage());
    if (customUrl) params.set('custom_url', customUrl);
    const sessionId = cache.getSessionId();
    if (sessionId) params.set('session_id', sessionId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return `${API_BASE}/materials/${encodeURIComponent(refId)}/download${qs}`;
  },

  // ---------------------------------------------------------
  // TA Exercise Editor Methods
  // ---------------------------------------------------------
  async getTAAssignments(exerciseId: string): Promise<TAAssignmentListResponse> {
    const res = await sessionFetch(`${API_BASE}/exercises/${exerciseId}/ta/assignments`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(apiError(error) || t("Übungsliste konnte nicht geladen werden"));
    }
    return res.json();
  },

  async updateTAAssignmentOrder(
    exerciseId: string,
    orders: Record<string, number>
  ): Promise<TAAssignmentListResponse> {
    const res = await sessionFetch(`${API_BASE}/exercises/${exerciseId}/ta/assignments/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders }),
    });
    if (!res.ok) throw new Error(t("Reihenfolge konnte nicht gespeichert werden"));
    return res.json();
  },

  async getTAAssignmentDetail(
    exerciseId: string,
    assId?: string | null,
    typeId: number = 1
  ): Promise<TAAssignmentDetailResponse> {
    const params = new URLSearchParams();
    if (assId) params.append('ass_id', assId);
    params.append('type_id', String(typeId));
    const res = await sessionFetch(`${API_BASE}/exercises/${exerciseId}/ta/assignment-detail?${params.toString()}`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(apiError(error) || t("Übungsdetails konnten nicht geladen werden"));
    }
    return res.json();
  },

  async saveTAAssignment(
    exerciseId: string,
    data: SaveTAAssignmentRequest
  ): Promise<TAAssignmentDetailResponse> {
    const res = await sessionFetch(`${API_BASE}/exercises/${exerciseId}/ta/assignment-detail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(apiError(error) || t("Übung konnte nicht gespeichert werden"));
    }
    return res.json();
  },

  async deleteTAAssignment(
    exerciseId: string,
    assId: string
  ): Promise<{ success: boolean; ass_id: string }> {
    const res = await sessionFetch(`${API_BASE}/exercises/${exerciseId}/ta/assignments/${assId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(apiError(error) || t("Übung konnte nicht gelöscht werden"));
    }
    return res.json();
  },

  async getTAInstructionFiles(
    exerciseId: string,
    assId: string
  ): Promise<TAInstructionFileItem[]> {
    const res = await sessionFetch(`${API_BASE}/exercises/${exerciseId}/ta/assignments/${assId}/instruction-files`);
    if (!res.ok) throw new Error(t("Anweisungsdateien konnten nicht geladen werden"));
    return res.json();
  },

  async uploadTAInstructionFile(
    exerciseId: string,
    assId: string,
    file: File
  ): Promise<TAInstructionFileItem[]> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await sessionFetch(`${API_BASE}/exercises/${exerciseId}/ta/assignments/${assId}/instruction-files`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(apiError(error) || t("Anweisungsdatei konnte nicht hochgeladen werden"));
    }
    return res.json();
  },

  async deleteTAInstructionFile(
    exerciseId: string,
    assId: string,
    fileId: string
  ): Promise<{ success: boolean; file_id: string }> {
    const res = await sessionFetch(`${API_BASE}/exercises/${exerciseId}/ta/assignments/${assId}/instruction-files/${fileId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(t("Anweisungsdatei konnte nicht gelöscht werden"));
    return res.json();
  },
};
