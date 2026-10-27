import { t, useLanguage } from '../lib/i18n';
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
  Eye,
  EyeOff,
  Files,
  MessageSquare,
  Heading,
  BookOpen,
} from 'lucide-react';
import { CourseContentBlock } from '../types';

interface ContentOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  blocks: CourseContentBlock[];
  blockOrder: string[];
  hiddenBlockIds: string[];
  showAllFilesBlock: boolean;
  onSaveOrder: (newOrder: string[]) => void;
  onToggleHideBlock: (blockId: string) => void;
  onToggleShowAllFiles: (show: boolean) => void;
  onResetToDefault: () => void;
}

export const ContentOrderModal: React.FC<ContentOrderModalProps> = ({
  isOpen,
  onClose,
  blocks,
  blockOrder,
  hiddenBlockIds,
  showAllFilesBlock,
  onSaveOrder,
  onToggleHideBlock,
  onToggleShowAllFiles,
  onResetToDefault,
}) => {
  useLanguage();
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

  // Build map of available blocks by ID
  const blockMap = new Map<string, CourseContentBlock>();
  for (const b of blocks) {
    blockMap.set(b.id, b);
  }

  // Create virtual "All Files" block if enabled
  if (showAllFilesBlock) {
    blockMap.set('block-all-files', {
      id: 'block-all-files',
      block_type: 'all_files',
      title: t("Sammelblock: Alle Dateien"),
    });
  }

  // Ordered list of IDs: take valid IDs from blockOrder, then append any missing blocks from blocks
  const orderedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const id of blockOrder) {
    if (blockMap.has(id) && !seenIds.has(id)) {
      orderedIds.push(id);
      seenIds.add(id);
    }
  }

  // Append any blocks from ILIAS not yet in the order
  for (const b of blocks) {
    if (!seenIds.has(b.id)) {
      orderedIds.push(b.id);
      seenIds.add(b.id);
    }
  }

  // Append virtual all-files block if enabled and not placed yet
  if (showAllFilesBlock && !seenIds.has('block-all-files')) {
    orderedIds.push('block-all-files');
  }

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const next = [...orderedIds];
    const temp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = temp;
    onSaveOrder(next);
  };

  const moveDown = (index: number) => {
    if (index >= orderedIds.length - 1) return;
    const next = [...orderedIds];
    const temp = next[index + 1];
    next[index + 1] = next[index];
    next[index] = temp;
    onSaveOrder(next);
  };

  const getBlockMeta = (b: CourseContentBlock) => {
    if (b.id === 'block-all-files' || b.block_type === 'all_files') {
      return {
        icon: <Files className="h-4 w-4 text-amber-600" />,
        badgeBg: 'bg-amber-50 text-amber-700',
        label: b.title || t("Alle Dateien"),
        desc: t("Sammelübersicht aller Dateien des Kurses an einem Ort"),
      };
    }
    if (b.block_type === 'heading') {
      return {
        icon: <Heading className="h-4 w-4 text-indigo-600" />,
        badgeBg: 'bg-indigo-50 text-indigo-700',
        label: b.title || t("Hauptüberschrift"),
        desc: t('Struktureller Abschnitt / Trenner'),
      };
    }
    if (b.block_type === 'drawer') {
      return {
        icon: <Bookmark className="h-4 w-4 text-rose-500" />,
        badgeBg: 'bg-rose-50 text-rose-700',
        label: b.title || t('Schublade / Modul'),
        desc: `${b.child_blocks?.length || 0} Unterabschnitte`,
      };
    }
    if (b.block_type === 'sessions') {
      return {
        icon: <Calendar className="h-4 w-4 text-emerald-500" />,
        badgeBg: 'bg-emerald-50 text-emerald-700',
        label: b.title || t("Sitzungen & Termine"),
        desc: t("{p0} Termine mit Materialien", { p0: b.sessions?.length || 0 }),
      };
    }
    if (b.block_type === 'text') {
      const preview = b.plain_text ? b.plain_text.slice(0, 55) + (b.plain_text.length > 55 ? '...' : '') : t("Informationstext");
      return {
        icon: <Info className="h-4 w-4 text-blue-500" />,
        badgeBg: 'bg-blue-50 text-blue-700',
        label: b.title || t("Kursinformation"),
        desc: preview,
      };
    }
    // items block
    const items = b.items || [];
    let icon = <BookOpen className="h-4 w-4 text-indigo-500" />;
    let badgeBg = 'bg-indigo-50 text-indigo-700';

    if (items.length > 0 && items.every((i) => i.item_type === 'fold')) {
      icon = <Folder className="h-4 w-4 text-amber-500" />;
      badgeBg = 'bg-amber-50 text-amber-700';
    } else if (items.length > 0 && items.every((i) => i.item_type === 'mcst' || i.title.toLowerCase().includes('podcast'))) {
      icon = <Radio className="h-4 w-4 text-sky-500" />;
      badgeBg = 'bg-sky-50 text-sky-700';
    } else if (items.length > 0 && items.every((i) => i.item_type === 'exc')) {
      icon = <Layers className="h-4 w-4 text-indigo-500" />;
      badgeBg = 'bg-indigo-50 text-indigo-700';
    } else if (items.length > 0 && items.every((i) => i.item_type === 'frm')) {
      icon = <MessageSquare className="h-4 w-4 text-purple-500" />;
      badgeBg = 'bg-purple-50 text-purple-700';
    } else if (items.length > 0 && items.every((i) => i.item_type === 'file')) {
      icon = <FileText className="h-4 w-4 text-red-500" />;
      badgeBg = 'bg-red-50 text-red-700';
    }

    const preview = items.length > 0 ? `${items.length} ${items.length === 1 ? t("Element") : t("Elemente")}` : t("Leer");
    return {
      icon,
      badgeBg,
      label: b.title || t("Inhalte"),
      desc: preview,
    };
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
      className="app-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90dvh] animate-in zoom-in-95 duration-150 transition-colors"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4 bg-slate-50/80 dark:bg-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t("Reihenfolge der Abschnitte & Blöcke")}</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t("Passe die Anordnung der Vorlesungsblöcke nach deinen Wünschen an")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
            title={t("Schliessen")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* List of Reorderable Blocks */}
          <div className="space-y-2">
            {orderedIds.map((blockId, idx) => {
              const block = blockMap.get(blockId);
              if (!block) return null;

              const meta = getBlockMeta(block);
              const isHidden = hiddenBlockIds.includes(blockId);
              const isFirst = idx === 0;
              const isLast = idx === orderedIds.length - 1;

              return (
                <div
                  key={blockId}
                  className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 p-3 rounded-2xl border transition shadow-2xs ${
                    isHidden
                      ? 'border-slate-200/50 dark:border-slate-800/50 bg-slate-50/60 dark:bg-slate-900/60 opacity-60'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-400 font-mono shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800 shrink-0">
                      {meta.icon}
                    </div>
                    <div className="min-w-0 truncate">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs font-bold block truncate leading-tight ${
                            isHidden ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block truncate">{meta.desc}</span>
                    </div>
                  </div>

                  {/* Move and Visibility Controls */}
                  <div className="flex items-center justify-end gap-1 shrink-0">
                    {/* Toggle Visibility */}
                    <button
                      type="button"
                      onClick={() => onToggleHideBlock(blockId)}
                      className={`p-1.5 rounded-lg transition cursor-pointer ${
                        isHidden
                          ? 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                      title={isHidden ? t("Block einblenden") : t("Block ausblenden")}
                    >
                      {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>

                    {/* Move Up */}
                    <button
                      type="button"
                      onClick={() => moveUp(idx)}
                      disabled={isFirst}
                      className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition cursor-pointer"
                      title={t("Nach oben verschieben")}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>

                    {/* Move Down */}
                    <button
                      type="button"
                      onClick={() => moveDown(idx)}
                      disabled={isLast}
                      className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition cursor-pointer"
                      title={t("Nach unten verschieben")}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Special Feature: "Alle Dateien" Sammelblock Toggle */}
          <div className="rounded-2xl border border-amber-200/80 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/30 p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 shrink-0">
                <Files className="h-4 w-4" />
              </div>
              <div>
                <span className="text-xs font-bold text-amber-950 dark:text-amber-100 block">
                  {t("Sammelblock \"Alle Dateien\"")}
                </span>
                <span className="text-[10px] text-amber-800/80 dark:text-amber-300/80 block">
                  {t("Erstellt eine zusätzliche Übersicht aller Dateien dieses Kurses")}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onToggleShowAllFiles(!showAllFilesBlock)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-2xs ${
                showAllFilesBlock
                  ? 'bg-amber-600 text-white'
                  : 'bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-slate-700'
              }`}
            >
              {showAllFilesBlock ? t("Aktiv") : t("Hinzufügen")}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-6 py-3.5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onResetToDefault}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition cursor-pointer"
            title={t("Auf die originale ILIAS-Reihenfolge der Dozierenden zurücksetzen")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t("Auf ILIAS-Standard zurücksetzen")}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 px-4 py-2 text-xs font-bold text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 transition cursor-pointer shadow-xs"
          >
            <Check className="h-3.5 w-3.5" />
            <span>{t("Fertig")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ContentOrderModal;
