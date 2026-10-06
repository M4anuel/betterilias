import React from 'react';
import { Menu, LogIn, CheckCircle2, AlertCircle } from 'lucide-react';
import { AuthStatus } from '../types';

interface HeaderProps {
  authStatus: AuthStatus | null;
  onHomeClick: () => void;
  onToggleSidebar: () => void;
  isSidebarCollapsed: boolean;
  onTriggerLogin: () => void;
  isLoggingIn: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  authStatus,
  onHomeClick,
  onToggleSidebar,
  onTriggerLogin,
  isLoggingIn,
}) => {
  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
          title="Sidebar umschalten"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Uni Bern Logo + Home button */}
        <button
          onClick={onHomeClick}
          className="group flex items-center gap-2.5 text-left transition"
        >
          {/* Stylized Uni Bern Red Crest */}
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-white font-bold shadow-sm transition group-hover:bg-red-700">
            <span className="text-xs font-black tracking-wider">uᵇ</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold text-slate-900 tracking-tight">ILIAS Alternative</span>
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 border border-red-200">
                Uni Bern
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-none">Fast & Local Learning Portal</p>
          </div>
        </button>
      </div>

      {/* Right status area */}
      <div className="flex items-center gap-3">
        {authStatus?.authenticated ? (
          <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 border border-emerald-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>{authStatus.user_name || 'Verbunden'}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 border border-amber-200">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
              <span>Nicht angemeldet</span>
            </div>
            <button
              onClick={onTriggerLogin}
              disabled={isLoggingIn}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 transition disabled:opacity-50"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>{isLoggingIn ? 'Öffne Browser...' : 'SWITCH Login'}</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

