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
        className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-100 p-5 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-start gap-3.5 pr-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-600 shrink-0 shadow-2xs">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md">
                  Opencast Vorlesungsaufzeichnungen
                </span>
                {series && series.pages_available.length > 0 && (
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md flex items-center gap-1">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Seiten synchronisiert
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-slate-900 mt-1 line-clamp-1">
                {series?.title || title}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition shrink-0"
            title="Schliessen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filter bar & Stats */}
        {series && (
          <div className="border-b border-slate-100 bg-white px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl self-start">
              <button
                onClick={() => setFilter('available')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  filter === 'available'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Aufnahmen ({series.recorded_count})</span>
              </button>

              <button
                onClick={() => setFilter('scheduled')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  filter === 'scheduled'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="h-3.5 w-3.5 text-slate-500" />
                <span>Geplant ({series.scheduled_count})</span>
              </button>

              <button
                onClick={() => setFilter('all')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  filter === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>Alle ({series.total_episodes})</span>
              </button>
            </div>

            {/* Quick search input */}
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Episode suchen..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-sky-500 focus:outline-hidden transition"
              />
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/50">
          {loading && (
            <div className="flex h-56 flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="h-6 w-6 animate-spin text-sky-500" />
              <p className="text-xs font-semibold text-slate-500">
                Lade Aufnahmen und synchronisiere Seiten...
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Fehler beim Laden der Podcasts</p>
                <p>{error}</p>
                <button
                  onClick={fetchPodcasts}
                  className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
                >
                  <RefreshCw className="h-3 w-3" /> Erneut versuchen
                </button>
              </div>
            </div>
          )}

          {!loading && !error && filteredEpisodes.length === 0 && (
            <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center">
              <Radio className="h-6 w-6 text-slate-300 mb-1" />
              <p className="text-xs font-bold text-slate-700">Keine Episoden in dieser Auswahl</p>
              <p className="text-[11px] text-slate-400">
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

              return (
                <div
                  key={ep.id}
                  className={`rounded-xl border p-4 transition bg-white shadow-2xs hover:shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isRecorded
                      ? 'border-slate-200 hover:border-sky-300'
                      : 'border-slate-200/80 bg-slate-50/40 opacity-80 hover:opacity-100'
                  }`}
                >
                  <div className="space-y-1.5 flex-1 pr-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isRecorded ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          Aufnahme bereit
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          <Clock className="h-3 w-3 text-slate-400" />
                          Zukünftiger Termin
                        </span>
                      )}

                      {ep.date && (
                        <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          {ep.date}
                        </span>
                      )}
                    </div>

                    <h4 className="text-xs font-bold text-slate-900 leading-snug">
                      {ep.title}
                    </h4>

                    {(ep.presenter || ep.location) && (
                      <div className="flex items-center gap-4 text-[11px] text-slate-500 flex-wrap">
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
                        <span>Streamen</span>
                      </a>
                    ) : (
                      <span className="text-[11px] font-medium text-slate-400 px-2">
                        Wird aufgezeichnet
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-white px-5 py-3">
          <a
            href={`https://ilias.unibe.ch/ilias.php?baseClass=ilobjplugindispatchgui&cmdClass=xoctEventGUI&ref_id=${refId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
          >
            <span>In ILIAS öffnen</span>
            <ExternalLink className="h-3 w-3" />
          </a>

          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
          >
            Schliessen
          </button>
        </div>
      </div>
    </div>
  );
};

