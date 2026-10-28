import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, RefreshCw, Search, SlidersHorizontal, Star, Users } from 'lucide-react';
import { CourseItem } from '../types';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { getLocale, t, useLanguage } from '../lib/i18n';
import { CourseIcon } from './CourseIcon';

type Preferences = { favourites: Record<string, boolean>; sort: 'name' | 'semester' };

export const MyCoursesView: React.FC<{
  onOpenCourse: (id: string) => void;
  onOpenGroup: (id: string) => void;
}> = ({ onOpenCourse, onOpenGroup }) => {
  useLanguage();
  const storageKey = `betterilias_my_courses_${cache.getSessionId() || 'local'}`;
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return { favourites: Object.fromEntries(Object.entries(saved.favourites || {}).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')),
        sort: saved.sort === 'semester' ? 'semester' : 'name' };
    } catch { return { favourites: {}, sort: 'name' }; }
  });
  const [courses, setCourses] = useState<CourseItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [semester, setSemester] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pendingFocus = useRef<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    api.getMyCourses().then(data => { if (active) setCourses(data.courses); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const save = (next: Preferences) => {
    setPreferences(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  };
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const card = Array.from(container.current?.querySelectorAll<HTMLElement>('[data-course-id]') || [])
      .find(element => element.dataset.courseId === pendingFocus.current);
    card?.querySelector<HTMLButtonElement>('[data-favourite]')?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [preferences]);
  const name = (course: CourseItem) => cache.getDisplayName(course.ref_id, course.title);
  const favourite = (course: CourseItem) => preferences.favourites[course.ref_id] ?? Boolean(course.is_favourite);
  const semesterRank = (value?: string) => value ? Number(value.slice(2)) * 2 + Number(value.startsWith('HS')) : 0;
  const semesters = [...new Set((courses || []).map(course => course.semester).filter((value): value is string => Boolean(value)))];
  semesters.sort((a, b) => semesterRank(b) - semesterRank(a));
  const search = query.trim().toLocaleLowerCase(getLocale());
  const visible = (courses || []).filter(course =>
    (kind === 'all' || course.item_type === kind) &&
    (semester === 'all' || (semester === 'none' ? !course.semester : course.semester === semester)) &&
    `${course.title} ${name(course)} ${course.description || ''} ${course.semester || ''}`.toLocaleLowerCase(getLocale()).includes(search)
  ).sort((a, b) => (preferences.sort === 'semester' ? semesterRank(b.semester) - semesterRank(a.semester) : 0)
    || name(a).localeCompare(name(b), getLocale(), { numeric: true }) || a.ref_id.localeCompare(b.ref_id));
  const pinned = visible.filter(favourite);
  const others = visible.filter(course => !favourite(course));
  const control = 'my-courses-control min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:text-sm';
  const renderSection = (items: CourseItem[], title: string) => items.length > 0 && <section aria-label={title} className="space-y-3">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{title}<span className="rounded-full bg-slate-200 px-2 text-xs dark:bg-slate-800">{items.length}</span></h2>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map(course => <article key={course.ref_id} data-course-id={course.ref_id}
        className="flex min-w-0 items-start rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <button type="button" onClick={() => course.item_type === 'grp' ? onOpenGroup(course.ref_id) : onOpenCourse(course.ref_id)}
          className="flex min-h-28 min-w-0 flex-1 gap-3 rounded-xl p-4 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-500 dark:hover:bg-slate-800">
          <span className="mt-1 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true">{course.item_type === 'grp' ? <Users className="h-5 w-5" /> : <CourseIcon iconName={cache.getCourseIcon(course.ref_id, course)} className="h-5 w-5" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-base font-semibold leading-snug">{name(course)}</span>
            <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{course.item_type === 'grp' ? t('my_courses.group') : t('my_courses.course')}</span>
              {course.semester && <span className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">{course.semester}</span>}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="sr-only">{course.title}</span>
          </span>
        </button>
        <button type="button" data-favourite aria-pressed={favourite(course)}
          aria-label={t(favourite(course) ? 'my_courses.unpin' : 'my_courses.pin', { title: name(course) })}
          title={t(favourite(course) ? 'my_courses.unpin' : 'my_courses.pin', { title: name(course) })}
          onClick={() => { pendingFocus.current = course.ref_id; save({ ...preferences, favourites: { ...preferences.favourites, [course.ref_id]: !favourite(course) } }); }}
          className="m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-teal-700 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-teal-300 dark:hover:bg-slate-800">
          <Star className="h-5 w-5" fill={favourite(course) ? 'currentColor' : 'none'} />
        </button>
      </article>)}
    </div>
  </section>;
  return <div ref={container} className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="text-2xl font-bold sm:text-3xl">{t('my_courses.title')}</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t('my_courses.hint')}</p></div>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading} aria-label={t('my_courses.refresh')}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
        <RefreshCw className={`h-4 w-4 ${loading ? 'motion-safe:animate-spin' : ''}`} /></button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="min-w-0 text-sm font-medium">{t('my_courses.search')}
        <span className="relative mt-1 block"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} className={`${control} pl-10`} /></span></label>
      <button type="button" className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-teal-700 focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-teal-300 sm:hidden"
        aria-expanded={filtersOpen} aria-controls="my-courses-filters" onClick={() => setFiltersOpen(value => !value)}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /><span>{t('my_courses.filters')}</span>
      </button>
      <div id="my-courses-filters" className={`${filtersOpen ? 'grid gap-3' : 'hidden'} sm:contents`}>
      <label className="min-w-0 text-sm font-medium">{t('my_courses.type')}
        <select value={kind} onChange={event => setKind(event.target.value)} className={`${control} mt-1`}>
          <option value="all">{t('my_courses.all_types')}</option><option value="crs">{t('my_courses.courses')}</option><option value="grp">{t('my_courses.groups')}</option>
        </select></label>
      <label className="min-w-0 text-sm font-medium">{t('my_courses.semester')}
        <select value={semester} onChange={event => setSemester(event.target.value)} className={`${control} mt-1`}>
          <option value="all">{t('my_courses.all_semesters')}</option>{semesters.map(value => <option key={value}>{value}</option>)}<option value="none">{t('my_courses.no_semester')}</option>
        </select></label>
      <label className="min-w-0 text-sm font-medium">{t('my_courses.sort')}
        <select value={preferences.sort} onChange={event => save({ ...preferences, sort: event.target.value as Preferences['sort'] })} className={`${control} mt-1`}>
          <option value="name">{t('my_courses.name')}</option><option value="semester">{t('my_courses.newest')}</option>
        </select></label>
      </div>
    </div>
    {storageError && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{t('my_courses.storage_error')}</p>}
    {error && <div role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('my_courses.load_failed')}
      <button type="button" onClick={() => setRevision(value => value + 1)} className="ml-2 min-h-11 underline">{t('Erneut versuchen')}</button></div>}
    {loading && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{t('my_courses.loading')}</p>}
    {courses && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{t('my_courses.count', { count: visible.length, total: courses.length })}</p>}
    {renderSection(pinned, t('my_courses.favourites'))}
    {renderSection(others, t('my_courses.other'))}
    {!loading && !error && visible.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <BookOpen aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-teal-600 dark:text-teal-400" />
      <p>{t(courses?.length ? 'my_courses.no_results' : 'my_courses.empty')}</p>
      {Boolean(courses?.length) && <button type="button" className="mt-3 min-h-11 px-3 font-semibold text-teal-700 dark:text-teal-300"
        onClick={() => { setQuery(''); setKind('all'); setSemester('all'); }}>{t('my_courses.clear')}</button>}
    </div>}
  </div>;
};
