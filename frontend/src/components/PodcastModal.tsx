import { t, useLanguage } from '../lib/i18n';
import React, { useEffect, useState, useRef } from 'react';
import {
  X,
  Play,
  Calendar,
  User,
  MapPin,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Radio,
  CheckCircle2,
  Clock,
  Search,
} from 'lucide-react';
import { PodcastEpisode, PodcastSeriesResponse } from '../types';
import { api } from '../lib/api';
import { cache } from '../lib/cache';

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
  const [loading, setLoading] = useState(true);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<PodcastSeriesResponse | null>(null);
  const [filter, setFilter] = useState<'available' | 'scheduled' | 'all'>('available');
  const [search, setSearch] = useState('');
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
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const episodes = series?.episodes || [];
  const filteredEpisodes = episodes.filter((ep) => {
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
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
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
        className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150 transition-colors"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 p-5 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800/80">
          <div className="flex items-start gap-3.5 pr-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 shrink-0 shadow-2xs">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-2 py-0.5 rounded-md">
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

        {/* Filter bar & Stats */}
        {series && (
          <div className="border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 bg-slate-100/80 dark:bg-slate-800 p-1 rounded-xl self-start">
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
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
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

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/50 dark:bg-slate-900/50">
          {loading && (
            <div className="flex h-56 flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
              <RefreshCw className="h-6 w-6 animate-spin text-sky-500" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {t("Lade Aufnahmen und synchronisiere Seiten...")}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-950/60 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-700 dark:text-red-300 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">{t("Fehler beim Laden der Podcasts")}</p>
                <p>{error}</p>
                <button
                  onClick={fetchPodcasts}
                  style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                  className="mt-2 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" /> {t("Erneut versuchen")}
                </button>
              </div>
            </div>
          )}

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

              return (
                <div
                  key={ep.id}
                  className={`rounded-xl border p-4 transition bg-white dark:bg-slate-900 shadow-2xs hover:shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isRecorded
                      ? 'border-slate-200 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-700'
                      : 'border-slate-200/80 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-900/40 opacity-80 hover:opacity-100'
                  }`}
                >
                  <div className="space-y-1.5 flex-1 pr-2">
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
                    </div>

                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                      {ep.title}
                    </h4>

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

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {isRecorded && ep.stream_url ? (
                      <a
                        href={ep.stream_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 transition shadow-2xs"
                      >
                        <Play className="h-3.5 w-3.5 fill-white" />
                        <span>{t("Streamen")}</span>
                      </a>
                    ) : (
                      <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 px-2">
                        {t("Wird aufgezeichnet")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3">
          <a
            href={`https://ilias.unibe.ch/ilias.php?baseClass=ilobjplugindispatchgui&cmdClass=xoctEventGUI&ref_id=${refId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition"
          >
            <span>{t("In ILIAS öffnen")}</span>
            <ExternalLink className="h-3 w-3" />
          </a>

          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 dark:bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {t("Schliessen")}
          </button>
        </div>
      </div>
    </div>
  );
};

