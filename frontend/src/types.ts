export interface AuthStatus {
  authenticated: boolean;
  client_id?: string;
  cookies_present: boolean;
  message?: string;
  user_name?: string;
}

export interface CourseItem {
  ref_id: string;
  title: string;
  description?: string;
  url: string;
  item_type: string;
  icon?: string;
  semester?: string;
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
}

export interface CourseLogsResponse {
  course_id: string;
  logs: CourseLogItem[];
  total_pages: number;
  current_page: number;
  fetched_at: string;
}

export interface CourseMaterialsResponse {
  container_ref_id: string;
  title?: string;
  breadcrumbs: BreadcrumbItem[];
  items: MaterialItem[];
  sections?: CourseSection[];
  rich_text_blocks?: RichTextBlock[];
  sessions?: CourseSessionItem[];
  logs?: CourseLogItem[];
  fetched_at: string;
}

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
  properties: Record<string, string>;
}

export interface ExerciseOverviewResponse {
  exercise_ref_id: string;
  title: string;
  breadcrumbs: BreadcrumbItem[];
  submissions_and_grades_url?: string;
  assignments: AssignmentItem[];
  fetched_at: string;
}
