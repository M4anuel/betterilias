import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  FileText,
  Download,
  FolderOpen,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { CourseSessionItem, MaterialItem } from '../types';
import { api } from '../lib/api';

interface SessionDrawerProps {
  sessions: CourseSessionItem[];
  courseRefId?: string;
}

export const SessionDrawer: React.FC<SessionDrawerProps> = ({ sessions, courseRefId }) => {
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const [filterMode, setFilterMode] = useState<'all' | 'with_materials' | 'upcoming'>('all');
  const [loadedMaterials, setLoadedMaterials] = useState<Record<string, MaterialItem[]>>({});
  const [loadingSessions, setLoadingSessions] = useState<Record<string, boolean>>({});

  const prefetchingRef = useRef<Set<string>>(new Set());

  // Background idle-preload for sessions with materials_count > 0
  useEffect(() => {
    if (!courseRefId || !sessions) return;

    let isCancelled = false;

    const preloadUnloadedSessions = async () => {
      for (const s of sessions) {
        if (isCancelled) break;
        const currentMats = loadedMaterials[s.ref_id] || s.materials;
        const count = s.materials_count ?? 0;
        if (currentMats.length === 0 && count > 0 && !prefetchingRef.current.has(s.ref_id)) {
          prefetchingRef.current.add(s.ref_id);
          try {
            const items = await api.getSessionMaterials(courseRefId, s.ref_id, s.expand_id);
            if (!isCancelled && items.length > 0) {
              setLoadedMaterials((prev) => ({ ...prev, [s.ref_id]: items }));
            }
          } catch {
            // Non-critical background fetch failure
          }
        }
      }
    };

    preloadUnloadedSessions();

    return () => {
      isCancelled = true;
    };
  }, [courseRefId, sessions]);

  if (!sessions || sessions.length === 0) return null;

  const getMaterialsForSession = (s: CourseSessionItem): MaterialItem[] => {
    return loadedMaterials[s.ref_id] || s.materials || [];
  };

  const hasMaterials = (s: CourseSessionItem): boolean => {
    const mats = getMaterialsForSession(s);
    return mats.length > 0 || (s.materials_count ?? 0) > 0;
  };

  const getMaterialsCount = (s: CourseSessionItem): number => {
    const mats = getMaterialsForSession(s);
    if (mats.length > 0) return mats.length;
    return s.materials_count ?? 0;
  };

  const toggleSession = async (session: CourseSessionItem) => {
    const willExpand = !expandedSessions[session.ref_id];
    setExpandedSessions((prev) => ({
      ...prev,
      [session.ref_id]: willExpand,
    }));

    if (willExpand) {
      const currentMats = getMaterialsForSession(session);
      const expectedCount = session.materials_count ?? 0;
      if (currentMats.length === 0 && expectedCount > 0 && courseRefId) {
        if (loadingSessions[session.ref_id]) return;
        setLoadingSessions((prev) => ({ ...prev, [session.ref_id]: true }));
        try {
          const items = await api.getSessionMaterials(courseRefId, session.ref_id, session.expand_id);
          setLoadedMaterials((prev) => ({ ...prev, [session.ref_id]: items }));
        } catch (e) {
          console.error('Failed to load session materials', e);
        } finally {
          setLoadingSessions((prev) => ({ ...prev, [session.ref_id]: false }));
        }
      }
    }
  };

  const toggleAll = async () => {
    const hasAnyExpanded = sessions.some((s) => expandedSessions[s.ref_id]);
    const next: Record<string, boolean> = {};
    for (const s of sessions) {
      next[s.ref_id] = !hasAnyExpanded;
    }
    setExpandedSessions(next);

    // If expanding all, load any unloaded materials
    if (!hasAnyExpanded && courseRefId) {
      for (const s of sessions) {
        const currentMats = getMaterialsForSession(s);
        if (currentMats.length === 0 && (s.materials_count ?? 0) > 0) {
          if (!loadingSessions[s.ref_id]) {
            setLoadingSessions((prev) => ({ ...prev, [s.ref_id]: true }));
            api
              .getSessionMaterials(courseRefId, s.ref_id, s.expand_id)
              .then((items) => {
                setLoadedMaterials((prev) => ({ ...prev, [s.ref_id]: items }));
              })
              .catch(() => {})
              .finally(() => {
                setLoadingSessions((prev) => ({ ...prev, [s.ref_id]: false }));
              });
          }
        }
      }
    }
  };

  const filteredSessions = sessions.filter((s) => {
    if (filterMode === 'with_materials') return hasMaterials(s);
    if (filterMode === 'upcoming') return !s.is_past;
    return true;
  });

  const totalMaterials = sessions.reduce((acc, s) => acc + getMaterialsCount(s), 0);


  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100/80 text-emerald-700 shrink-0">
            <Calendar className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Sitzungen & Termine
            </h3>
            <p className="text-[11px] text-slate-400">
              {sessions.length} Sitzungen • {totalMaterials} hinterlegte Dateien
            </p>
          </div>
        </div>

        {/* Filters & Actions */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <div className="flex items-center gap-1 bg-slate-200/60 p-0.5 rounded-lg text-[11px]">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2 py-0.5 rounded-md font-medium transition cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-white text-slate-800 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Alle ({sessions.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('with_materials')}
              className={`px-2 py-0.5 rounded-md font-medium transition cursor-pointer ${
                filterMode === 'with_materials'
                  ? 'bg-white text-emerald-700 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Mit Dateien ({sessions.filter(hasMaterials).length})
            </button>
          </div>

          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition px-2 py-1 cursor-pointer"
          >
            {sessions.some((s) => expandedSessions[s.ref_id])
              ? 'Alle einklappen'
              : 'Alle ausklappen'}
          </button>
        </div>
      </div>

      {/* Sessions list */}
      <div className="divide-y divide-slate-100">
        {filteredSessions.map((session) => {
          const isExpanded = !!expandedSessions[session.ref_id];
          const sessionHasMats = hasMaterials(session);
          const matsCount = getMaterialsCount(session);
          const mats = getMaterialsForSession(session);
          const isLoading = !!loadingSessions[session.ref_id];

          return (
            <div
              key={session.ref_id}
              className={`transition ${
                session.is_past ? 'bg-slate-50/40 opacity-90' : 'bg-white'
              }`}
            >
              {/* Compact Drawer Trigger Row */}
              <div
                onClick={() => sessionHasMats && toggleSession(session)}
                className={`flex items-center justify-between p-3.5 hover:bg-slate-50 transition gap-3 select-none ${
                  sessionHasMats ? 'cursor-pointer group' : ''
                }`}
              >
                <div className="flex items-center gap-3 truncate min-w-0">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 text-xs font-bold ${
                      sessionHasMats
                        ? 'bg-emerald-50 text-emerald-600 group-hover:scale-105 transition'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </div>

                  <div className="truncate space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {session.date_str && (
                        <span className="font-mono text-[11px] font-bold text-slate-700">
                          {session.date_str}
                        </span>
                      )}
                      {session.time_str && (
                        <span className="font-mono text-[10px] text-slate-400">
                          {session.time_str}
                        </span>
                      )}
                      {session.is_past && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] font-medium text-slate-500">
                          Vergangen
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-slate-800 truncate">
                      {session.title}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isLoading ? (
                    <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      <RefreshCw className="h-3 w-3 animate-spin text-emerald-600" />
                      <span>Lade...</span>
                    </div>
                  ) : sessionHasMats ? (
                    <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 group-hover:bg-emerald-100 transition">
                      <FolderOpen className="h-3 w-3" />
                      <span>
                        {matsCount} {matsCount === 1 ? 'Datei' : 'Dateien'}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5 ml-0.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-300 font-medium px-2">
                      Keine Anhänge
                    </span>
                  )}
                </div>
              </div>

              {/* Drawer Body: Attached Files / Slides */}
              {isExpanded && sessionHasMats && (
                <div className="bg-slate-50/70 p-3.5 pl-12 border-t border-slate-100 space-y-2 animate-in fade-in duration-150">
                  {isLoading ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                      <span>Lade Sitzungsunterlagen...</span>
                    </div>
                  ) : mats.length > 0 ? (
                    <div className="space-y-1.5">
                      {mats.map((mat) => {
                        const downloadUrl = api.getDownloadUrl(mat.ref_id, mat.download_url);

                        return (
                          <div
                            key={mat.ref_id}
                            className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-2xs hover:border-emerald-300 transition gap-3"
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <FileText className="h-4 w-4 text-red-500 shrink-0" />
                              <a
                                href={downloadUrl}
                                download
                                className="text-xs font-bold text-slate-800 hover:text-emerald-700 transition truncate"
                                title={mat.title}
                              >
                                {mat.title}
                              </a>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {mat.file_size && (
                                <span className="font-mono text-[10px] text-slate-400">
                                  {mat.file_size}
                                </span>
                              )}
                              <a
                                href={downloadUrl}
                                download
                                className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-600 hover:text-white transition shadow-2xs"
                              >
                                <Download className="h-3 w-3" />
                                <span>Download</span>
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic py-1">
                      Keine Dateien in dieser Sitzung gefunden
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

