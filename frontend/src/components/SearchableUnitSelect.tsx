import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, Check, Users, User, ChevronDown } from 'lucide-react';
import { t } from '../lib/i18n';

export interface AssignmentUnitOption {
  unitId: string;
  isTeam: boolean;
  teamId?: string;
  hasSubmitted: boolean;
  memberNames: string[];
  primaryLabel: string;
  secondaryLabel?: string;
}

interface SearchableUnitSelectProps {
  selectedUnitId: string;
  onSelect: (unitId: string) => void;
  onClear?: () => void;
  units: AssignmentUnitOption[];
  isGroupExercise?: boolean;
}

export const SearchableUnitSelect: React.FC<SearchableUnitSelectProps> = ({
  selectedUnitId,
  onSelect,
  onClear,
  units,
  isGroupExercise = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedUnit = useMemo(() => {
    return units.find((u) => u.unitId === selectedUnitId);
  }, [units, selectedUnitId]);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Close on outside click or Escape
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Filter units based on search query
  const filteredUnits = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return units;

    return units.filter((u) => {
      if (u.primaryLabel.toLowerCase().includes(q)) return true;
      if (u.secondaryLabel && u.secondaryLabel.toLowerCase().includes(q)) return true;
      if (u.teamId && u.teamId.toLowerCase().includes(q)) return true;
      if (u.unitId.toLowerCase().includes(q)) return true;
      return u.memberNames.some((m) => m.toLowerCase().includes(q));
    });
  }, [units, searchQuery]);

  // Split into submitted (priority) and unsubmitted groups
  const { submittedUnits, otherUnits } = useMemo(() => {
    const submitted: AssignmentUnitOption[] = [];
    const others: AssignmentUnitOption[] = [];

    filteredUnits.forEach((u) => {
      if (isGroupExercise) {
        if (u.isTeam && u.hasSubmitted) {
          submitted.push(u);
        } else if (!u.isTeam && u.hasSubmitted) {
          submitted.push(u);
        } else {
          others.push(u);
        }
      } else {
        if (u.hasSubmitted) {
          submitted.push(u);
        } else {
          others.push(u);
        }
      }
    });

    return { submittedUnits: submitted, otherUnits: others };
  }, [filteredUnits, isGroupExercise]);

  const handleSelect = (unitId: string) => {
    onSelect(unitId);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full sm:w-auto">
      {/* Trigger Button or Mapped Badge */}
      {!isOpen && (
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {selectedUnit ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-200 text-xs font-semibold shadow-2xs max-w-full truncate">
              {selectedUnit.isTeam ? (
                <Users className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
              ) : (
                <User className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
              )}
              <span
                onClick={() => setIsOpen(true)}
                className="cursor-pointer hover:underline truncate max-w-[200px]"
                title={`${selectedUnit.primaryLabel}${selectedUnit.secondaryLabel ? ` (${selectedUnit.secondaryLabel})` : ''}`}
              >
                {selectedUnit.primaryLabel}
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-200 p-0.5 rounded cursor-pointer"
                title={t("Zuweisung ändern")}
              >
                <ChevronDown className="h-3 w-3" />
              </button>
              {onClear && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClear();
                  }}
                  className="text-teal-500 hover:text-teal-700 dark:hover:text-teal-300 p-0.5 rounded cursor-pointer ml-0.5"
                  title={t("Zuweisung aufheben")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 transition shadow-2xs cursor-pointer w-full sm:w-auto min-h-[36px]"
            >
              <span className="flex items-center gap-1.5 truncate">
                {isGroupExercise ? (
                  <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                ) : (
                  <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                )}
                <span className="truncate">{t("Empfänger auswählen...")}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* Searchable Dropdown Card */}
      {isOpen && (
        <div className="w-full sm:w-80 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-2.5 space-y-2 text-xs z-50">
          {/* Search Header */}
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("Empfänger oder Team suchen...")}
                className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:outline-hidden focus:ring-1 focus:ring-teal-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              title={t("Abbrechen")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Results List */}
          <div className="max-h-56 overflow-y-auto space-y-2 pr-0.5">
            {filteredUnits.length === 0 ? (
              <p className="text-center py-4 text-[11px] text-slate-400">
                {t("Keine passenden Teilnehmer oder Gruppen gefunden.")}
              </p>
            ) : (
              <>
                {/* Priority Section: Submitted Groups / Submissions */}
                {submittedUnits.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-lg mb-1">
                      <span>{isGroupExercise ? t("Eingereichte Gruppen") : t("Eingereichte Abgaben")}</span>
                      <span>{submittedUnits.length}</span>
                    </div>
                    <div className="space-y-0.5">
                      {submittedUnits.map((unit) => {
                        const isSelected = unit.unitId === selectedUnitId;
                        return (
                          <div
                            key={unit.unitId}
                            onClick={() => handleSelect(unit.unitId)}
                            className={`flex items-center justify-between gap-2 p-2 rounded-xl cursor-pointer transition text-[11px] ${
                              isSelected
                                ? 'bg-teal-500/15 border border-teal-500/30 text-teal-900 dark:text-teal-100 font-semibold'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {unit.isTeam ? (
                                <Users className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                              ) : (
                                <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              )}
                              <div className="truncate">
                                <p className="font-semibold truncate">{unit.primaryLabel}</p>
                                {unit.secondaryLabel && (
                                  <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                                    {unit.secondaryLabel}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100/70 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                {t("Eingereicht")}
                              </span>
                              {isSelected && <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Secondary Section: Other Units / No Submission */}
                {otherUnits.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-800/60 rounded-lg mb-1 mt-1">
                      <span>{t("Weitere Teilnehmer & Gruppen")}</span>
                      <span>{otherUnits.length}</span>
                    </div>
                    <div className="space-y-0.5">
                      {otherUnits.map((unit) => {
                        const isSelected = unit.unitId === selectedUnitId;
                        return (
                          <div
                            key={unit.unitId}
                            onClick={() => handleSelect(unit.unitId)}
                            className={`flex items-center justify-between gap-2 p-2 rounded-xl cursor-pointer transition text-[11px] opacity-80 hover:opacity-100 ${
                              isSelected
                                ? 'bg-teal-500/15 border border-teal-500/30 text-teal-900 dark:text-teal-100 font-semibold'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {unit.isTeam ? (
                                <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              ) : (
                                <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              )}
                              <div className="truncate">
                                <p className="font-semibold truncate">{unit.primaryLabel}</p>
                                {unit.secondaryLabel && (
                                  <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                                    {unit.secondaryLabel}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                {t("Keine Abgabe eingereicht")}
                              </span>
                              {isSelected && <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

