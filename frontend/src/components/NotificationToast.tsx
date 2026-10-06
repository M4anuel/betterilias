import React, { useEffect, useState } from 'react';
import {
  X,
  ChevronUp,
  ChevronDown,
  Bell,
  FileText,
  Radio,
  Calendar,
  Activity,
  Sparkles,
} from 'lucide-react';

export interface ChangeNotification {
  id: string;
  type: 'file' | 'podcast' | 'session' | 'log' | 'general';
  title: string;
  subtitle?: string;
}

interface NotificationToastProps {
  notifications: ChangeNotification[];
  onDismiss: () => void;
  autoDismissMs?: number;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  notifications,
  onDismiss,
  autoDismissMs = 10000,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (notifications.length === 0) return;

    const intervalTime = 100;
    const decrement = (intervalTime / autoDismissMs) * 100;

    const timer = setInterval(() => {
      if (!isPaused) {
        setProgress((prev) => {
          if (prev <= 0) {
            clearInterval(timer);
            onDismiss();
            return 0;
          }
          return prev - decrement;
        });
      }
    }, intervalTime);

    return () => clearInterval(timer);
  }, [notifications, onDismiss, autoDismissMs, isPaused]);

  if (!notifications || notifications.length === 0) return null;

  const count = notifications.length;
  const isMultiple = count > 1;

  const getIcon = (type: string) => {
    switch (type) {
      case 'file':
        return <FileText className="h-4 w-4 text-red-400" />;
      case 'podcast':
        return <Radio className="h-4 w-4 text-sky-400" />;
      case 'session':
        return <Calendar className="h-4 w-4 text-emerald-400" />;
      case 'log':
        return <Activity className="h-4 w-4 text-amber-400" />;
      default:
        return <Sparkles className="h-4 w-4 text-blue-400" />;
    }
  };

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 rounded-2xl bg-slate-900/95 text-white shadow-2xl border border-slate-700/80 backdrop-blur-md overflow-hidden transition animate-in slide-in-from-bottom-5 duration-200"
      role="alert"
    >
      {/* Toast Content */}
      <div className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-100">
                {isMultiple
                  ? `${count} neue Aktualisierungen gefunden`
                  : 'Aktualisierung gefunden'}
              </h4>
              <p className="text-[11px] text-slate-400">Gerade mit ILIAS synchronisiert</p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isMultiple && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title={isExpanded ? 'Details einklappen' : 'Details aufklappen'}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Schliessen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Single notification view */}
        {!isMultiple && (
          <div className="flex items-start gap-2 rounded-xl bg-slate-800/70 p-2.5 border border-slate-700/50">
            <div className="mt-0.5 shrink-0">{getIcon(notifications[0].type)}</div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200 line-clamp-2">
                {notifications[0].title}
              </p>
              {notifications[0].subtitle && (
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                  {notifications[0].subtitle}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Multiple notifications view - Fold-out list */}
        {isMultiple && isExpanded && (
          <div className="max-h-56 overflow-y-auto space-y-1.5 pt-1 pr-1 border-t border-slate-800 animate-in fade-in duration-150">
            {notifications.map((n) => (
              <div
                key={n.id}
                className="flex items-start gap-2 rounded-lg bg-slate-800/60 p-2 border border-slate-700/40"
              >
                <div className="mt-0.5 shrink-0">{getIcon(n.type)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-200 line-clamp-1">
                    {n.title}
                  </p>
                  {n.subtitle && (
                    <p className="text-[10px] text-slate-400 truncate">
                      {n.subtitle}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-dismiss progress countdown line */}
      <div className="h-1 w-full bg-slate-800">
        <div
          className="h-full bg-blue-500 transition-all duration-100 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

