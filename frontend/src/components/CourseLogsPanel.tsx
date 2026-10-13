import React, { useState, useEffect } from 'react';
import {
  FileText,
  MessageSquare,
  Activity,
  ExternalLink,
  Clock,
  Terminal,
  RefreshCw,
  DownloadCloud,
} from 'lucide-react';
import { CourseLogItem } from '../types';
import { api } from '../lib/api';
import { cache } from '../lib/cache';

interface CourseLogsPanelProps {
  courseId: string;
  initialLogs: CourseLogItem[];
}

export const CourseLogsPanel: React.FC<CourseLogsPanelProps> = ({
  courseId,
  initialLogs,
}) => {
  const [logs, setLogs] = useState<CourseLogItem[]>([]);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [hasFetchedAll, setHasFetchedAll] = useState(false);

  useEffect(() => {
    // Merge initial logs with any previously accumulated logs in cache
    const merged = cache.mergeAccumulatedLogs(courseId, initialLogs);
    setLogs(merged);
  }, [courseId, initialLogs]);

  if (!logs || logs.length === 0) {
    return null;
  }

  const handleFetchAllLogs = async () => {
    setIsLoadingAll(true);
    try {
      const res = await api.getCourseLogs(courseId, 1);
      if (res && res.logs) {
        const merged = cache.mergeAccumulatedLogs(courseId, res.logs);
        setLogs(merged);
        setHasFetchedAll(true);
      }
    } catch (e) {
      console.error('Failed to fetch full course logs', e);
    } finally {
      setIsLoadingAll(false);
    }
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'file':
        return <FileText className="h-3.5 w-3.5 text-amber-600" />;
      case 'forum':
        return <MessageSquare className="h-3.5 w-3.5 text-blue-600" />;
      default:
        return <Activity className="h-3.5 w-3.5 text-slate-600" />;
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden dark:border-slate-800 dark:bg-slate-900 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/70">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-slate-700 dark:text-slate-300" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">Logs</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
            {logs.length} Einträge
          </span>
        </div>
      </div>

      {/* Scrollable list with max-height for ~5 items visible */}
      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 p-1">
        {logs.map((log, idx) => (
          <div
            key={idx}
            className="p-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition rounded-xl flex items-start gap-2.5 group"
          >
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0 group-hover:scale-105 transition">
              {getLogIcon(log.log_type)}
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-snug line-clamp-1">
                  {log.title}
                </span>

                {log.url && (
                  <a
                    href={log.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition shrink-0"
                    title="In ILIAS öffnen"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {log.target && (
                <div className="truncate">
                  <span className="inline-block max-w-full truncate rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-300 font-medium">
                    {log.target}
                  </span>
                </div>
              )}

              {log.date && (
                <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                  <Clock className="h-2.5 w-2.5" />
                  <span>{log.date}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer action to fetch older logs */}
      {!hasFetchedAll && (
        <div className="border-t border-slate-100 bg-slate-50/60 p-2 text-center dark:border-slate-800 dark:bg-slate-800/60">
          <button
            type="button"
            onClick={handleFetchAllLogs}
            disabled={isLoadingAll}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition disabled:opacity-50 cursor-pointer"
          >
            {isLoadingAll ? (
              <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />
            ) : (
              <DownloadCloud className="h-3 w-3 text-slate-400" />
            )}
            <span>{isLoadingAll ? 'Lade ältere Logs...' : 'Ältere Logs abrufen'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
