import { useConnectionRetry } from '../lib/connection';
import { ErrorNotice } from './ErrorNotice';
import { getLocale, t, useLanguage } from '../lib/i18n';
import React, { useEffect, useState, useRef } from 'react';
import {
  X,
  Play,
  Calendar,
  User,
  MapPin,
  ExternalLink,
  RefreshCw,
  Radio,
  CheckCircle2,
  Clock,
  Search,
  ArrowDown,
  ArrowLeftRight,
} from 'lucide-react';
import { PodcastEpisode, PodcastSeriesResponse } from '../types';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { PodcastPlayer } from './PodcastPlayer';
import { readRecordingSort, RecordingSort, writeRecordingSort } from '../lib/playerPreferences';
import { sortRecordings } from '../lib/recordingSort';
import { readVideoProgress } from '../lib/videoProgress';

interface PodcastModalProps {
  refId: string;
  title: string;
  onClose: () => void;
  onNewPodcastFound?: (newEpisodesCount: number, firstEpisodeTitle: string) => void;
}

export const PodcastModal: React.FC<PodcastModalProps> = ({
  refId,
  title,
  onClose,
  onNewPodcastFound,
}) => {
  useLanguage();
  const [activeEpisode, setActiveEpisode] = useState<PodcastEpisode | null>(null);
  const [playbackRefreshKey, setPlaybackRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<PodcastSeriesResponse | null>(null);
  const [filter, setFilter] = useState<'available' | 'scheduled' | 'all'>('available');
  const [search, setSearch] = useState('');
  const [sortScope] = useState(() => cache.getSessionId());
  const [sort, setSort] = useState(() => readRecordingSort(sortScope));
  const changeSort = (next: RecordingSort) => { setSort(next); writeRecordingSort(sortScope, next); };
  const backdropMouseDownRef = useRef(false);

  const fetchPodcasts = async () => {
    // 1. Check cache for 0ms instant display
    const cached = cache.getCachedPodcasts(refId);
    if (cached) {
      setSeries(cached);
      setLoading(false);
      setIsRevalidating(true);
      if (cached.recorded_count > 0) {
        setFilter('available');
      } else {
        setFilter('all');
      }
    } else {
      setLoading(true);
    }

    setError(null);

    // 2. Background revalidation
    try {
      const freshData = await api.getPodcasts(refId);
      
      // Change detection: compare cached vs fresh
      if (cached && onNewPodcastFound) {
        const cachedIds = new Set(cached.episodes.map((e: PodcastEpisode) => e.id));
        const newEpisodes = freshData.episodes.filter((e) => !cachedIds.has(e.id));
        if (newEpisodes.length > 0) {
          onNewPodcastFound(newEpisodes.length, newEpisodes[0].title);
        }
      }

      cache.setCachedPodcasts(refId, freshData);
      setSeries(freshData);
      if (!cached && freshData.recorded_count > 0) {
        setFilter('available');
      }
    } catch (err: any) {
      console.error('Failed to load podcasts:', err);
      if (!cached) {
        setError(err.message || t("Podcasts konnten nicht geladen werden."));
      }
    } finally {
      setLoading(false);
      setIsRevalidating(false);
    }
  };

  useEffect(() => {
    fetchPodcasts();
  }, [refId]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !activeEpisode && !document.querySelector('dialog[open]')) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, activeEpisode]);

  const episodes = series?.episodes || [];
  const filteredEpisodes = sortRecordings(episodes.filter((ep) => {
    if (filter === 'available' && ep.status !== 'available') return false;
    if (filter === 'scheduled' && ep.status !== 'scheduled') return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = ep.title.toLowerCase().includes(q);
      const matchPresenter = ep.presenter?.toLowerCase().includes(q);
      const matchLoc = ep.location?.toLowerCase().includes(q);
      const matchDate = ep.date?.toLowerCase().includes(q);
      return matchTitle || matchPresenter || matchLoc || matchDate;
    }
    return true;
  }), sort, getLocale());

  useConnectionRetry(() => { if (error) void fetchPodcasts(); });

  return (
    <>
    {activeEpisode?.stream_url && (
      <PodcastPlayer
        key={activeEpisode.id}
        url={activeEpisode.stream_url}
        title={activeEpisode.title}
        onClose={() => {
          setActiveEpisode(null);
          setPlaybackRefreshKey((prev) => prev + 1);
        }}
      />
    )}
    <div
      className="app-overlay fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current) {
          onClose();
        }
        backdropMouseDownRef.current = false;
      }}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90dvh] animate-in zoom-in-95 duration-150 transition-colors"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 dark:border-slate-800 p-5 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800/80">
          <div className="flex items-start gap-3.5 pr-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 shrink-0 shadow-2xs">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="hidden sm:inline-flex text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-2 py-0.5 rounded-md">
                  {t("Opencast Vorlesungsaufzeichnungen")}
                </span>
                {series && series.pages_available.length > 0 && (
                  <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md flex items-center gap-1">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {t("Seiten synchronisiert")}
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-1 line-clamp-1">
                {series?.title || title}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition shrink-0 cursor-pointer"
            title={t("Schliessen")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div role="region" aria-label={t('Opencast Vorlesungsaufzeichnungen')} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
        {/* Filter bar & Stats */}
        {series && (
          <div className="border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex max-w-full flex-wrap items-center gap-1.5 bg-slate-100/80 dark:bg-slate-800 p-1 rounded-xl self-start">
              <button
                onClick={() => setFilter('available')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filter === 'available'
                    ? 'bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{t("Aufnahmen (")}{series.recorded_count})</span>
              </button>

              <button
                onClick={() => setFilter('scheduled')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filter === 'scheduled'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Clock className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <span>{t("Geplant (")}{series.scheduled_count})</span>
              </button>

              <button
                onClick={() => setFilter('all')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filter === 'all'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>{t("Alle (")}{series.total_episodes})</span>
              </button>
            </div>

            {/* Quick search input */}
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder={t("Episode suchen...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)] transition"
              />
            </div>
          </div>
        )}

        {series && <div role="group" aria-label={t('recordings.sort_by')} className="flex items-center justify-end gap-1.5 border-b border-slate-100 bg-white px-4 py-1 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" aria-label={t('recordings.sort_by')} aria-pressed={sort.field === 'title'} aria-describedby="recording-date-hint"
            onClick={() => changeSort({ ...sort, field: sort.field === 'title' ? 'date' : 'title' })}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-[var(--accent)] dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            <ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5" />
            {t(sort.field === 'title' ? 'recordings.title' : 'recordings.upload_date')}
          </button>
          <button type="button" aria-label={t('recordings.direction')} aria-pressed={sort.direction === 'asc'} title={t(sort.direction === 'asc' ? 'recordings.ascending' : 'recordings.descending')}
            onClick={() => changeSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
            className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-[var(--accent)] dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
            <ArrowDown aria-hidden="true" className={`h-4 w-4 transition-transform motion-reduce:transition-none ${sort.direction === 'asc' ? 'rotate-180' : ''}`} />
            <span className="sr-only">{t(sort.direction === 'asc' ? 'recordings.ascending' : 'recordings.descending')}</span>
          </button>
          <span id="recording-date-hint" className="sr-only">{t('recordings.date_hint')}</span>
        </div>}

        {/* Modal Body */}
        <div className="p-3 sm:p-5 space-y-2 bg-slate-50/50 dark:bg-slate-900/50">
          {loading && (
            <div className="flex h-56 flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
              <RefreshCw className="h-6 w-6 animate-spin text-sky-500" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {t("Lade Aufnahmen und synchronisiere Seiten...")}
              </p>
            </div>
          )}

          {error && <ErrorNotice message={error} onRetry={fetchPodcasts} connectionInline />}

          {!loading && !error && filteredEpisodes.length === 0 && (
            <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center">
              <Radio className="h-6 w-6 text-slate-300 dark:text-slate-600 mb-1" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{t("Keine Episoden in dieser Auswahl")}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {filter === 'available'
                  ? t("Noch keine fertigen Aufnahmen vorhanden.")
                  : t("Keine passenden Termine gefunden.")}
              </p>
            </div>
          )}

          {!loading &&
            !error &&
            filteredEpisodes.map((ep) => {
              const isRecorded = ep.status === 'available';
              const progress = ep.stream_url ? readVideoProgress(ep.stream_url, sortScope) : null;
              const hasProgress = Boolean(progress && (progress.completed || (progress.duration && progress.duration > 0 && progress.position > 0)));
              const progressPercent = progress?.completed
                ? 100
                : (progress && progress.duration && progress.duration > 0)
                  ? Math.min(100, Math.max(0, Math.round((progress.position / progress.duration) * 100)))
                  : 0;

              return (
                <div
                  key={ep.id}
                  data-recording-id={ep.id}
                  className={`rounded-xl border p-3 transition bg-white dark:bg-slate-900 shadow-2xs hover:shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isRecorded
                      ? 'border-slate-200 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-700'
                      : 'border-slate-200/80 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-900/40 opacity-80 hover:opacity-100'
                  }`}
                >
                  {/* Left: Thumbnail preview with play button & progress bar */}
                  <div className="relative w-full sm:w-44 md:w-48 aspect-video shrink-0 rounded-lg overflow-hidden bg-slate-800 border border-slate-200 dark:border-slate-700 group">
                    {ep.preview_image ? (
                      <img
                        src={ep.preview_image}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-500">
                        <Radio className="h-8 w-8 opacity-40" />
                      </div>
                    )}

                    {isRecorded && ep.stream_url ? (
                      <button
                        type="button"
                        onClick={() => setActiveEpisode(ep)}
                        aria-label={t('recordings.play')}
                        title={t('recordings.play')}
                        className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/45 focus-visible:bg-black/50 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                      >
                        <span
                          style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                          className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transform group-hover:scale-110 group-active:scale-95 transition"
                        >
                          <Play className="h-5 w-5 fill-white translate-x-0.5" />
                        </span>
                      </button>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <span className="rounded-md bg-black/60 px-2 py-1 text-[10px] font-semibold text-white/90">
                          {t("Wird aufgezeichnet")}
                        </span>
                      </div>
                    )}

                    {/* Progress bar overlay at bottom of preview */}
                    {isRecorded && hasProgress && (
                      <div
                        role="progressbar"
                        aria-valuenow={progressPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={progress?.completed ? t('recordings.watched') : t('recordings.progress', { percent: progressPercent })}
                        className="absolute bottom-0 inset-x-0 h-1.5 bg-black/60 overflow-hidden"
                      >
                        <div
                          className="h-full transition-all duration-200"
                          style={{
                            width: `${progressPercent}%`,
                            backgroundColor: progress?.completed ? '#34d399' : 'var(--accent, #0AACA5)',
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Middle: Details & Metadata */}
                  <div className="min-w-0 space-y-1.5 flex-1">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                      {ep.title}
                    </h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      {isRecorded ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                          {t("Aufnahme bereit")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                          <Clock className="h-3 w-3 text-slate-400" />
                          {t("Zukünftiger Termin")}
                        </span>
                      )}

                      {ep.date && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          {ep.date}
                        </span>
                      )}
                      {ep.uploaded_date && <span className="text-[11px] text-slate-500 dark:text-slate-400">{t('recordings.uploaded', { date: ep.uploaded_date })}</span>}
                      {isRecorded && hasProgress && (
                        <span
                          style={{ color: progress?.completed ? undefined : 'var(--accent, #0AACA5)' }}
                          className={`text-[11px] font-medium flex items-center gap-1 ${progress?.completed ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
                        >
                          {progress?.completed ? t('recordings.watched') : t('recordings.progress', { percent: progressPercent })}
                        </span>
                      )}
                    </div>

                    {(ep.presenter || ep.location) && (
                      <div className="flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                        {ep.presenter && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3 text-slate-400" />
                            {ep.presenter}
                          </span>
                        )}
                        {ep.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-slate-400" />
                            {ep.location}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        </div>
        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-end border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 dark:bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {t("Schliessen")}
          </button>
        </div>
      </div>
    </div>
    </>
  );
};

