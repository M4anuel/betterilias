import React from 'react';

/** The hit area can grow without stretching the visible switch track. */
export function ToggleSwitch({ checked, onChange, label }: {
  checked: boolean; onChange: () => void; label: string;
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label}
    onClick={onChange} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg cursor-pointer">
    <span aria-hidden="true" className={`relative block h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-[var(--accent)]' : 'bg-slate-300 dark:bg-slate-700'}`}>
      <span className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${checked ? 'translate-x-5' : ''}`} />
    </span>
  </button>;
}
