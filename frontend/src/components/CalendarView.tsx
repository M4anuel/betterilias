import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Plus,
  RefreshCw,
  Download,
  Share2,
  Edit3,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertTriangle,
  Info,
  X,
  Eye,
  EyeOff,
  Upload,
  KeyRound,
  ExternalLink,
  BookOpen,
  FileText,
  Sparkles,
  Filter,
  BellOff,
  Bell,
} from 'lucide-react';
import {
  CalendarEvent,
  CalendarSubscriptionResponse,
  CalendarViewMode,
  CourseCalendarFeedStatus,
  CourseCalendarInfo,
  CourseItem,
  CourseScheduleRule,
  CourseScheduleRuleInput,
  SemesterCalendarResponse,
} from '../types';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { t, useLanguage } from '../lib/i18n';
import { getCurrentSemester, getSemesterOrderKey } from '../lib/semesterUtils';
import { useMobileViewport } from '../lib/useMobileViewport';

interface CalendarViewProps {
  selectedSemester: string;
  coursesList: CourseItem[];
  onSelectCourse: (courseRefId: string) => void;
  onSelectExercise?: (courseRefId: string, exerciseRefId: string) => void;
}

const COURSE_COLOR_PALETTE = [
  '#0AACA5',
  '#033683',
  '#2563EB',
  '#7C3AED',
  '#D97706',
  '#059669',
  '#DC2626',
  '#DB2777',
  '#4F46E5',
  '#0D9488',
];

const TIME_SLOT_PRESETS = [
  { label: '08:15–10:00', start: '08:15', end: '10:00' },
  { label: '10:15–12:00', start: '10:15', end: '12:00' },
  { label: '12:15–14:00', start: '12:15', end: '14:00' },
  { label: '14:15–16:00', start: '14:15', end: '16:00' },
  { label: '16:15–18:00', start: '16:15', end: '18:00' },
];

const WEEKDAY_SHORT_KEYS = [
  'calendar.weekday.mon_short',
  'calendar.weekday.tue_short',
  'calendar.weekday.wed_short',
  'calendar.weekday.thu_short',
  'calendar.weekday.fri_short',
  'calendar.weekday.sat_short',
  'calendar.weekday.sun_short',
] as const;

const WEEKDAY_LONG_KEYS = [
  'calendar.weekday.mon',
  'calendar.weekday.tue',
  'calendar.weekday.wed',
  'calendar.weekday.thu',
  'calendar.weekday.fri',
  'calendar.weekday.sat',
  'calendar.weekday.sun',
] as const;

const CURRENT_SEMESTER_TTL_MS = 6 * 3600 * 1000; // 6 hours for current-semester courses

function parseYmd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMondayOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  const jsDay = copy.getDay(); // 0=Sun..6=Sat
  const diff = jsDay === 0 ? -6 : 1 - jsDay;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTimestampAge(isoOrMs?: string | number | null, lang: string = 'de'): string {
  if (!isoOrMs) return '—';
  const tsMs = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(tsMs)) return '—';
  const diffSec = Math.max(0, Math.round((Date.now() - tsMs) / 1000));
  try {
    const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en' : 'de', { numeric: 'auto' });
    if (diffSec < 60) return rtf.format(0, 'minute');
    if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), 'minute');
    if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), 'hour');
    if (diffSec < 86400 * 30) return rtf.format(-Math.floor(diffSec / 86400), 'day');
    return rtf.format(-Math.floor(diffSec / (86400 * 30)), 'month');
  } catch {
    return new Date(tsMs).toLocaleDateString();
  }
}

function isCourseAutoSyncNeeded(
  existing: CourseCalendarInfo | undefined,
  courseSemester: string | null | undefined,
  currentSem: string
): boolean {
  if (!existing) return true;
  const status = existing.status || existing.feed_status || 'not_imported';
  if (status === 'not_imported' || status === 'not_checked' || !existing.last_imported_at) {
    return true;
  }
  const checkedTerminal =
    status === 'imported_with_lectures' ||
    status === 'imported_deadlines_only' ||
    status === 'valid_empty';

  const normCourseSem = (courseSemester || existing.semester || '').trim().toUpperCase();
  const normCurrSem = currentSem.trim().toUpperCase();

  // Past-semester courses and undated groups are cached indefinitely once checked
  if (normCourseSem !== normCurrSem) {
    return !checkedTerminal;
  }

  // Current-semester courses are re-checked if older than CURRENT_SEMESTER_TTL_MS (6h)
  const tsMs = Date.parse(existing.last_imported_at);
  if (!Number.isFinite(tsMs)) return true;
  return Date.now() - tsMs > CURRENT_SEMESTER_TTL_MS;
}

interface PositionedEvent {
  event: CalendarEvent;
  topPct: number;
  heightPct: number;
  colIndex: number;
  colCount: number;
}

function layoutDayEvents(
  events: CalendarEvent[],
  gridStartMin: number,
  gridEndMin: number
): PositionedEvent[] {
  const timed = events
    .filter((e) => !e.all_day && !e.is_cancelled)
    .sort((a, b) => {
      const diff = timeToMinutes(a.start_time_str) - timeToMinutes(b.start_time_str);
      if (diff !== 0) return diff;
      return timeToMinutes(b.end_time_str) - timeToMinutes(a.end_time_str);
    });

  const totalRange = Math.max(60, gridEndMin - gridStartMin);
  const clusters: CalendarEvent[][] = [];
  let currentCluster: CalendarEvent[] = [];
  let clusterMaxEnd = -1;

  for (const ev of timed) {
    const startMin = timeToMinutes(ev.start_time_str);
    const endMin = Math.max(startMin + 30, timeToMinutes(ev.end_time_str));
    if (currentCluster.length === 0 || startMin < clusterMaxEnd) {
      currentCluster.push(ev);
      clusterMaxEnd = Math.max(clusterMaxEnd, endMin);
    } else {
      clusters.push(currentCluster);
      currentCluster = [ev];
      clusterMaxEnd = endMin;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const result: PositionedEvent[] = [];
  for (const cluster of clusters) {
    const colEnds: number[] = [];
    const placements: { event: CalendarEvent; colIndex: number }[] = [];

    for (const ev of cluster) {
      const startMin = timeToMinutes(ev.start_time_str);
      const endMin = Math.max(startMin + 30, timeToMinutes(ev.end_time_str));
      let assignedCol = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= startMin) {
          assignedCol = c;
          colEnds[c] = endMin;
          break;
        }
      }
      if (assignedCol === -1) {
        assignedCol = colEnds.length;
        colEnds.push(endMin);
      }
      placements.push({ event: ev, colIndex: assignedCol });
    }

    const colCount = Math.max(1, colEnds.length);
    for (const p of placements) {
      const startMin = Math.max(gridStartMin, timeToMinutes(p.event.start_time_str));
      const rawEnd = Math.max(startMin + 30, timeToMinutes(p.event.end_time_str));
      const endMin = Math.min(gridEndMin, rawEnd);
      const topPct = ((startMin - gridStartMin) / totalRange) * 100;
      const heightPct = Math.max(5, ((endMin - startMin) / totalRange) * 100);
      result.push({
        event: p.event,
        topPct,
        heightPct,
        colIndex: p.colIndex,
        colCount,
      });
    }
  }

  return result;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  selectedSemester,
  coursesList,
  onSelectCourse,
}) => {
  const language = useLanguage();
  const isMobile = useMobileViewport();
  const currentSemesterId = useMemo(() => getCurrentSemester(), []);

  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => cache.getCalendarViewMode());
  const [mobileWeekSubView, setMobileWeekSubView] = useState<'day' | 'grid'>('day');
  const [selectedWeekday, setSelectedWeekday] = useState<number>(() => {
    const jsDay = new Date().getDay();
    return jsDay === 0 ? 0 : jsDay - 1;
  });

  const [calendarData, setCalendarData] = useState<SemesterCalendarResponse | null>(() => {
    return cache.getCachedCalendar('ALL') || cache.getCachedCalendar(selectedSemester);
  });
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(() =>
    cache.getCalendarCacheTimestamp('ALL')
  );
  const [allMemberships, setAllMemberships] = useState<CourseItem[]>(
    () => cache.getCachedAllMemberships()?.courses || []
  );

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<{
    current: number;
    total: number;
    title: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [hiddenCourses, setHiddenCourses] = useState<string[]>(() =>
    cache.getHiddenCalendarCourses('ALL')
  );
  const [ignoredCoursesLocal, setIgnoredCoursesLocal] = useState<string[]>(() =>
    cache.getIgnoredCalendarCourses()
  );

  // Courses & Calendar Status Panel Filters
  const [panelSemesterFilter, setPanelSemesterFilter] = useState<string>('ALL');
  const [panelCategoryFilter, setPanelCategoryFilter] = useState<'all' | 'courses' | 'groups'>(
    'all'
  );

  // Manual Recheck Modal State
  const [isRecheckModalOpen, setIsRecheckModalOpen] = useState<boolean>(false);
  const [selectedRecheckIds, setSelectedRecheckIds] = useState<string[]>([]);

  // Reference date for Week / Timetable / Month navigation
  const [referenceDate, setReferenceDate] = useState<Date>(() => new Date());
  const [selectedMonthDateStr, setSelectedMonthDateStr] = useState<string>(() =>
    formatYmd(new Date())
  );
  const [agendaFilter, setAgendaFilter] = useState<'upcoming' | 'all'>('all');

  // Rule Editor Modal State
  const [isRuleModalOpen, setIsRuleModalOpen] = useState<boolean>(false);
  const [editingRule, setEditingRule] = useState<CourseScheduleRule | null>(null);
  const [ruleCourseId, setRuleCourseId] = useState<string>('');
  const [ruleTitle, setRuleTitle] = useState<string>('');
  const [ruleLocation, setRuleLocation] = useState<string>('');
  const [ruleWeekdays, setRuleWeekdays] = useState<number[]>([0]);
  const [ruleStartTime, setRuleStartTime] = useState<string>('10:15');
  const [ruleEndTime, setRuleEndTime] = useState<string>('12:00');
  const [ruleStartDate, setRuleStartDate] = useState<string>('');
  const [ruleEndDate, setRuleEndDate] = useState<string>('');
  const [ruleExceptions, setRuleExceptions] = useState<string[]>([]);
  const [newExceptionDate, setNewExceptionDate] = useState<string>('');
  const [isSavingRule, setIsSavingRule] = useState<boolean>(false);

  // Export & Subscription Modal State
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [subscriptionInfo, setSubscriptionInfo] = useState<CalendarSubscriptionResponse | null>(
    null
  );
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [icsImportCourseId, setIcsImportCourseId] = useState<string>('');
  const [icsImportText, setIcsImportText] = useState<string>('');
  const [isImportingIcs, setIsImportingIcs] = useState<boolean>(false);

  // Selected Event Details Modal
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const syncRunIdRef = useRef<number>(0);
  const hasInitialLoadedRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      syncRunIdRef.current += 1;
    };
  }, []);

  // Progressive newest-to-oldest course sync that re-renders the calendar after each course
  const runProgressiveSync = useCallback(
    async (
      queue: { ref_id: string; title: string; semester?: string | null; item_type?: string }[],
      forceRefresh: boolean
    ) => {
      if (queue.length === 0) return;
      const runId = ++syncRunIdRef.current;
      setIsSyncing(true);
      setErrorMsg(null);

      // Sort newest semester first, then alphabetically
      const sortedQueue = [...queue].sort((a, b) => {
        const diff = getSemesterOrderKey(b.semester || '') - getSemesterOrderKey(a.semester || '');
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title);
      });

      try {
        for (let i = 0; i < sortedQueue.length; i++) {
          if (syncRunIdRef.current !== runId) break;
          const item = sortedQueue[i];
          setSyncProgress({
            current: i + 1,
            total: sortedQueue.length,
            title: item.title,
          });
          const synced = await api.syncCalendar({
            courses: [
              {
                ref_id: item.ref_id,
                title: item.title,
                semester: item.semester || undefined,
                item_type: item.item_type || 'crs',
              },
            ],
            force_refresh: forceRefresh,
          });
          if (syncRunIdRef.current !== runId) break;
          setCalendarData(synced);
          cache.setCachedCalendar('ALL', synced);
          setCacheTimestamp(Date.now());
        }
        if (syncRunIdRef.current === runId && forceRefresh) {
          setStatusBanner(t('calendar.sync_completed'));
        }
      } catch (err: any) {
        if (syncRunIdRef.current === runId) {
          setErrorMsg(err?.message || t('calendar.sync_failed'));
        }
      } finally {
        if (syncRunIdRef.current === runId) {
          setSyncProgress(null);
          setIsSyncing(false);
        }
      }
    },
    []
  );

  // Load global calendar once on mount (independent of selectedSemester)
  const loadGlobalCalendar = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [freshCal, discoveredCal, membershipsRes] = await Promise.all([
        api.getCalendar(),
        api.discoverCalendarCourses().catch(() => null),
        api.getMyCourses().catch(() => null),
      ]);

      const effectiveCal =
        discoveredCal && discoveredCal.courses.length >= freshCal.courses.length
          ? discoveredCal
          : freshCal;

      setCalendarData(effectiveCal);
      cache.setCachedCalendar('ALL', effectiveCal);
      setCacheTimestamp(Date.now());

      if (effectiveCal.semester_start_date && effectiveCal.semester_end_date) {
        const todayStr = formatYmd(new Date());
        if (todayStr < effectiveCal.semester_start_date || todayStr > effectiveCal.semester_end_date) {
          const semStart = parseYmd(effectiveCal.semester_start_date);
          setReferenceDate(semStart);
          setSelectedMonthDateStr(effectiveCal.semester_start_date);
        }
      }

      const rawMemberships: CourseItem[] = Array.isArray(membershipsRes)
        ? membershipsRes
        : membershipsRes?.courses || [];

      let discovered: CourseItem[] = [];
      if (rawMemberships.length > 0) {
        discovered = rawMemberships;
        setAllMemberships(rawMemberships);
        cache.setCachedAllMemberships(rawMemberships);
      } else {
        discovered = cache.getCachedAllMemberships()?.courses || [];
      }

      // Combine all known courses from Agenda discovery, memberships, and current semester coursesList
      const courseMap = new Map<
        string,
        { ref_id: string; title: string; semester?: string | null; item_type: string }
      >();
      for (const c of effectiveCal.courses) {
        courseMap.set(c.course_ref_id, {
          ref_id: c.course_ref_id,
          title: cache.getDisplayName(c.course_ref_id, c.course_title),
          semester: c.semester || null,
          item_type: c.item_type || 'crs',
        });
      }
      for (const c of discovered) {
        if (!courseMap.has(c.ref_id)) {
          courseMap.set(c.ref_id, {
            ref_id: c.ref_id,
            title: cache.getDisplayName(c.ref_id, c.title),
            semester: c.semester || null,
            item_type: c.item_type || 'crs',
          });
        }
      }
      for (const c of coursesList) {
        if (!courseMap.has(c.ref_id)) {
          courseMap.set(c.ref_id, {
            ref_id: c.ref_id,
            title: cache.getDisplayName(c.ref_id, c.title),
            semester: c.semester || selectedSemester || null,
            item_type: c.item_type || 'crs',
          });
        }
      }

      const existingById = new Map<string, CourseCalendarInfo>(
        effectiveCal.courses.map((c) => [c.course_ref_id, c])
      );

      const toAutoSync = Array.from(courseMap.values()).filter((c) => {
        const existing = existingById.get(c.ref_id);
        return isCourseAutoSyncNeeded(existing, c.semester, currentSemesterId);
      });

      if (toAutoSync.length > 0) {
        void runProgressiveSync(toAutoSync, false);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t('calendar.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [coursesList, selectedSemester, currentSemesterId, runProgressiveSync]);

  useEffect(() => {
    if (!hasInitialLoadedRef.current) {
      hasInitialLoadedRef.current = true;
      loadGlobalCalendar();
    }
  }, [loadGlobalCalendar]);

  // Merge all courses across all semesters, sorted newest semester to oldest
  const mergedCourses: CourseCalendarInfo[] = useMemo(() => {
    const ignoredSet = new Set(ignoredCoursesLocal);
    const byId = new Map<string, CourseCalendarInfo>();

    for (const c of calendarData?.courses || []) {
      const isIgnored = Boolean(c.ignored_missing_schedule || ignoredSet.has(c.course_ref_id));
      const hasLecturesOrRules =
        (c.imported_lecture_count ?? 0) > 0 || (c.custom_rule_count ?? 0) > 0;
      byId.set(c.course_ref_id, {
        ...c,
        course_title: cache.getDisplayName(c.course_ref_id, c.course_title),
        item_type: c.item_type || 'crs',
        ignored_missing_schedule: isIgnored,
        needs_manual_schedule: !hasLecturesOrRules && !isIgnored,
      });
    }

    const combinedSources: CourseItem[] = [...allMemberships, ...coursesList];
    combinedSources.forEach((c, idx) => {
      if (!byId.has(c.ref_id)) {
        const isIgnored = ignoredSet.has(c.ref_id);
        byId.set(c.ref_id, {
          course_ref_id: c.ref_id,
          course_title: cache.getDisplayName(c.ref_id, c.title),
          semester: c.semester || null,
          item_type: c.item_type || 'crs',
          color: COURSE_COLOR_PALETTE[idx % COURSE_COLOR_PALETTE.length],
          status: 'not_imported',
          feed_status: 'not_checked',
          status_message: t('calendar.status.not_checked'),
          needs_manual_schedule: !isIgnored,
          ignored_missing_schedule: isIgnored,
          imported_event_count: 0,
          imported_lecture_count: 0,
          imported_deadline_count: 0,
          custom_rule_count: 0,
        });
      }
    });

    return Array.from(byId.values()).sort((a, b) => {
      const semDiff =
        getSemesterOrderKey(b.semester || '') - getSemesterOrderKey(a.semester || '');
      if (semDiff !== 0) return semDiff;
      return a.course_title.localeCompare(b.course_title);
    });
  }, [calendarData, allMemberships, coursesList, ignoredCoursesLocal, language]);

  // Available semesters that contain courses in the calendar
  const availableCalendarSemesters = useMemo(() => {
    const sems = new Set<string>();
    for (const c of mergedCourses) {
      if (c.semester && c.semester !== 'ALL') {
        sems.add(c.semester);
      }
    }
    return Array.from(sems).sort((a, b) => getSemesterOrderKey(b) - getSemesterOrderKey(a));
  }, [mergedCourses]);

  // Filtered courses for the Courses & ILIAS Calendar Status panel
  const filteredPanelCourses = useMemo(() => {
    return mergedCourses.filter((c) => {
      const isGroupOrUndated = c.item_type === 'grp' || !c.semester;
      if (panelCategoryFilter === 'courses' && isGroupOrUndated) return false;
      if (panelCategoryFilter === 'groups' && !isGroupOrUndated) return false;
      if (panelSemesterFilter !== 'ALL' && c.semester !== panelSemesterFilter) return false;
      return true;
    });
  }, [mergedCourses, panelSemesterFilter, panelCategoryFilter]);

  const handleToggleIgnoreSchedule = async (courseRefId: string, nextIgnored: boolean) => {
    setIgnoredCoursesLocal((prev) => {
      const next = nextIgnored
        ? Array.from(new Set([...prev, courseRefId]))
        : prev.filter((id) => id !== courseRefId);
      cache.setIgnoredCalendarCourses(next);
      return next;
    });
    try {
      const updated = await api.updateCourseIgnoreSchedule(courseRefId, nextIgnored);
      setCalendarData(updated);
      cache.setCachedCalendar('ALL', updated);
    } catch (err: any) {
      setErrorMsg(err?.message || t('calendar.load_failed'));
    }
  };

  const handleRecheckCurrentSemester = () => {
    const targets = mergedCourses
      .filter((c) => !c.semester || c.semester === currentSemesterId || c.semester === selectedSemester)
      .map((c) => ({
        ref_id: c.course_ref_id,
        title: c.course_title,
        semester: c.semester || null,
        item_type: c.item_type || 'crs',
      }));
    setIsRecheckModalOpen(false);
    void runProgressiveSync(targets, true);
  };

  const handleRecheckEverything = () => {
    const targets = mergedCourses.map((c) => ({
      ref_id: c.course_ref_id,
      title: c.course_title,
      semester: c.semester || null,
      item_type: c.item_type || 'crs',
    }));
    setIsRecheckModalOpen(false);
    void runProgressiveSync(targets, true);
  };

  const handleRecheckSelectedCourses = () => {
    const selectedSet = new Set(selectedRecheckIds);
    const targets = mergedCourses
      .filter((c) => selectedSet.has(c.course_ref_id))
      .map((c) => ({
        ref_id: c.course_ref_id,
        title: c.course_title,
        semester: c.semester || null,
        item_type: c.item_type || 'crs',
      }));
    if (targets.length === 0) return;
    setIsRecheckModalOpen(false);
    void runProgressiveSync(targets, true);
  };

  const handleChangeViewMode = (mode: CalendarViewMode) => {
    setViewMode(mode);
    cache.setCalendarViewMode(mode);
  };

  const toggleCourseVisibility = (courseRefId: string) => {
    setHiddenCourses((prev) => {
      const next = prev.includes(courseRefId)
        ? prev.filter((id) => id !== courseRefId)
        : [...prev, courseRefId];
      cache.setHiddenCalendarCourses('ALL', next);
      return next;
    });
  };

  const handleColorChange = async (courseRefId: string, color: string) => {
    try {
      const updated = await api.updateCourseColor(courseRefId, color);
      setCalendarData(updated);
      cache.setCachedCalendar('ALL', updated);
    } catch (err: any) {
      setErrorMsg(err?.message || t('calendar.load_failed'));
    }
  };

  // Semester half bounds helper
  const semesterBounds = useMemo(() => {
    const start = calendarData?.semester_start_date || '2026-09-14';
    const end = calendarData?.semester_end_date || '2026-12-18';
    const startDt = parseYmd(start);
    const endDt = parseYmd(end);
    const totalDays = Math.max(14, Math.round((endDt.getTime() - startDt.getTime()) / 86400000));
    const midDt = addDays(startDt, Math.floor(totalDays / 2));
    const secondHalfStartDt = addDays(midDt, 1);
    return {
      start,
      end,
      midEnd: formatYmd(midDt),
      secondHalfStart: formatYmd(secondHalfStartDt),
    };
  }, [calendarData]);

  // Open Rule Modal (restoring draft if present)
  const openRuleModal = (courseRefId?: string, ruleToEdit?: CourseScheduleRule) => {
    const defaultCourseId =
      courseRefId ||
      ruleToEdit?.course_ref_id ||
      mergedCourses[0]?.course_ref_id ||
      coursesList[0]?.ref_id ||
      '';

    setEditingRule(ruleToEdit || null);
    setRuleCourseId(defaultCourseId);

    const savedDraft = cache.getScheduleRuleDraft(defaultCourseId, ruleToEdit?.id || null);
    if (ruleToEdit) {
      setRuleTitle(savedDraft?.title ?? ruleToEdit.title ?? '');
      setRuleLocation(savedDraft?.location ?? ruleToEdit.location ?? '');
      setRuleWeekdays(savedDraft?.weekdays ?? ruleToEdit.weekdays ?? [0]);
      setRuleStartTime(savedDraft?.start_time ?? ruleToEdit.start_time ?? '10:15');
      setRuleEndTime(savedDraft?.end_time ?? ruleToEdit.end_time ?? '12:00');
      setRuleStartDate(savedDraft?.start_date ?? ruleToEdit.start_date ?? semesterBounds.start);
      setRuleEndDate(savedDraft?.end_date ?? ruleToEdit.end_date ?? semesterBounds.end);
      setRuleExceptions(savedDraft?.exceptions ?? ruleToEdit.exceptions ?? []);
    } else {
      setRuleTitle(savedDraft?.title ?? '');
      setRuleLocation(savedDraft?.location ?? '');
      setRuleWeekdays(savedDraft?.weekdays ?? [0]);
      setRuleStartTime(savedDraft?.start_time ?? '10:15');
      setRuleEndTime(savedDraft?.end_time ?? '12:00');
      setRuleStartDate(savedDraft?.start_date ?? semesterBounds.start);
      setRuleEndDate(savedDraft?.end_date ?? semesterBounds.end);
      setRuleExceptions(savedDraft?.exceptions ?? []);
    }
    setNewExceptionDate('');
    setIsRuleModalOpen(true);
  };

  // Persist draft on change while modal is open
  useEffect(() => {
    if (!isRuleModalOpen || !ruleCourseId) return;
    cache.setScheduleRuleDraft(ruleCourseId, editingRule?.id || null, {
      course_ref_id: ruleCourseId,
      title: ruleTitle,
      location: ruleLocation,
      weekdays: ruleWeekdays,
      start_time: ruleStartTime,
      end_time: ruleEndTime,
      start_date: ruleStartDate,
      end_date: ruleEndDate,
      exceptions: ruleExceptions,
    });
  }, [
    isRuleModalOpen,
    ruleCourseId,
    editingRule,
    ruleTitle,
    ruleLocation,
    ruleWeekdays,
    ruleStartTime,
    ruleEndTime,
    ruleStartDate,
    ruleEndDate,
    ruleExceptions,
  ]);

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleCourseId) return;
    if (ruleWeekdays.length === 0) {
      setErrorMsg(t('calendar.rule.error_weekdays'));
      return;
    }
    if (ruleStartTime >= ruleEndTime) {
      setErrorMsg(t('calendar.rule.error_time_order'));
      return;
    }
    if (ruleStartDate > ruleEndDate) {
      setErrorMsg(t('calendar.rule.error_date_order'));
      return;
    }

    const courseObj = mergedCourses.find((c) => c.course_ref_id === ruleCourseId);
    const courseTitle = courseObj ? courseObj.course_title : `Kurs ${ruleCourseId}`;
    const courseSem = courseObj?.semester || selectedSemester || currentSemesterId;

    const payload: CourseScheduleRuleInput = {
      course_ref_id: ruleCourseId,
      course_title: courseTitle,
      title: ruleTitle.trim() || null,
      location: ruleLocation.trim() || null,
      weekdays: [...ruleWeekdays].sort((a, b) => a - b),
      start_time: ruleStartTime,
      end_time: ruleEndTime,
      start_date: ruleStartDate,
      end_date: ruleEndDate,
      exceptions: ruleExceptions,
      semester: courseSem,
    };

    setIsSavingRule(true);
    setErrorMsg(null);
    try {
      const updated = editingRule
        ? await api.updateScheduleRule(editingRule.id, payload)
        : await api.createScheduleRule(payload);
      setCalendarData(updated);
      cache.setCachedCalendar('ALL', updated);
      cache.clearScheduleRuleDraft(ruleCourseId, editingRule?.id || null);
      setIsRuleModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err?.message || t('calendar.rule.save_failed'));
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleDuplicateRule = async (ruleId: string) => {
    try {
      const updated = await api.duplicateScheduleRule(ruleId);
      setCalendarData(updated);
      cache.setCachedCalendar('ALL', updated);
    } catch (err: any) {
      setErrorMsg(err?.message || t('calendar.rule.save_failed'));
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      const updated = await api.deleteScheduleRule(ruleId);
      setCalendarData(updated);
      cache.setCachedCalendar('ALL', updated);
    } catch (err: any) {
      setErrorMsg(err?.message || t('calendar.rule.delete_failed'));
    }
  };

  const handleRotateSubscription = async () => {
    try {
      const sub = await api.rotateCalendarSubscription();
      setSubscriptionInfo(sub);
      const updated = await api.getCalendar();
      setCalendarData(updated);
      cache.setCachedCalendar('ALL', updated);
    } catch (err: any) {
      setErrorMsg(err?.message || t('calendar.subscription.failed'));
    }
  };

  const handleRevokeSubscription = async () => {
    try {
      await api.revokeCalendarSubscription();
      setSubscriptionInfo(null);
      const updated = await api.getCalendar();
      setCalendarData(updated);
      cache.setCachedCalendar('ALL', updated);
    } catch (err: any) {
      setErrorMsg(err?.message || t('calendar.subscription.failed'));
    }
  };

  const handleImportIcsFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!icsImportCourseId || !icsImportText.trim()) return;
    const courseObj = mergedCourses.find((c) => c.course_ref_id === icsImportCourseId);
    const courseTitle = courseObj ? courseObj.course_title : `Kurs ${icsImportCourseId}`;

    setIsImportingIcs(true);
    setErrorMsg(null);
    try {
      await api.importCourseIcs({
        course_ref_id: icsImportCourseId,
        course_title: courseTitle,
        semester: courseObj?.semester || selectedSemester,
        ics_text: icsImportText,
      });
      const updated = await api.getCalendar();
      setCalendarData(updated);
      cache.setCachedCalendar('ALL', updated);
      setIcsImportText('');
      setStatusBanner(t('calendar.import_ics.success'));
    } catch (err: any) {
      setErrorMsg(err?.message || t('calendar.import_ics.failed'));
    } finally {
      setIsImportingIcs(false);
    }
  };

  const courseColorMap = useMemo(() => {
    const m = new Map<string, string>();
    mergedCourses.forEach((c, idx) => {
      m.set(c.course_ref_id, c.color || COURSE_COLOR_PALETTE[idx % COURSE_COLOR_PALETTE.length]);
    });
    return m;
  }, [mergedCourses]);

  const visibleEvents = useMemo(() => {
    const hiddenSet = new Set(hiddenCourses);
    return (calendarData?.events || [])
      .filter((ev) => !hiddenSet.has(ev.course_ref_id) && !ev.cancelled && !ev.is_cancelled)
      .map((ev) => {
        const dateStr = ev.date || ev.date_str || '';
        const dt = dateStr ? parseYmd(dateStr) : new Date();
        const jsDay = dt.getDay();
        const weekday = jsDay === 0 ? 6 : jsDay - 1;
        return {
          ...ev,
          date_str: dateStr,
          start_time_str: ev.start_time || ev.start_time_str || '00:00',
          end_time_str: ev.end_time || ev.end_time_str || '23:59',
          weekday,
          is_cancelled: Boolean(ev.cancelled || ev.is_cancelled),
          color: ev.color || courseColorMap.get(ev.course_ref_id) || '#0AACA5',
          course_title: cache.getDisplayName(ev.course_ref_id, ev.course_title),
        };
      });
  }, [calendarData, hiddenCourses, courseColorMap]);

  // Week Monday..Sunday for the current referenceDate
  const weekDays = useMemo(() => {
    const monday = getMondayOfWeek(referenceDate);
    return Array.from({ length: 7 }, (_, i) => {
      const dt = addDays(monday, i);
      return {
        weekday: i,
        date: dt,
        dateStr: formatYmd(dt),
      };
    });
  }, [referenceDate]);

  const weekEventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);
    const dateToWeekday = new Map(weekDays.map((d) => [d.dateStr, d.weekday]));

    for (const ev of visibleEvents) {
      const wd = dateToWeekday.get(ev.date_str);
      if (wd !== undefined) {
        map.get(wd)!.push(ev);
      }
    }
    return map;
  }, [visibleEvents, weekDays]);

  // Dynamic time range for week/timetable grid (defaults 08:00 - 20:00)
  const { gridStartHour, gridEndHour, hoursList } = useMemo(() => {
    let minH = 8;
    let maxH = 20;
    for (let i = 0; i < 7; i++) {
      for (const ev of weekEventsByDay.get(i) || []) {
        if (ev.all_day) continue;
        const sh = Math.floor(timeToMinutes(ev.start_time_str) / 60);
        const eh = Math.ceil(timeToMinutes(ev.end_time_str) / 60);
        if (sh < minH) minH = Math.max(6, sh);
        if (eh > maxH) maxH = Math.min(23, eh);
      }
    }
    const hrs: number[] = [];
    for (let h = minH; h < maxH; h++) hrs.push(h);
    return { gridStartHour: minH, gridEndHour: maxH, hoursList: hrs };
  }, [weekEventsByDay]);

  // Show Saturday/Sunday in timetable if weekend events exist, or always in 'week' view
  const displayedWeekdays = useMemo(() => {
    if (viewMode === 'week') return [0, 1, 2, 3, 4, 5, 6];
    const hasSat = (weekEventsByDay.get(5)?.length || 0) > 0;
    const hasSun = (weekEventsByDay.get(6)?.length || 0) > 0;
    if (hasSun) return [0, 1, 2, 3, 4, 5, 6];
    if (hasSat) return [0, 1, 2, 3, 4, 5];
    return [0, 1, 2, 3, 4];
  }, [viewMode, weekEventsByDay]);

  // Month grid cells
  const monthCells = useMemo(() => {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    const firstOfMonth = new Date(year, month, 1, 12, 0, 0);
    const gridStart = getMondayOfWeek(firstOfMonth);
    const eventsByDate = new Map<string, CalendarEvent[]>();
    for (const ev of visibleEvents) {
      if (!eventsByDate.has(ev.date_str)) eventsByDate.set(ev.date_str, []);
      eventsByDate.get(ev.date_str)!.push(ev);
    }

    return Array.from({ length: 42 }, (_, idx) => {
      const dt = addDays(gridStart, idx);
      const dateStr = formatYmd(dt);
      return {
        date: dt,
        dateStr,
        inCurrentMonth: dt.getMonth() === month,
        events: eventsByDate.get(dateStr) || [],
      };
    });
  }, [referenceDate, visibleEvents]);

  // Agenda grouped events
  const agendaGroups = useMemo(() => {
    const todayStr = formatYmd(new Date());
    const filtered = visibleEvents.filter((ev) =>
      agendaFilter === 'upcoming' ? ev.date_str >= todayStr : true
    );
    const groups = new Map<string, CalendarEvent[]>();
    for (const ev of filtered) {
      if (!groups.has(ev.date_str)) groups.set(ev.date_str, []);
      groups.get(ev.date_str)!.push(ev);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleEvents, agendaFilter]);

  const coursesNeedingScheduleCount = useMemo(
    () => mergedCourses.filter((c) => c.needs_manual_schedule).length,
    [mergedCourses]
  );

  const renderFeedStatusBadge = (status: CourseCalendarFeedStatus) => {
    switch (status) {
      case 'imported_with_lectures':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            <Check className="h-3 w-3" />
            {t('calendar.status.badge_lectures')}
          </span>
        );
      case 'imported_deadlines_only':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            {t('calendar.status.badge_deadlines_only')}
          </span>
        );
      case 'valid_empty':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <Info className="h-3 w-3" />
            {t('calendar.status.badge_empty')}
          </span>
        );
      case 'session_expired':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
            <AlertTriangle className="h-3 w-3" />
            {t('calendar.status.badge_expired')}
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
            <AlertTriangle className="h-3 w-3" />
            {t('calendar.status.badge_failed')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <Info className="h-3 w-3" />
            {t('calendar.status.badge_manual')}
          </span>
        );
    }
  };

  const navigatePeriod = (direction: -1 | 0 | 1) => {
    if (direction === 0) {
      const now = new Date();
      setReferenceDate(now);
      setSelectedMonthDateStr(formatYmd(now));
      return;
    }
    if (viewMode === 'month') {
      const next = new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth() + direction,
        1,
        12,
        0,
        0
      );
      setReferenceDate(next);
      setSelectedMonthDateStr(formatYmd(next));
    } else {
      const next = addDays(referenceDate, direction * 7);
      setReferenceDate(next);
    }
  };

  const jumpToSemesterHalf = (half: 'first' | 'second') => {
    if (half === 'first') {
      const dt = addDays(parseYmd(semesterBounds.start), 7);
      setReferenceDate(dt);
    } else {
      const dt = addDays(parseYmd(semesterBounds.secondHalfStart), 7);
      setReferenceDate(dt);
    }
  };

  const activeSubscriptionUrl =
    subscriptionInfo?.subscription_url || calendarData?.subscription_url || null;

  const effectiveCacheAge = useMemo(
    () => formatTimestampAge(calendarData?.fetched_at || cacheTimestamp, language),
    [calendarData?.fetched_at, cacheTimestamp, language]
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Top Header & Primary Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight flex flex-wrap items-center gap-2.5">
            <CalendarIcon className="h-6 w-6 shrink-0" style={{ color: 'var(--accent, #0AACA5)' }} />
            <span>{t('calendar.title')}</span>
            <span
              className="rounded-lg px-2.5 py-0.5 text-xs font-bold"
              style={{
                backgroundColor: 'var(--accent-light, rgba(10, 172, 165, 0.14))',
                color: 'var(--accent, #0AACA5)',
              }}
            >
              {t('calendar.all_semesters_badge')}
            </span>
            {(isLoading || isSyncing) && (
              <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
            )}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span>
              {t('calendar.subtitle', {
                start: semesterBounds.start,
                end: semesterBounds.end,
              })}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Clock className="h-3 w-3" />
              {t('calendar.cache_age_label', { time: effectiveCacheAge })}
            </span>
          </div>
        </div>

        {/* Action Buttons (>= 44px height on mobile for comfortable touch targets) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openRuleModal()}
            style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
            className="min-h-11 sm:min-h-9 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-xs hover:opacity-90 transition cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>{t('calendar.add_schedule')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedRecheckIds(
                mergedCourses
                  .filter((c) => c.semester === currentSemesterId)
                  .map((c) => c.course_ref_id)
              );
              setIsRecheckModalOpen(true);
            }}
            className="min-h-11 sm:min-h-9 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{t('calendar.recheck.button')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!icsImportCourseId && mergedCourses[0]) {
                setIcsImportCourseId(mergedCourses[0].course_ref_id);
              }
              setIsExportModalOpen(true);
            }}
            className="min-h-11 sm:min-h-9 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            <Share2 className="h-4 w-4" />
            <span>{t('calendar.export_subscribe')}</span>
          </button>
        </div>
      </div>

      {/* Progressive Sync Live Status Banner */}
      {syncProgress && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-[#0AACA5]/30 bg-[#0AACA5]/10 px-4 py-3 text-xs text-slate-800 dark:text-slate-100 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-[#0AACA5]" />
              <span className="font-bold truncate">
                {t('calendar.sync_progress', {
                  current: syncProgress.current,
                  total: syncProgress.total,
                  title: syncProgress.title,
                })}
              </span>
            </div>
            <span className="text-[11px] font-bold text-[#0AACA5] shrink-0">
              {Math.round((syncProgress.current / Math.max(1, syncProgress.total)) * 100)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full bg-[#0AACA5] transition-all duration-200"
              style={{
                width: `${Math.min(100, Math.round((syncProgress.current / Math.max(1, syncProgress.total)) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Notices & Error Banners */}
      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 flex items-center justify-between gap-3 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            aria-label={t('Schliessen')}
            className="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/40 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {statusBanner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 flex items-center justify-between gap-3 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{statusBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            aria-label={t('Schliessen')}
            className="p-1 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {coursesNeedingScheduleCount > 0 && (
        <div className="rounded-2xl border border-amber-200/90 bg-amber-50/80 px-4 py-3.5 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-start gap-2.5">
            <Sparkles className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="font-bold">
                {t('calendar.manual_schedule_hint_title', {
                  count: coursesNeedingScheduleCount,
                })}
              </p>
              <p className="text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                {t('calendar.manual_schedule_hint_body')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const firstNeeding = mergedCourses.find((c) => c.needs_manual_schedule);
              openRuleModal(firstNeeding?.course_ref_id);
            }}
            className="min-h-11 sm:min-h-9 shrink-0 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-700 transition cursor-pointer"
          >
            {t('calendar.add_schedule')}
          </button>
        </div>
      )}

      {/* View Switcher & Date Navigation Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* 4 View Mode Tabs */}
        <div
          role="tablist"
          aria-label={t('calendar.views_label')}
          className="grid grid-cols-2 sm:flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
        >
          {(
            [
              { id: 'timetable', label: t('calendar.view.timetable') },
              { id: 'week', label: t('calendar.view.week') },
              { id: 'month', label: t('calendar.view.month') },
              { id: 'agenda', label: t('calendar.view.agenda') },
            ] as { id: CalendarViewMode; label: string }[]
          ).map((tab) => {
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => handleChangeViewMode(tab.id)}
                className={`min-h-11 sm:min-h-8 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Date / Semester Period Navigation */}
        {viewMode !== 'agenda' ? (
          <div className="flex flex-wrap items-center justify-between md:justify-end gap-2">
            {viewMode === 'timetable' && (
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => jumpToSemesterHalf('first')}
                  className="min-h-9 sm:min-h-7 rounded-lg px-2.5 py-1 font-semibold text-slate-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700 transition cursor-pointer"
                >
                  {t('calendar.period.first_half')}
                </button>
                <button
                  type="button"
                  onClick={() => jumpToSemesterHalf('second')}
                  className="min-h-9 sm:min-h-7 rounded-lg px-2.5 py-1 font-semibold text-slate-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700 transition cursor-pointer"
                >
                  {t('calendar.period.second_half')}
                </button>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => navigatePeriod(-1)}
                aria-label={t('calendar.prev')}
                className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => navigatePeriod(0)}
                className="min-h-11 sm:min-h-8 rounded-xl border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                {t('calendar.today')}
              </button>
              <button
                type="button"
                onClick={() => navigatePeriod(1)}
                aria-label={t('calendar.next')}
                className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 ml-1">
                {viewMode === 'month'
                  ? referenceDate.toLocaleDateString(language === 'en' ? 'en-GB' : 'de-CH', {
                      month: 'long',
                      year: 'numeric',
                    })
                  : `${weekDays[0].dateStr} – ${weekDays[displayedWeekdays.length - 1].dateStr}`}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setAgendaFilter('upcoming')}
              className={`min-h-10 sm:min-h-8 rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer ${
                agendaFilter === 'upcoming'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t('calendar.agenda.upcoming')}
            </button>
            <button
              type="button"
              onClick={() => setAgendaFilter('all')}
              className={`min-h-10 sm:min-h-8 rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer ${
                agendaFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t('calendar.agenda.entire_semester')}
            </button>
          </div>
        )}
      </div>

      {/* Main Content Layout: Calendar Viewport + Course Status & Schedule Rules Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left/Center 8 cols: Active Calendar or Timetable View */}
        <div className="xl:col-span-8 space-y-4 min-w-0">
          {/* TIMETABLE OR WEEK VIEW */}
          {(viewMode === 'timetable' || viewMode === 'week') && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
              {/* Mobile Day Selector Pill Bar */}
              {isMobile && (
                <div className="border-b border-slate-200 dark:border-slate-800 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      {t('calendar.mobile.select_day')}
                    </span>
                    <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => setMobileWeekSubView('day')}
                        className={`min-h-9 rounded-md px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                          mobileWeekSubView === 'day'
                            ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {t('calendar.mobile.day_view')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobileWeekSubView('grid')}
                        className={`min-h-9 rounded-md px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                          mobileWeekSubView === 'grid'
                            ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {t('calendar.mobile.week_grid')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {weekDays.map((wd) => {
                      const dayEvents = weekEventsByDay.get(wd.weekday) || [];
                      const isSelected = selectedWeekday === wd.weekday;
                      return (
                        <button
                          key={wd.dateStr}
                          type="button"
                          onClick={() => {
                            setSelectedWeekday(wd.weekday);
                            setMobileWeekSubView('day');
                          }}
                          className={`min-h-12 flex flex-col items-center justify-center rounded-xl py-1.5 px-1 text-xs font-bold transition cursor-pointer ${
                            isSelected
                              ? 'bg-[#0AACA5] text-white shadow-xs'
                              : 'bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-800/70 dark:text-slate-200'
                          }`}
                        >
                          <span className="text-[10px] opacity-80">
                            {t(WEEKDAY_SHORT_KEYS[wd.weekday])}
                          </span>
                          <span>{wd.date.getDate()}</span>
                          <div className="flex items-center gap-0.5 mt-0.5 h-1.5">
                            {dayEvents.slice(0, 3).map((ev) => (
                              <span
                                key={ev.uid}
                                className="h-1.5 w-1.5 rounded-full"
                                style={{
                                  backgroundColor: isSelected
                                    ? '#ffffff'
                                    : ev.color || '#0AACA5',
                                }}
                              />
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Mobile Single-Day Comfortable View */}
              {isMobile && mobileWeekSubView === 'day' ? (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {t(WEEKDAY_LONG_KEYS[selectedWeekday])} ({weekDays[selectedWeekday]?.dateStr})
                    </h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {(weekEventsByDay.get(selectedWeekday) || []).length}{' '}
                      {t('calendar.events_count')}
                    </span>
                  </div>

                  {(weekEventsByDay.get(selectedWeekday) || []).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      {t('calendar.no_events_on_day')}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {(weekEventsByDay.get(selectedWeekday) || []).map((ev) => (
                        <button
                          key={ev.uid}
                          type="button"
                          onClick={() => setSelectedEvent(ev)}
                          className="w-full text-left rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 hover:bg-slate-100/80 dark:border-slate-800 dark:bg-slate-800/50 dark:hover:bg-slate-800 transition flex items-start gap-3 cursor-pointer"
                        >
                          <div
                            className="w-1.5 self-stretch rounded-full shrink-0"
                            style={{ backgroundColor: ev.color || '#0AACA5' }}
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                {ev.title}
                              </span>
                              <span className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 shadow-2xs dark:bg-slate-900 dark:text-slate-200">
                                {ev.all_day
                                  ? t('calendar.all_day')
                                  : `${ev.start_time_str}–${ev.end_time_str}`}
                              </span>
                            </div>
                            <p className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
                              {ev.course_title}
                            </p>
                            {ev.location && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">{ev.location}</span>
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Desktop / Tablet (or Mobile Grid Subview) Multi-Column Time Grid */
                <div
                  className="overflow-x-auto"
                  role="region"
                  aria-label={t('calendar.view.timetable')}
                  tabIndex={0}
                >
                  <div className="min-w-[680px]">
                    {/* Column Headers */}
                    <div
                      className="grid border-b border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/50"
                      style={{
                        gridTemplateColumns: `64px repeat(${displayedWeekdays.length}, minmax(0, 1fr))`,
                      }}
                    >
                      <div className="p-2 text-center text-[10px] font-bold uppercase text-slate-400">
                        CET/CEST
                      </div>
                      {displayedWeekdays.map((wd) => {
                        const dayInfo = weekDays[wd];
                        const isToday = dayInfo.dateStr === formatYmd(new Date());
                        return (
                          <div
                            key={wd}
                            className={`border-l border-slate-200/80 p-2.5 text-center dark:border-slate-800 ${
                              isToday ? 'bg-[#0AACA5]/10' : ''
                            }`}
                          >
                            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                              {t(WEEKDAY_SHORT_KEYS[wd])}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {dayInfo.date.getDate()}.{dayInfo.date.getMonth() + 1}.
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* All-Day / Deadlines Strip */}
                    {displayedWeekdays.some((wd) =>
                      (weekEventsByDay.get(wd) || []).some((e) => e.all_day)
                    ) && (
                      <div
                        className="grid border-b border-slate-200 bg-amber-50/30 dark:border-slate-800 dark:bg-amber-950/10"
                        style={{
                          gridTemplateColumns: `64px repeat(${displayedWeekdays.length}, minmax(0, 1fr))`,
                        }}
                      >
                        <div className="p-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 flex items-center justify-center">
                          {t('calendar.all_day')}
                        </div>
                        {displayedWeekdays.map((wd) => {
                          const allDayEvs = (weekEventsByDay.get(wd) || []).filter(
                            (e) => e.all_day
                          );
                          return (
                            <div
                              key={wd}
                              className="border-l border-slate-200/80 p-1.5 space-y-1 dark:border-slate-800"
                            >
                              {allDayEvs.map((ev) => (
                                <button
                                  key={ev.uid}
                                  type="button"
                                  onClick={() => setSelectedEvent(ev)}
                                  style={{
                                    backgroundColor: `${ev.color || '#0AACA5'}22`,
                                    borderLeft: `3px solid ${ev.color || '#0AACA5'}`,
                                  }}
                                  className="w-full text-left rounded px-1.5 py-1 text-[10px] font-bold text-slate-800 dark:text-slate-100 truncate block cursor-pointer hover:opacity-90"
                                  title={`${ev.title} (${ev.course_title})`}
                                >
                                  {ev.title}
                                </button>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Timed Grid Body */}
                    <div
                      className="grid relative"
                      style={{
                        gridTemplateColumns: `64px repeat(${displayedWeekdays.length}, minmax(0, 1fr))`,
                        height: `${hoursList.length * 56}px`,
                      }}
                    >
                      {/* Hour Labels Column */}
                      <div className="relative border-r border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40">
                        {hoursList.map((hr, idx) => (
                          <div
                            key={hr}
                            style={{ top: `${idx * 56}px`, height: '56px' }}
                            className="absolute inset-x-0 border-b border-slate-100 dark:border-slate-800/70 pr-2 pt-1 text-right text-[11px] font-semibold text-slate-400"
                          >
                            {String(hr).padStart(2, '0')}:00
                          </div>
                        ))}
                      </div>

                      {/* Day Columns with Positioned Events */}
                      {displayedWeekdays.map((wd) => {
                        const dayEvs = weekEventsByDay.get(wd) || [];
                        const positioned = layoutDayEvents(
                          dayEvs,
                          gridStartHour * 60,
                          gridEndHour * 60
                        );
                        return (
                          <div
                            key={wd}
                            className="relative border-l border-slate-200/70 dark:border-slate-800"
                          >
                            {/* Horizontal hour lines */}
                            {hoursList.map((hr, idx) => (
                              <div
                                key={hr}
                                style={{ top: `${idx * 56}px`, height: '56px' }}
                                className="absolute inset-x-0 border-b border-slate-100 dark:border-slate-800/60 pointer-events-none"
                              />
                            ))}

                            {/* Positioned Event Blocks */}
                            {positioned.map((pos) => {
                              const widthPct = 100 / pos.colCount;
                              const leftPct = pos.colIndex * widthPct;
                              const color = pos.event.color || '#0AACA5';
                              return (
                                <button
                                  key={pos.event.uid}
                                  type="button"
                                  onClick={() => setSelectedEvent(pos.event)}
                                  style={{
                                    top: `${pos.topPct}%`,
                                    height: `${pos.heightPct}%`,
                                    left: `calc(${leftPct}% + 2px)`,
                                    width: `calc(${widthPct}% - 4px)`,
                                    backgroundColor: `${color}1F`,
                                    borderLeft: `4px solid ${color}`,
                                  }}
                                  className="absolute rounded-lg p-1.5 text-left overflow-hidden shadow-2xs hover:shadow-md transition flex flex-col justify-between cursor-pointer bg-white/90 dark:bg-slate-900/90"
                                  title={`${pos.event.start_time_str}–${pos.event.end_time_str} ${pos.event.title} (${pos.event.course_title})`}
                                >
                                  <div className="min-w-0">
                                    <div
                                      className="text-[10px] font-extrabold leading-tight truncate"
                                      style={{ color }}
                                    >
                                      {pos.event.start_time_str}–{pos.event.end_time_str}
                                    </div>
                                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2">
                                      {pos.event.title}
                                    </div>
                                    {pos.event.title !== pos.event.course_title && (
                                      <div className="text-[10px] font-medium text-slate-600 dark:text-slate-300 truncate">
                                        {pos.event.course_title}
                                      </div>
                                    )}
                                  </div>
                                  {pos.event.location && (
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-0.5">
                                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                                      <span className="truncate">{pos.event.location}</span>
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MONTH VIEW */}
          {viewMode === 'month' && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50">
                {WEEKDAY_SHORT_KEYS.map((key) => (
                  <div
                    key={key}
                    className="py-2 text-center text-xs font-bold text-slate-600 dark:text-slate-300"
                  >
                    {t(key)}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {monthCells.map((cell) => {
                  const isSelected = cell.dateStr === selectedMonthDateStr;
                  const isToday = cell.dateStr === formatYmd(new Date());
                  return (
                    <div
                      key={cell.dateStr}
                      onClick={() => setSelectedMonthDateStr(cell.dateStr)}
                      className={`min-h-16 sm:min-h-24 border-b border-r border-slate-100 p-1.5 sm:p-2 transition cursor-pointer dark:border-slate-800 ${
                        !cell.inCurrentMonth
                          ? 'bg-slate-50/50 text-slate-400 dark:bg-slate-950/40 dark:text-slate-600'
                          : 'bg-white dark:bg-slate-900'
                      } ${isSelected ? 'ring-2 ring-inset ring-[#0AACA5]' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                            isToday
                              ? 'bg-[#0AACA5] text-white'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {cell.date.getDate()}
                        </span>
                        {cell.events.length > 0 && (
                          <span className="text-[10px] font-bold text-slate-400 sm:hidden">
                            {cell.events.length}
                          </span>
                        )}
                      </div>

                      {/* Desktop event pills */}
                      <div className="hidden sm:block mt-1 space-y-1">
                        {cell.events.slice(0, 3).map((ev) => (
                          <button
                            key={ev.uid}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(ev);
                            }}
                            style={{
                              backgroundColor: `${ev.color || '#0AACA5'}20`,
                              borderLeft: `3px solid ${ev.color || '#0AACA5'}`,
                            }}
                            className="w-full text-left truncate rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-800 dark:text-slate-100 block cursor-pointer"
                          >
                            {!ev.all_day && `${ev.start_time_str} `}
                            {ev.title}
                          </button>
                        ))}
                        {cell.events.length > 3 && (
                          <div className="text-[10px] font-bold text-slate-500 pl-1">
                            +{cell.events.length - 3} {t('calendar.more')}
                          </div>
                        )}
                      </div>

                      {/* Mobile event dots */}
                      <div className="flex sm:hidden flex-wrap gap-1 mt-2">
                        {cell.events.slice(0, 4).map((ev) => (
                          <span
                            key={ev.uid}
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: ev.color || '#0AACA5' }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Selected Day Event Details List below Month Grid */}
              <div className="border-t border-slate-200 p-4 dark:border-slate-800 space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t('calendar.events_on_date', { date: selectedMonthDateStr })}
                </h3>
                {(() => {
                  const dayEvs =
                    monthCells.find((c) => c.dateStr === selectedMonthDateStr)?.events || [];
                  if (dayEvs.length === 0) {
                    return (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t('calendar.no_events_on_day')}
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {dayEvs.map((ev) => (
                        <button
                          key={ev.uid}
                          type="button"
                          onClick={() => setSelectedEvent(ev)}
                          className="w-full text-left rounded-xl border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60 flex items-center justify-between gap-3 cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: ev.color || '#0AACA5' }}
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                {ev.title}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {ev.course_title}
                                {ev.location ? ` • ${ev.location}` : ''}
                              </p>
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-bold text-slate-700 dark:text-slate-200">
                            {ev.all_day
                              ? t('calendar.all_day')
                              : `${ev.start_time_str}–${ev.end_time_str}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* AGENDA VIEW */}
          {viewMode === 'agenda' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-5">
              {agendaGroups.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <CalendarIcon className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {t('calendar.agenda.empty_title')}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    {t('calendar.agenda.empty_body')}
                  </p>
                </div>
              ) : (
                agendaGroups.map(([dateStr, evs]) => {
                  const dt = parseYmd(dateStr);
                  return (
                    <div key={dateStr} className="space-y-2">
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-1.5 dark:border-slate-800">
                        <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                          {dt.toLocaleDateString(language === 'en' ? 'en-GB' : 'de-CH', {
                            weekday: 'long',
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                        <span className="text-[11px] text-slate-400">({dateStr})</span>
                      </div>
                      <div className="space-y-2">
                        {evs.map((ev) => (
                          <div
                            key={ev.uid}
                            onClick={() => setSelectedEvent(ev)}
                            className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 hover:bg-slate-100/70 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-800"
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <div
                                className="w-1.5 self-stretch rounded-full shrink-0"
                                style={{ backgroundColor: ev.color || '#0AACA5' }}
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                    {ev.title}
                                  </span>
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-slate-200/70 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                    {ev.kind === 'deadline'
                                      ? t('calendar.kind.deadline')
                                      : ev.kind === 'lecture'
                                      ? t('calendar.kind.lecture')
                                      : t('calendar.kind.appointment')}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-300 truncate mt-0.5">
                                  {ev.course_title}
                                  {ev.location ? ` • ${ev.location}` : ''}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                              <span className="rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs dark:bg-slate-900 dark:text-slate-200">
                                {ev.all_day
                                  ? t('calendar.all_day')
                                  : `${ev.start_time_str}–${ev.end_time_str}`}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Right 4 cols: Courses, ILIAS Calendar Statuses, Semester/Category Filters & Custom Schedule Rules */}
        <div className="xl:col-span-4 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                  {t('calendar.courses_panel.title')}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t('calendar.courses_panel.subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openRuleModal()}
                className="min-h-10 sm:min-h-8 inline-flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('calendar.rule.add_short')}</span>
              </button>
            </div>

            {/* Semester & Category Filter Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="space-y-1">
                <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  <Filter className="h-3 w-3 text-[#0AACA5]" />
                  <span>{t('calendar.filter.semester_label')}</span>
                </label>
                <select
                  value={panelSemesterFilter}
                  onChange={(e) => setPanelSemesterFilter(e.target.value)}
                  aria-label={t('calendar.filter.semester_label')}
                  className="min-h-12 sm:min-h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="ALL">{t('calendar.filter.all_semesters')}</option>
                  {availableCalendarSemesters.map((sem) => (
                    <option key={sem} value={sem}>
                      {sem}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  <Filter className="h-3 w-3 text-[#0AACA5]" />
                  <span>{t('calendar.filter.category_label')}</span>
                </label>
                <select
                  value={panelCategoryFilter}
                  onChange={(e) =>
                    setPanelCategoryFilter(e.target.value as 'all' | 'courses' | 'groups')
                  }
                  aria-label={t('calendar.filter.category_label')}
                  className="min-h-12 sm:min-h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="all">{t('calendar.filter.category_all')}</option>
                  <option value="courses">{t('calendar.filter.category_courses')}</option>
                  <option value="groups">{t('calendar.filter.category_groups')}</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              {filteredPanelCourses.map((course) => {
                const isHidden = hiddenCourses.includes(course.course_ref_id);
                const courseRules = (calendarData?.rules || []).filter(
                  (r) => r.course_ref_id === course.course_ref_id
                );
                const hasLecturesOrRules =
                  (course.imported_lecture_count ?? 0) > 0 || (course.custom_rule_count ?? 0) > 0;
                const canToggleIgnore = !hasLecturesOrRules || course.ignored_missing_schedule;

                return (
                  <div
                    key={course.course_ref_id}
                    className={`rounded-xl border p-3.5 transition space-y-2.5 ${
                      isHidden
                        ? 'border-slate-200/60 bg-slate-50/40 opacity-60 dark:border-slate-800/60 dark:bg-slate-900/30'
                        : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40'
                    }`}
                  >
                    {/* Course Header Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <label
                          className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full cursor-pointer shadow-2xs border border-white/50"
                          style={{ backgroundColor: course.color }}
                          title={t('calendar.change_color')}
                        >
                          <input
                            type="color"
                            value={course.color}
                            onChange={(e) =>
                              handleColorChange(course.course_ref_id, e.target.value)
                            }
                            aria-label={`${t('calendar.change_color')}: ${course.course_title}`}
                            className="sr-only"
                          />
                        </label>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onSelectCourse(course.course_ref_id)}
                            className="text-left text-xs font-bold text-slate-900 hover:text-[#0AACA5] dark:text-slate-100 truncate block max-w-full cursor-pointer"
                            title={course.course_title}
                          >
                            {course.course_title}
                          </button>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                              {course.semester || t('my_courses.group')}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">
                              {course.last_imported_at
                                ? t('calendar.course_last_checked', {
                                    time: formatTimestampAge(course.last_imported_at, language),
                                  })
                                : t('calendar.course_never_checked')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleCourseVisibility(course.course_ref_id)}
                          aria-label={
                            isHidden ? t('calendar.show_course') : t('calendar.hide_course')
                          }
                          title={isHidden ? t('calendar.show_course') : t('calendar.hide_course')}
                          className="min-h-9 min-w-9 sm:min-h-7 sm:min-w-7 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-700 cursor-pointer"
                        >
                          {isHidden ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => openRuleModal(course.course_ref_id)}
                          className="min-h-9 sm:min-h-7 inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                        >
                          <Plus className="h-3 w-3" />
                          <span>{t('calendar.rule.add_short')}</span>
                        </button>
                      </div>
                    </div>

                    {/* ILIAS Calendar Status Badge & Message */}
                    <div className="space-y-1.5">
                      <div className="flex items-center flex-wrap gap-1.5">
                        {renderFeedStatusBadge(
                          course.status || course.feed_status || 'not_imported'
                        )}
                        {course.ignored_missing_schedule && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            <BellOff className="h-3 w-3" />
                            {t('calendar.status.badge_ignored')}
                          </span>
                        )}
                        {(course.custom_rule_count ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#0AACA5]/15 px-2 py-0.5 text-[11px] font-semibold text-[#0AACA5]">
                            {course.custom_rule_count ?? 0} {t('calendar.rules_active')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                        {course.status_message}
                      </p>

                      {canToggleIgnore && (
                        <div className="pt-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleIgnoreSchedule(
                                course.course_ref_id,
                                !course.ignored_missing_schedule
                              )
                            }
                            className="min-h-9 sm:min-h-7 inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            {course.ignored_missing_schedule ? (
                              <>
                                <Bell className="h-3 w-3 text-[#0AACA5]" />
                                <span>{t('calendar.unignore_missing_schedule')}</span>
                              </>
                            ) : (
                              <>
                                <BellOff className="h-3 w-3 text-slate-400" />
                                <span>{t('calendar.ignore_missing_schedule')}</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Custom Weekly Schedule Rules for this Course */}
                    {courseRules.length > 0 && (
                      <div className="pt-1.5 border-t border-slate-200/70 dark:border-slate-700/60 space-y-1.5">
                        {courseRules.map((rule) => (
                          <div
                            key={rule.id}
                            className="rounded-lg bg-white p-2 text-[11px] shadow-2xs dark:bg-slate-900 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-slate-800 dark:text-slate-200 truncate">
                                {rule.weekdays
                                  .map((wd) => t(WEEKDAY_SHORT_KEYS[wd]))
                                  .join(', ')}{' '}
                                • {rule.start_time}–{rule.end_time}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                {rule.start_date} → {rule.end_date}
                                {rule.location ? ` • ${rule.location}` : ''}
                                {rule.exceptions.length > 0
                                  ? ` (${rule.exceptions.length} ${t('calendar.rule.exceptions_short')})`
                                  : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => openRuleModal(course.course_ref_id, rule)}
                                title={t('calendar.rule.edit')}
                                aria-label={t('calendar.rule.edit')}
                                className="min-h-8 min-w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDuplicateRule(rule.id)}
                                title={t('calendar.rule.duplicate')}
                                aria-label={t('calendar.rule.duplicate')}
                                className="min-h-8 min-w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRule(rule.id)}
                                title={t('calendar.rule.delete')}
                                aria-label={t('calendar.rule.delete')}
                                className="min-h-8 min-w-8 inline-flex items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* MANUAL RECHECK MODAL (Specific courses checkbox list, Current Semester, or Everything) */}
      {isRecheckModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsRecheckModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('calendar.recheck.modal_title')}
            style={{ colorScheme: 'light dark' }}
            className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                {t('calendar.recheck.modal_title')}
              </h2>
              <button
                type="button"
                onClick={() => setIsRecheckModalOpen(false)}
                aria-label={t('Schliessen')}
                className="min-h-10 min-w-10 inline-flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('calendar.recheck.modal_desc')}
            </p>

            {/* Quick Recheck Buttons: Current Semester vs Everything */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleRecheckCurrentSemester}
                style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                className="min-h-11 rounded-xl px-3.5 py-2.5 text-xs font-bold text-white shadow-xs hover:opacity-90 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="h-4 w-4 shrink-0" />
                <span>
                  {t('calendar.recheck.current_semester', { semester: currentSemesterId })}
                </span>
              </button>

              <button
                type="button"
                onClick={handleRecheckEverything}
                className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="h-4 w-4 shrink-0" />
                <span>{t('calendar.recheck.everything')}</span>
              </button>
            </div>

            {/* Specific Courses Checkbox List */}
            <div className="space-y-2.5 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {t('calendar.courses_panel.title')}
                </h3>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedRecheckIds(mergedCourses.map((c) => c.course_ref_id))
                    }
                    className="font-semibold text-[#0AACA5] hover:underline cursor-pointer"
                  >
                    {t('calendar.recheck.select_all')}
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <button
                    type="button"
                    onClick={() => setSelectedRecheckIds([])}
                    className="font-semibold text-slate-500 hover:underline dark:text-slate-400 cursor-pointer"
                  >
                    {t('calendar.recheck.deselect_all')}
                  </button>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 dark:border-slate-800 dark:divide-slate-800/70">
                {mergedCourses.map((course) => {
                  const checked = selectedRecheckIds.includes(course.course_ref_id);
                  return (
                    <label
                      key={course.course_ref_id}
                      className="min-h-11 flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            setSelectedRecheckIds((prev) =>
                              isChecked
                                ? Array.from(new Set([...prev, course.course_ref_id]))
                                : prev.filter((id) => id !== course.course_ref_id)
                            );
                          }}
                          className="h-4 w-4 shrink-0 rounded accent-[#0AACA5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0AACA5]"
                        />
                        <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {course.course_title}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {course.semester || t('my_courses.group')}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {course.last_imported_at
                            ? formatTimestampAge(course.last_imported_at, language)
                            : '—'}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRecheckModalOpen(false)}
                  className="min-h-11 sm:min-h-9 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  {t('Abbrechen')}
                </button>
                <button
                  type="button"
                  disabled={selectedRecheckIds.length === 0}
                  onClick={handleRecheckSelectedCourses}
                  style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                  className="min-h-11 sm:min-h-9 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-xs hover:opacity-90 transition cursor-pointer disabled:opacity-50"
                >
                  {t('calendar.recheck.selected', { count: selectedRecheckIds.length })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULE RULE EDITOR MODAL */}
      {isRuleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsRuleModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              editingRule ? t('calendar.rule.modal_edit_title') : t('calendar.rule.modal_add_title')
            }
            className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                {editingRule
                  ? t('calendar.rule.modal_edit_title')
                  : t('calendar.rule.modal_add_title')}
              </h2>
              <button
                type="button"
                onClick={() => setIsRuleModalOpen(false)}
                aria-label={t('Schliessen')}
                className="min-h-10 min-w-10 inline-flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="space-y-4">
              {/* Course Selection */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('calendar.rule.course_label')}
                </label>
                <select
                  value={ruleCourseId}
                  onChange={(e) => setRuleCourseId(e.target.value)}
                  className="min-h-12 sm:min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {mergedCourses.map((c) => (
                    <option key={c.course_ref_id} value={c.course_ref_id}>
                      {c.course_title} {c.semester ? `(${c.semester})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Weekdays Selection (supports multiple slots per week) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('calendar.rule.weekdays_label')}
                </label>
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAY_SHORT_KEYS.map((key, wd) => {
                    const selected = ruleWeekdays.includes(wd);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setRuleWeekdays((prev) =>
                            prev.includes(wd) ? prev.filter((d) => d !== wd) : [...prev, wd]
                          );
                        }}
                        className={`min-h-11 rounded-xl text-xs font-bold transition cursor-pointer ${
                          selected
                            ? 'bg-[#0AACA5] text-white shadow-xs'
                            : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {t(key)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time Range + Quick Presets */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t('calendar.rule.start_time')}
                    </label>
                    <input
                      type="time"
                      value={ruleStartTime}
                      onChange={(e) => setRuleStartTime(e.target.value)}
                      required
                      className="min-h-11 sm:min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t('calendar.rule.end_time')}
                    </label>
                    <input
                      type="time"
                      value={ruleEndTime}
                      onChange={(e) => setRuleEndTime(e.target.value)}
                      required
                      className="min-h-11 sm:min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TIME_SLOT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setRuleStartTime(preset.start);
                        setRuleEndTime(preset.end);
                      }}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date Range + Semester Half Presets (for mid-semester schedule changes) */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t('calendar.rule.start_date')}
                    </label>
                    <input
                      type="date"
                      value={ruleStartDate}
                      onChange={(e) => setRuleStartDate(e.target.value)}
                      required
                      className="min-h-11 sm:min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t('calendar.rule.end_date')}
                    </label>
                    <input
                      type="date"
                      value={ruleEndDate}
                      onChange={(e) => setRuleEndDate(e.target.value)}
                      required
                      className="min-h-11 sm:min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setRuleStartDate(semesterBounds.start);
                      setRuleEndDate(semesterBounds.end);
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
                  >
                    {t('calendar.period.full_semester')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRuleStartDate(semesterBounds.start);
                      setRuleEndDate(semesterBounds.midEnd);
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
                  >
                    {t('calendar.period.first_half')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRuleStartDate(semesterBounds.secondHalfStart);
                      setRuleEndDate(semesterBounds.end);
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
                  >
                    {t('calendar.period.second_half')}
                  </button>
                </div>
              </div>

              {/* Optional Title & Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('calendar.rule.custom_title')}
                  </label>
                  <input
                    type="text"
                    value={ruleTitle}
                    onChange={(e) => setRuleTitle(e.target.value)}
                    placeholder={t('calendar.rule.custom_title_placeholder')}
                    className="min-h-11 sm:min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('calendar.rule.location')}
                  </label>
                  <input
                    type="text"
                    value={ruleLocation}
                    onChange={(e) => setRuleLocation(e.target.value)}
                    placeholder={t('calendar.rule.location_placeholder')}
                    className="min-h-11 sm:min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Exception / Cancelled Dates */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('calendar.rule.exceptions_label')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={newExceptionDate}
                    onChange={(e) => setNewExceptionDate(e.target.value)}
                    className="min-h-11 sm:min-h-9 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newExceptionDate && !ruleExceptions.includes(newExceptionDate)) {
                        setRuleExceptions((prev) => [...prev, newExceptionDate].sort());
                        setNewExceptionDate('');
                      }
                    }}
                    className="min-h-11 sm:min-h-9 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    {t('calendar.rule.add_exception')}
                  </button>
                </div>
                {ruleExceptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {ruleExceptions.map((exDate) => (
                      <span
                        key={exDate}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                      >
                        {exDate}
                        <button
                          type="button"
                          onClick={() =>
                            setRuleExceptions((prev) => prev.filter((d) => d !== exDate))
                          }
                          aria-label={t('Entfernen')}
                          className="hover:text-rose-900 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRuleModalOpen(false)}
                  className="min-h-11 sm:min-h-9 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  {t('Abbrechen')}
                </button>
                <button
                  type="submit"
                  disabled={isSavingRule}
                  style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                  className="min-h-11 sm:min-h-9 rounded-xl px-5 py-2 text-xs font-bold text-white shadow-xs hover:opacity-90 transition cursor-pointer disabled:opacity-50"
                >
                  {isSavingRule ? t('Speichert...') : t('Speichern')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EXPORT, SUBSCRIPTION & ICS IMPORT MODAL */}
      {isExportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsExportModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('calendar.export_modal.title')}
            className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                {t('calendar.export_modal.title')}
              </h2>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                aria-label={t('Schliessen')}
                className="min-h-10 min-w-10 inline-flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 1. Download combined .ics file */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40 space-y-2.5">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-[#0AACA5]" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {t('calendar.export_modal.download_title')}
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {t('calendar.export_modal.download_desc')}
              </p>
              <a
                href={api.getCalendarExportUrl('ALL')}
                download="betterilias-calendar.ics"
                style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                className="min-h-11 sm:min-h-9 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-xs hover:opacity-90 transition"
              >
                <Download className="h-4 w-4" />
                <span>{t('calendar.export_modal.download_button')}</span>
              </a>
            </div>

            {/* 2. Private revocable subscription URL */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-[#0AACA5]" />
                  <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {t('calendar.export_modal.sub_title')}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleRotateSubscription}
                    className="min-h-9 sm:min-h-8 rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
                  >
                    {activeSubscriptionUrl
                      ? t('calendar.export_modal.sub_rotate')
                      : t('calendar.export_modal.sub_generate')}
                  </button>
                  {activeSubscriptionUrl && (
                    <button
                      type="button"
                      onClick={handleRevokeSubscription}
                      className="min-h-9 sm:min-h-8 rounded-lg bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-300 cursor-pointer"
                    >
                      {t('calendar.export_modal.sub_revoke')}
                    </button>
                  )}
                </div>
              </div>

              {activeSubscriptionUrl && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={activeSubscriptionUrl}
                    className="min-h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(activeSubscriptionUrl);
                      setCopiedUrl(true);
                      setTimeout(() => setCopiedUrl(false), 2000);
                    }}
                    className="min-h-10 rounded-xl bg-[#0AACA5] px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 cursor-pointer"
                  >
                    {copiedUrl ? t('Kopiert!') : t('Kopieren')}
                  </button>
                </div>
              )}

              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <strong>{t('calendar.export_modal.local_limit_title')}:</strong>{' '}
                {t('calendar.export_modal.local_limit_body')}
              </div>
            </div>

            {/* 3. Manual .ics File Import for a Course */}
            <form
              onSubmit={handleImportIcsFile}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-[#0AACA5]" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {t('calendar.import_ics.title')}
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {t('calendar.import_ics.desc')}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <select
                  value={icsImportCourseId}
                  onChange={(e) => setIcsImportCourseId(e.target.value)}
                  aria-label={t('calendar.rule.course_label')}
                  className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {mergedCourses.map((c) => (
                    <option key={c.course_ref_id} value={c.course_ref_id}>
                      {c.course_title}
                    </option>
                  ))}
                </select>

                <label className="min-h-10 inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer">
                  <FileText className="h-3.5 w-3.5" />
                  <span>{t('calendar.import_ics.choose_file')}</span>
                  <input
                    type="file"
                    accept=".ics,text/calendar"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const text = await file.text();
                        setIcsImportText(text);
                      }
                    }}
                  />
                </label>
              </div>

              {icsImportText && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    {t('calendar.import_ics.file_loaded', { length: icsImportText.length })}
                  </span>
                  <button
                    type="submit"
                    disabled={isImportingIcs}
                    style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                    className="min-h-9 rounded-xl px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 cursor-pointer"
                  >
                    {isImportingIcs ? t('Importiert...') : t('calendar.import_ics.submit')}
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* EVENT DETAILS MODAL */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedEvent(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedEvent.title}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span
                  className="mt-1 h-3.5 w-3.5 rounded-full shrink-0"
                  style={{ backgroundColor: selectedEvent.color || '#0AACA5' }}
                />
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    {selectedEvent.title}
                  </h3>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {selectedEvent.course_title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                aria-label={t('Schliessen')}
                className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-400 shrink-0" />
                <span>
                  {selectedEvent.date_str} •{' '}
                  {selectedEvent.all_day
                    ? t('calendar.all_day')
                    : `${selectedEvent.start_time_str}–${selectedEvent.end_time_str}`}
                </span>
              </div>
              {selectedEvent.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                  <span>{selectedEvent.location}</span>
                </div>
              )}
              {selectedEvent.description && (
                <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300 whitespace-pre-line">
                  {selectedEvent.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {selectedEvent.rule_id && (
                <button
                  type="button"
                  onClick={() => {
                    const rule = calendarData?.rules.find((r) => r.id === selectedEvent.rule_id);
                    setSelectedEvent(null);
                    if (rule) openRuleModal(rule.course_ref_id, rule);
                  }}
                  className="min-h-10 sm:min-h-9 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>{t('calendar.rule.edit')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const cid = selectedEvent.course_ref_id;
                  setSelectedEvent(null);
                  onSelectCourse(cid);
                }}
                style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                className="min-h-10 sm:min-h-9 inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 cursor-pointer"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>{t('calendar.open_course')}</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
