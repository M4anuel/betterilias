import React, { useEffect, useRef } from 'react';
import {
  X,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Folder,
  FileText,
  Radio,
  Calendar,
  Layers,
  Info,
  Bookmark,
  Check,
  SlidersHorizontal,
} from 'lucide-react';
import { ContentSectionId, DEFAULT_SECTION_ORDER } from '../lib/cache';

interface ContentOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: ContentSectionId[];
  onSaveOrder: (newOrder: ContentSectionId[]) => void;
}

interface SectionMeta {
  id: ContentSectionId;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

const SECTION_METAS: Record<ContentSectionId, SectionMeta> = {
  folders: {
    id: 'folders',
    label: 'Ordner',
    desc: 'Unterverzeichnisse und Ordnerhierarchien',
    icon: <Folder className="h-4 w-4 text-amber-500 fill-amber-100" />,
  },
  files: {
    id: 'files',
    label: 'Dateien & Folien',
    desc: 'PDF-Folien, Dokumente und Skripte',
    icon: <FileText className="h-4 w-4 text-red-500 fill-red-100" />,
  },
  podcasts: {
    id: 'podcasts',
    label: 'Podcasts & Vorlesungsaufzeichnungen',
    desc: 'Opencast Videos und Aufnahmen',
    icon: <Radio className="h-4 w-4 text-sky-500" />,
  },
  sessions: {
    id: 'sessions',
    label: 'Sitzungen (Termine)',
    desc: 'Termin-Schubladen mit zugehörigen Materialien',
    icon: <Calendar className="h-4 w-4 text-emerald-500" />,
  },
  exercises: {
    id: 'exercises',
    label: 'Übungen & Sonstiges',
    desc: 'Übungsaufgaben, Tests und Links',
    icon: <Layers className="h-4 w-4 text-indigo-500" />,
  },
  richtext: {
    id: 'richtext',
    label: 'Kursinformationen & Textblöcke',
    desc: 'Syllabus, Literatur, Bewertungskriterien & Formeln',
    icon: <Info className="h-4 w-4 text-blue-500" />,
  },
  sections: {
    id: 'sections',
    label: 'Vorlesungsteile & Module (Akkordeons)',
    desc: 'Mehrteilige Kursmodule (z.B. Teil Organisation / Personal)',
    icon: <Bookmark className="h-4 w-4 text-rose-500" />,
  },
};

export const ContentOrderModal: React.FC<ContentOrderModalProps> = ({
  isOpen,
  onClose,
  order,
  onSaveOrder,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const mouseDownInsideRef = useRef(false);

  // Keyboard navigation: Escape closes modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const next = [...order];
    const temp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = temp;
    onSaveOrder(next);
  };

  const moveDown = (index: number) => {
    if (index >= order.length - 1) return;
    const next = [...order];
    const temp = next[index + 1];
    next[index + 1] = next[index];
    next[index] = temp;
    onSaveOrder(next);
  };

  const resetToDefault = () => {
    onSaveOrder(DEFAULT_SECTION_ORDER);
  };

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      mouseDownInsideRef.current = false;
    } else {
      mouseDownInsideRef.current = true;
    }
  };

  const handleBackdropMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mouseDownInsideRef.current && modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
    mouseDownInsideRef.current = false;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Reihenfolge der Inhalte anpassen</h2>
              <p className="text-[11px] text-slate-500">Bestimme, welche Abschnitte zuerst angezeigt werden</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition cursor-pointer"
            title="Schliessen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* List of Reorderable Sections */}
        <div className="p-5 overflow-y-auto space-y-2 flex-1">
          {order.map((sectionId, idx) => {
            const meta = SECTION_METAS[sectionId] || {
              id: sectionId,
              label: sectionId,
              desc: '',
              icon: <Folder className="h-4 w-4 text-slate-400" />,
            };

            const isFirst = idx === 0;
            const isLast = idx === order.length - 1;

            return (
              <div
                key={sectionId}
                className="flex items-center justify-between p-3 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 transition shadow-2xs group"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600 font-mono shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-50 shrink-0">
                    {meta.icon}
                  </div>
                  <div className="min-w-0 truncate">
                    <span className="text-xs font-bold text-slate-800 block truncate leading-tight">
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-slate-400 block truncate">{meta.desc}</span>
                  </div>
                </div>

                {/* Move Controls */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveUp(idx)}
                    disabled={isFirst}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                    title="Nach oben verschieben"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(idx)}
                    disabled={isLast}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                    title="Nach unten verschieben"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3.5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={resetToDefault}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Standard wiederherstellen</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition cursor-pointer shadow-xs"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Fertig</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ContentOrderModal;

