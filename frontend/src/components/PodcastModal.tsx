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
  Bookmark,
  Check,
  Trash2,
} from 'lucide-react';
import { PodcastEpisode, PodcastSeriesResponse } from '../types';
import { api } from '../lib/api';
import { cache } from '../lib/cache';

const PODCAST_TIMESTAMPS_STORAGE_KEY = 'betterilias_podcast_timestamps';

export function formatPlaybackTimestamp(totalSeconds?: number | null): string | null {
  if (totalSeconds === undefined || totalSeconds === null || isNaN(totalSeconds) || totalSeconds <= 0) {
    return null;
  }
  const sec = Math.floor(totalSeconds);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

export function parsePlaybackTimestampInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const val = parseInt(trimmed, 10);
    return val > 0 ? val * 60 : null; // Plain number = minutes
  }
  const parts = trimmed.split(':').map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  if (parts.length === 2) {
    const [m, s] = parts.map((p) => parseInt(p, 10));
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts.map((p) => parseInt(p, 10));
    return h * 3600 + m * 60 + s;
  }
  return null;
}

function loadSavedPodcastTimestamps(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PODCAST_TIMESTAMPS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

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
  const [loading, setLoading] = useState(true);
  const [, setIsRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<PodcastSeriesResponse | null>(null);
  const [filter, setFilter] = useState<'available' | 'scheduled' | 'all'>('available');
  const [search, setSearch] = useState('');
  const [savedTimestamps, setSavedTimestamps] = useState<Record<string, number>>(() =>
    loadSavedPodcastTimestamps()
  );
  const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null);
  const [timestampInput, setTimestampInput] = useState<string>('');
  const backdropMouseDownRef = useRef(false);

  const saveEpisodeTimestamp = (episodeId: string, seconds: number | null) => {
    setSavedTimestamps((prev) => {
      const next = { ...prev };
      if (seconds && seconds > 0) {
        next[episodeId] = Math.round(seconds);
      } else {
        delete next[episodeId];
      }
      try {
        localStorage.setItem(PODCAST_TIMESTAMPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  };

  useEffect(() => {
    const handleSyncEvent = (e: Event) => {
      const custom = e as CustomEvent<{ timestamps?: Record<string, number> }>;
      if (custom.detail?.timestamps) {
        setSavedTimestamps((prev) => ({ ...prev, ...custom.detail.timestamps }));
      } else {
        setSavedTimestamps(loadSavedPodcastTimestamps());
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === PODCAST_TIMESTAMPS_STORAGE_KEY) {
        setSavedTimestamps(loadSavedPodcastTimestamps());
      }
    };
    document.addEventListener('BETTERILIAS_PODCAST_TIMESTAMPS_SYNCED', handleSyncEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      document.removeEventListener('BETTERILIAS_PODCAST_TIMESTAMPS_SYNCED', handleSyncEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

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

      // Merge any Paella `lastKnownTime` timestamps returned from ILIAS cookies
      const cookieTimestamps: Record<string, number> = {};
      for (const ep of freshData.episodes) {
        if (ep.last_watched_seconds && ep.last_watched_seconds > 0) {
          cookieTimestamps[ep.id] = Math.round(ep.last_watched_seconds);
        }
      }
      if (Object.keys(cookieTimestamps).length > 0) {
        setSavedTimestamps((prev) => {
          const merged = { ...prev, ...cookieTimestamps };
          try {
            localStorage.setItem(PODCAST_TIMESTAMPS_STORAGE_KEY, JSON.stringify(merged));
          } catch {
            // Ignore storage errors
          }
          return merged;
        });
      }

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
        setError(err.message || 'Podcasts konnten nicht geladen werden.');
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
      if (e.key === 'Escape') {
        if (editingEpisodeId) {
          setEditingEpisodeId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, editingEpisodeId]);

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
                  Opencast Vorlesungsaufzeichnungen
                </span>
                {series && series.pages_available.length > 0 && (
                  <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md flex items-center gap-1">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Seiten synchronisiert
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
            title="Schliessen"
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
                <span>Aufnahmen ({series.recorded_count})</span>
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
                <span>Geplant ({series.scheduled_count})</span>
              </button>

              <button
                onClick={() => setFilter('all')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filter === 'all'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>Alle ({series.total_episodes})</span>
              </button>
            </div>

            {/* Quick search input */}
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Episode suchen..."
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
                Lade Aufnahmen und synchronisiere Seiten...
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-950/60 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-700 dark:text-red-300 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Fehler beim Laden der Podcasts</p>
                <p>{error}</p>
                <button
                  onClick={fetchPodcasts}
                  style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                  className="mt-2 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" /> Erneut versuchen
                </button>
              </div>
            </div>
          )}

          {!loading && !error && filteredEpisodes.length === 0 && (
            <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center">
              <Radio className="h-6 w-6 text-slate-300 dark:text-slate-600 mb-1" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Keine Episoden in dieser Auswahl</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {filter === 'available'
                  ? 'Noch keine fertigen Aufnahmen vorhanden.'
                  : 'Keine passenden Termine gefunden.'}
              </p>
            </div>
          )}

          {!loading &&
            !error &&
            filteredEpisodes.map((ep) => {
              const isRecorded = ep.status === 'available';
              const watchedSec = savedTimestamps[ep.id] ?? ep.last_watched_seconds;
              const formattedTimestamp = formatPlaybackTimestamp(watchedSec);
              const isEditingThis = editingEpisodeId === ep.id;

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
                          Aufnahme bereit
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                          <Clock className="h-3 w-3 text-slate-400" />
                          Zukünftiger Termin
                        </span>
                      )}

                      {ep.date && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          {ep.date}
                        </span>
                      )}

                      {isRecorded && formattedTimestamp && !isEditingThis && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingEpisodeId(ep.id);
                            setTimestampInput(formattedTimestamp);
                          }}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition cursor-pointer"
                          title="Gespeicherter Wiedergabe-Zeitstempel (klicken zum Bearbeiten)"
                        >
                          <Bookmark className="h-2.5 w-2.5 fill-amber-500 text-amber-600 dark:text-amber-400" />
                          <span>Bei {formattedTimestamp} gestoppt</span>
                        </button>
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

                    {/* Inline timestamp editor */}
                    {isRecorded && isEditingThis && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!timestampInput.trim()) {
                            saveEpisodeTimestamp(ep.id, null);
                            setEditingEpisodeId(null);
                            return;
                          }
                          const parsedSec = parsePlaybackTimestampInput(timestampInput);
                          if (parsedSec !== null) {
                            saveEpisodeTimestamp(ep.id, parsedSec);
                            setEditingEpisodeId(null);
                          }
                        }}
                        className="flex items-center gap-1.5 pt-1 flex-wrap"
                      >
                        <input
                          type="text"
                          value={timestampInput}
                          onChange={(e) => setTimestampInput(e.target.value)}
                          placeholder="z.B. 42:15 oder 1:15:00"
                          autoFocus
                          className="w-36 rounded-lg border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                        />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 rounded-lg bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-bold text-white transition cursor-pointer"
                          title="Zeitstempel speichern"
                        >
                          <Check className="h-3 w-3" />
                          <span>Speichern</span>
                        </button>
                        {formattedTimestamp && (
                          <button
                            type="button"
                            onClick={() => {
                              saveEpisodeTimestamp(ep.id, null);
                              setEditingEpisodeId(null);
                            }}
                            className="inline-flex items-center justify-center rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 p-1 text-rose-600 dark:text-rose-400 hover:bg-rose-100 transition cursor-pointer"
                            title="Zeitstempel löschen"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingEpisodeId(null)}
                          className="text-[11px] font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 cursor-pointer"
                        >
                          Abbrechen
                        </button>
                      </form>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {isRecorded && ep.stream_url ? (
                      <>
                        {!isEditingThis && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEpisodeId(ep.id);
                              setTimestampInput(formattedTimestamp || '');
                            }}
                            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition cursor-pointer ${
                              formattedTimestamp
                                ? 'border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                            title={
                              formattedTimestamp
                                ? `Gespeicherten Zeitstempel (${formattedTimestamp}) bearbeiten`
                                : 'Zeitstempel merken, wo du aufgehört hast'
                            }
                          >
                            <Bookmark className="h-3.5 w-3.5" />
                            <span className="hidden md:inline">
                              {formattedTimestamp ? formattedTimestamp : 'Zeit merken'}
                            </span>
                          </button>
                        )}
                        <a
                          href={ep.stream_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 transition shadow-2xs"
                          title={
                            formattedTimestamp
                              ? `In ILIAS fortsetzen (zuletzt bei ${formattedTimestamp})`
                              : 'Aufnahme im ILIAS Opencast Player starten'
                          }
                        >
                          <Play className="h-3.5 w-3.5 fill-white" />
                          <span>{formattedTimestamp ? `Weiter (${formattedTimestamp})` : 'Streamen'}</span>
                        </a>
                      </>
                    ) : (
                      <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 px-2">
                        Wird aufgezeichnet
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
            <span>In ILIAS öffnen</span>
            <ExternalLink className="h-3 w-3" />
          </a>

          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 dark:bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            Schliessen
          </button>
        </div>
      </div>
    </div>
  );
};
