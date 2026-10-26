export interface AuthStatus {
  authenticated: boolean;
  client_id?: string;
  cookies_present: boolean;
  message?: string;
  user_name?: string;
  session_id?: string;
}

export interface CourseItem {
  ref_id: string;
  title: string;
  description?: string;
  url: string;
  item_type: string;
  icon?: string;
  semester?: string;
  subject?: string;
  faculty?: string;
}

export interface DashboardResponse {
  courses: CourseItem[];
  fetched_at: string;
}

export interface BreadcrumbItem {
  title: string;
  ref_id?: string;
  url?: string;
}

export interface MaterialItem {
  ref_id: string;
  title: string;
  item_type: string; // fold, file, exc, frm, tst, webr, sess, mcst, other
  description?: string;
  url: string;
  download_url?: string;
  file_size?: string;
  properties: Record<string, string>;
  image_url?: string;
}

export interface RichTextBlock {
  title?: string;
  level: number;
  html_content: string;
  plain_text?: string;
}

export interface ContentGroup {
  title: string;
  items: MaterialItem[];
}

export interface CourseSection {
  id: string;
  title: string;
  description?: string;
  groups: ContentGroup[];
  items: MaterialItem[];
  rich_text_blocks: RichTextBlock[];
}

export interface CourseLogItem {
  title: string;
  target?: string;
  date?: string;
  url?: string;
  log_type: string; // 'file' | 'forum' | 'general'
}

export interface PodcastEpisode {
  id: string;
  title: string;
  date?: string;
  presenter?: string;
  location?: string;
  stream_url?: string;
  status: string; // 'available' | 'scheduled'
}

export interface PodcastSeriesResponse {
  ref_id: string;
  title: string;
  total_episodes: number;
  recorded_count: number;
  scheduled_count: number;
  pages_available: string[];
  episodes: PodcastEpisode[];
  fetched_at: string;
}

export interface CourseSessionItem {
  ref_id: string;
  title: string;
  date_str?: string;
  time_str?: string;
  location?: string;
  materials: MaterialItem[];
  is_past: boolean;
  expand_id?: string;
  materials_count?: number;
}

export interface CourseContentBlock {
  id: string;
  block_type: 'heading' | 'drawer' | 'items' | 'text' | 'sessions' | 'all_files' | 'columns' | 'column';
  presentation?: 'tiles' | 'list';
  title?: string;
  title_key?: string;
  title_values?: Record<string, unknown>;
  items?: MaterialItem[];
  html_content?: string;
  plain_text?: string;
  level?: number;
  child_blocks?: CourseContentBlock[];
  sessions?: CourseSessionItem[];
  columns?: number;
}

export interface CourseLogsResponse {
  course_id: string;
  logs: CourseLogItem[];
  total_pages: number;
  current_page: number;
  fetched_at: string;
}

export interface CourseMembership {
  is_enrolled?: boolean | null;
  can_join: boolean;
  can_leave: boolean;
}

export type MembershipAction = 'join' | 'leave';
export interface MembershipFormResponse {
  action: MembershipAction;
  available: boolean;
  message: string;
  fields: { name: string; label: string; field_type: 'text' | 'password' | 'checkbox'; required: boolean; value: string }[];
  ilias_url: string;
}
export interface MembershipResult {
  success: boolean;
  is_enrolled?: boolean | null;
  message: string;
}

export interface CourseMaterialsResponse {
  container_ref_id: string;
  is_enrolled?: boolean;
  membership?: CourseMembership;
  title?: string;
  breadcrumbs: BreadcrumbItem[];
  items: MaterialItem[];
  sections?: CourseSection[];
  rich_text_blocks?: RichTextBlock[];
  sessions?: CourseSessionItem[];
  columns?: number;
  logs?: CourseLogItem[];
  blocks?: CourseContentBlock[];
  layout_hash?: string;
  fetched_at: string;
}

export interface RepositoryResponse {
  container_ref_id: string;
  title: string;
  breadcrumbs: BreadcrumbItem[];
  items: (MaterialItem & { accessible: boolean; membership?: CourseMembership })[];
}

export type RepositoryLocation = Pick<RepositoryResponse, 'container_ref_id' | 'title' | 'breadcrumbs'>;

export interface SemesterItem {
  id: string;
  name: string;
  is_active: boolean;
  url: string;
}

export interface SemesterScreenResponse {
  active_semester?: string;
  available_semesters: SemesterItem[];
  courses: CourseItem[];
  grouped_by_category: Record<string, CourseItem[]>;
  fetched_at: string;
}

export interface AssignmentItem {
  ass_id?: string;
  title: string;
  url: string;
  time_remaining?: string;
  edit_until?: string;
  requirement?: string;
  status?: string;
  is_ongoing?: boolean;
  is_ended?: boolean;
  create_team_url?: string;
  ass_type?: string;
  is_selected?: boolean;
  properties?: Record<string, string>;
}

export interface SubmissionFile {
  filename: string;
  download_url: string;
  upload_time?: string;
  file_size?: string;
  delivered_id?: string;
}

export interface TAQuickFilter {
  id: string;
  label: string;
  color: 'indigo' | 'emerald' | 'amber' | 'rose' | 'purple' | 'sky' | 'slate';
  gradeStatus: string[];
  submissionStatus: 'all' | 'submitted' | 'not_submitted';
}

export interface SubmissionItem {
  member_id: string;
  student_name: string;
  team_members?: string[];
  login?: string;
  team_name?: string;
  team_id?: string;
  submission_status: string; // 'submitted' | 'not_submitted' | 'late'
  submission_time?: string;
  graded_on?: string;
  evaluation_on?: string;
  sent_on?: string;
  individual_deadline?: string;
  files: SubmissionFile[];
  download_url?: string;
  mark?: string;
  passed_status?: string; // 'passed' | 'failed' | 'not_graded'
  feedback?: string;
  notice?: string;
  feedback_mail_url?: string;
  team_log_url?: string;
  evaluation_by_file_url?: string;
  can_grade?: boolean;
  additional_columns?: Record<string, string>;
}

export interface ExerciseInfo {
  ref_id: string;
  title: string;
  instructions?: string;
  deadline?: string;
  total_participants: number;
  submitted_count: number;
  graded_count: number;
}

export interface ExerciseSubmissionsResponse {
  exercise: ExerciseInfo;
  available_assignments?: AssignmentItem[];
  active_assignment_id?: string;
  submissions: SubmissionItem[];
  form_action_url?: string;
  rtoken?: string;
  fetched_at: string;
}

export interface GradeSubmissionRequest {
  member_id: string;
  ass_id?: string;
  status?: string;
  mark?: string;
  feedback?: string;
  notice?: string;
  rtoken?: string;
}

export interface GradeSubmissionResponse {
  success: boolean;
  message: string;
  member_id: string;
  status?: string;
  feedback?: string;
}

export interface TeamMemberInfo {
  user_id?: string;
  login: string;
  name?: string;
  is_self?: boolean;
}

export interface CourseUserCandidate {
  user_id: string;
  login: string;
  firstname: string;
  lastname: string;
  full_name: string;
  in_team?: boolean;
  is_self?: boolean;
}

export interface TeamCandidatesResponse {
  exercise_ref_id: string;
  ass_id: string;
  current_user_id?: string;
  team_members: TeamMemberInfo[];
  candidates: CourseUserCandidate[];
  fetched_at: string;
}

export interface StudentAssignmentDetail {
  exercise_ref_id: string;
  ass_id: string;
  title: string;
  instructions?: string;
  is_team_upload?: boolean;
  start_time?: string;
  ended_on?: string;
  time_remaining?: string;
  is_ended: boolean;
  exercise_files: SubmissionFile[];
  team_members: string[];
  team_member_details?: TeamMemberInfo[];
  team_status_text?: string;
  create_team_url?: string;
  manage_team_url?: string;
  delete_team_url?: string;
  submitted_files: SubmissionFile[];
  last_submission?: string;
  submission_status: string;
  evaluation_statement?: string;
  passed_status?: string;
  mark?: string;
  fetched_at: string;
}

export interface ExerciseInfoSection {
  title: string;
  properties: Record<string, string>;
}

export interface ExerciseInfoResponse {
  ref_id: string;
  title: string;
  sections: ExerciseInfoSection[];
  fetched_at: string;
}

export type ExerciseTab = 'assignments' | 'info' | 'submissions' | 'manage' | 'manage-edit';

export interface ExerciseOverviewResponse {
  exercise_ref_id: string;
  title: string;
  breadcrumbs: BreadcrumbItem[];
  submissions_and_grades_url?: string;
  edit_assignments_url?: string;
  has_ta_access?: boolean;
  active_mode?: string;
  assignments: AssignmentItem[];
  fetched_at: string;
}

export interface TAAssignmentListItem {
  ass_id: string;
  title: string;
  order_val: number;
  type_name: string;
  type_id: number;
  start_time?: string | null;
  deadline?: string | null;
  mandatory: boolean;
  instruction_files_count: number;
  has_work_instructions: boolean;
  edit_url?: string | null;
}

export interface TAAssignmentListResponse {
  exercise_ref_id: string;
  assignments: TAAssignmentListItem[];
  available_types?: Record<string, string>;
  form_action_url?: string | null;
  rtoken?: string | null;
  fetched_at: string;
}

export interface AssignmentOrderUpdateRequest {
  orders: Record<string, number>;
}

export interface TAInstructionFileItem {
  file_id: string;
  filename: string;
  file_size?: string | null;
  download_url?: string | null;
}

export interface TAAssignmentDetailResponse {
  ass_id?: string | null;
  exercise_ref_id: string;
  title: string;
  type_id: number;
  type_name: string;
  available_types?: Record<string, string>;
  mandatory: boolean;
  instruction_html: string;
  start_time?: string | null;
  deadline_mode: number;
  deadline?: string | null;
  has_grace_period: boolean;
  deadline2?: string | null;
  max_file_enabled: boolean;
  max_file?: number | null;
  instruction_files: TAInstructionFileItem[];
  form_action?: string | null;
  rtoken?: string | null;
  fetched_at: string;
}

export interface SaveTAAssignmentRequest {
  ass_id?: string | null;
  title: string;
  type_id: number;
  mandatory: boolean;
  instruction_html: string;
  start_time?: string | null;
  deadline_mode: number;
  deadline?: string | null;
  has_grace_period: boolean;
  deadline2?: string | null;
  max_file_enabled: boolean;
  max_file?: number | null;
}

export interface FeedbackFileItem {
  id: string;
  title: string;
  size?: string;
  created_on?: string;
  file_type?: string;
  download_url?: string;
  remove_url?: string;
}

export interface FeedbackFilesResponse {
  member_id: string;
  student_name?: string;
  files: FeedbackFileItem[];
  upload_url?: string;
}

