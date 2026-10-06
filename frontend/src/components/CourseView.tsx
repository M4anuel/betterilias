import React, { useState, useEffect } from 'react';
import {
  Folder,
  FileText,
  Download,
  ExternalLink,
  Search,
  CheckCircle,
  Layers,
  ArrowLeft,
  RefreshCw,
  Vote,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Award,
  HelpCircle,
  Info,
  Calendar,
  Radio,
  Play,
} from 'lucide-react';
import { CourseMaterialsResponse, MaterialItem } from '../types';
import { CompactBreadcrumbs } from './CompactBreadcrumbs';
import { CourseLogsPanel } from './CourseLogsPanel';
import { PodcastModal } from './PodcastModal';
import { SessionDrawer } from './SessionDrawer';
import { api } from '../lib/api';

declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (elements?: HTMLElement[]) => Promise<void>;
      typesetClear?: () => void;
    };
  }
}

interface CourseViewProps {
  courseRefId: string;
  courseNickname: string;
  materialsData: CourseMaterialsResponse | null;
  onNavigateFolder: (folderRefId: string) => void;
  onNavigateHome: () => void;
  onNavigateCourseRoot: (courseRefId: string) => void;
  isRevalidating: boolean;
  onManualRefresh: () => void;
  onNotifyChange?: (notifications: any[]) => void;
}

export const CourseView: React.FC<CourseViewProps> = ({
  courseRefId,
  courseNickname,
  materialsData,
  onNavigateFolder,
  onNavigateHome,
  onNavigateCourseRoot,
  isRevalidating,
  onManualRefresh,
  onNotifyChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [activePodcast, setActivePodcast] = useState<{ refId: string; title: string } | null>(null);

  // Trigger MathJax typesetting whenever materialsData changes
  useEffect(() => {
    let active = true;
    const triggerMath = () => {
      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise().catch((err: any) => {
          console.warn('MathJax typesetting error:', err);
        });
      } else {
        const interval = setInterval(() => {
          if (!active) {
            clearInterval(interval);
            return;
          }
          if (window.MathJax?.typesetPromise) {
            clearInterval(interval);
            window.MathJax.typesetPromise().catch((err: any) => {
              console.warn('MathJax typesetting error:', err);
            });
          }
        }, 100);
        setTimeout(() => clearInterval(interval), 4000);
      }
    };

    const timer = setTimeout(triggerMath, 60);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [materialsData]);

  if (!materialsData) {
    return (
      <div className="flex h-96 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
          <p className="text-xs font-semibold">Lade Vorlesungsinhalte...</p>
        </div>
      </div>
    );
  }

  const isInsideSubfolder = materialsData.container_ref_id !== courseRefId;
  const sections = materialsData.sections || [];
  const richTextBlocks = materialsData.rich_text_blocks || [];
  const sessions = materialsData.sessions || [];
  const logs = materialsData.logs || [];
  const hasDistinctSections =
    sections.length > 1 || (sections.length === 1 && sections[0].id !== 'general' && sections[0].groups.length > 1);

  // Filter items by search query
  const matchesSearch = (item: MaterialItem) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q))
    );
  };

  const filteredFlatItems = materialsData.items.filter(matchesSearch);

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const toggleAllSections = () => {
    const allCollapsed = sections.every((s) => collapsedSections[s.id]);
    const next: Record<string, boolean> = {};
    for (const s of sections) {
      next[s.id] = !allCollapsed;
    }
    setCollapsedSections(next);
  };

  const getItemIcon = (item: MaterialItem) => {
    if (item.item_type === 'fold') return <Folder className="h-4 w-4 text-amber-500 fill-amber-50 shrink-0" />;
    if (item.item_type === 'file') return <FileText className="h-4 w-4 text-red-500 fill-red-50 shrink-0" />;
    if (item.item_type === 'exc') return <Layers className="h-4 w-4 text-indigo-500 shrink-0" />;
    if (item.item_type === 'mcst') return <Radio className="h-4 w-4 text-sky-500 shrink-0" />;
    if (item.item_type === 'sess') return <Calendar className="h-4 w-4 text-emerald-500 shrink-0" />;
    if (item.title.toLowerCase().includes('voting')) return <Vote className="h-4 w-4 text-purple-500 shrink-0" />;
    return <ExternalLink className="h-4 w-4 text-slate-400 shrink-0" />;
  };

  const getRichBlockIcon = (title?: string) => {
    if (!title) return <Info className="h-4 w-4 text-slate-500" />;
    const t = title.toLowerCase();
    if (t.includes('literature') || t.includes('literatur') || t.includes('buch') || t.includes('skript')) {
      return <BookOpen className="h-4 w-4 text-blue-500" />;
    }
    if (t.includes('grading') || t.includes('grade') || t.includes('note') || t.includes('prüfung')) {
      return <Award className="h-4 w-4 text-amber-500" />;
    }
    if (t.includes('office') || t.includes('contact') || t.includes('kontakt') || t.includes('frage')) {
      return <HelpCircle className="h-4 w-4 text-emerald-500" />;
    }
    return <Info className="h-4 w-4 text-indigo-500" />;
  };

  // Render a single material item row
  const renderItemRow = (item: MaterialItem) => {
    const isFile = item.item_type === 'file';
    const isFolder = item.item_type === 'fold';
    const isPodcast =
      item.item_type === 'mcst' ||
      item.title.toLowerCase().includes('podcast') ||
      item.url.toLowerCase().includes('xoct');
    const downloadUrl = isFile ? api.getDownloadUrl(item.ref_id, item.download_url) : null;

    if (isFolder) {
      return (
        <div
          key={item.ref_id}
          onClick={() => onNavigateFolder(item.ref_id)}
          className="flex items-center justify-between p-3 hover:bg-slate-50/80 transition rounded-xl border border-transparent hover:border-amber-200 cursor-pointer group"
        >
          <div className="flex items-center gap-3 truncate pr-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 shrink-0 group-hover:scale-105 transition">
              <Folder className="h-4 w-4 fill-amber-100" />
            </div>
            <div className="truncate">
              <span className="text-xs font-bold text-slate-800 group-hover:text-amber-800 transition block truncate">
                {item.title}
              </span>
              {item.description && (
                <span className="text-[10px] text-slate-400 truncate block">{item.description}</span>
              )}
            </div>
          </div>
          <span className="text-[11px] font-semibold text-slate-400 group-hover:text-amber-600 transition shrink-0">
            Öffnen →
          </span>
        </div>
      );
    }

    if (isPodcast) {
      return (
        <div
          key={item.ref_id}
          onClick={() => setActivePodcast({ refId: item.ref_id, title: item.title })}
          className="flex items-center justify-between p-3 hover:bg-sky-50/70 transition rounded-xl border border-transparent hover:border-sky-200 cursor-pointer group gap-3"
        >
          <div className="flex items-center gap-3 truncate">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600 shrink-0 group-hover:scale-105 transition">
              <Radio className="h-4 w-4" />
            </div>
            <div className="truncate">
              <span className="text-xs font-bold text-slate-800 group-hover:text-sky-800 transition block truncate">
                {item.title}
              </span>
              <span className="text-[10px] text-sky-600 font-medium block truncate">
                {item.description || 'Opencast Vorlesungsaufzeichnungen ansehen'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActivePodcast({ refId: item.ref_id, title: item.title });
              }}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-700 transition shadow-2xs"
            >
              <Play className="h-3 w-3 fill-white" />
              <span>Aufnahmen</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        key={item.ref_id}
        className="flex items-center justify-between p-3 hover:bg-slate-50/80 transition rounded-xl border border-transparent hover:border-slate-200 gap-3"
      >
        <div className="flex items-center gap-3 truncate">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 shrink-0">
            {getItemIcon(item)}
          </div>
          <div className="truncate">
            {isFile && downloadUrl ? (
              <a
                href={downloadUrl}
                download
                className="text-xs font-bold text-slate-900 hover:text-red-600 transition block truncate"
                title={item.title}
              >
                {item.title}
              </a>
            ) : (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-slate-900 hover:text-red-600 transition block truncate"
                title={item.title}
              >
                {item.title}
              </a>
            )}
            {item.description && (
              <p className="text-[11px] text-slate-500 line-clamp-1">{item.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {item.file_size && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-medium text-slate-600">
              {item.file_size}
            </span>
          )}
          {isFile && downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-red-600 hover:text-white transition shadow-2xs"
            >
              <Download className="h-3 w-3" />
              <span>Download</span>
            </a>
          ) : (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition shadow-2xs"
            >
              <span>ILIAS</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Top Header with Breadcrumbs & Sync Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <CompactBreadcrumbs
          rawBreadcrumbs={materialsData.breadcrumbs}
          courseNickname={courseNickname}
          courseRefId={courseRefId}
          currentFolderRefId={materialsData.container_ref_id}
          onNavigateHome={onNavigateHome}
          onNavigateCourse={onNavigateCourseRoot}
          onNavigateFolder={onNavigateFolder}
        />

        {/* Sync / Refresh status */}
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          {isRevalidating ? (
            <div className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>Synchronisiere...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              <CheckCircle className="h-3 w-3 text-emerald-500" />
              <span>Lokal bereitgestellt</span>
            </div>
          )}

          <button
            onClick={onManualRefresh}
            disabled={isRevalidating}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition disabled:opacity-50 cursor-pointer"
            title="Neu von ILIAS abrufen"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main Title Row & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            {isInsideSubfolder && (
              <button
                onClick={() => onNavigateCourseRoot(courseRefId)}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Zurück</span>
              </button>
            )}
            <h1 className="text-xl font-bold text-slate-900 leading-tight">
              {materialsData.title || courseNickname}
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {materialsData.items.length} {materialsData.items.length === 1 ? 'Material' : 'Materialien'} verfügbar
          </p>
        </div>

        {/* Live Filter Bar */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Vorlesung durchsuchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden focus:ring-2 focus:ring-red-100 transition shadow-2xs"
          />
        </div>
      </div>

      {/* Main Grid: Content (Left) and Logs (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Content Area */}
        <div
          className={`space-y-6 ${
            logs.length > 0 ? 'lg:col-span-8 xl:col-span-8' : 'lg:col-span-12'
          }`}
        >
          {/* 1. Rich Text Blocks (Syllabus, Literature, Grading Policy, MathML) */}
          {richTextBlocks.length > 0 && !searchQuery && (
            <div className="space-y-4">
              {richTextBlocks.map((block, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3 transition hover:border-slate-300"
                >
                  {block.title && (
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                      {getRichBlockIcon(block.title)}
                      <h3 className="text-sm font-bold text-slate-900">{block.title}</h3>
                    </div>
                  )}
                  <div
                    className="ilias-rich-content text-xs text-slate-700 leading-relaxed font-sans"
                    dangerouslySetInnerHTML={{ __html: block.html_content }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Sessions / Sitzungen Drawers (e.g. Lernen und Gedächtnis style) */}
          {sessions.length > 0 && !searchQuery && (
            <SessionDrawer sessions={sessions} />
          )}

          {/* 2. Structured Section Accordions (like P&O style) */}
          {hasDistinctSections && !searchQuery && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Vorlesungsteile & Module
                </span>
                <button
                  onClick={toggleAllSections}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 transition cursor-pointer"
                >
                  {sections.every((s) => collapsedSections[s.id]) ? 'Alle ausklappen' : 'Alle einklappen'}
                </button>
              </div>

              {sections.map((section) => {
                const isCollapsed = !!collapsedSections[section.id];
                const sectionItemCount = section.groups.reduce((acc, g) => acc + g.items.length, 0);

                return (
                  <div
                    key={section.id}
                    className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden transition"
                  >
                    {/* Accordion Section Header */}
                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      className="flex w-full items-center justify-between p-4 bg-slate-50/70 hover:bg-slate-100/60 transition text-left select-none cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-50 text-red-600 font-bold text-xs">
                          {section.title.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">{section.title}</h3>
                          <p className="text-[11px] text-slate-400">
                            {section.groups.length} {section.groups.length === 1 ? 'Gruppe' : 'Gruppen'} • {sectionItemCount} Elemente
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-slate-400">
                        {isCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                      </div>
                    </button>

                    {/* Accordion Body */}
                    {!isCollapsed && (
                      <div className="p-4 space-y-6 border-t border-slate-100">
                        {section.rich_text_blocks.map((rb, rIdx) => (
                          <div key={rIdx} className="rounded-xl bg-slate-50 p-3.5 space-y-2">
                            {rb.title && <h4 className="text-xs font-bold text-slate-800">{rb.title}</h4>}
                            <div
                              className="ilias-rich-content text-xs text-slate-600 leading-relaxed"
                              dangerouslySetInnerHTML={{ __html: rb.html_content }}
                            />
                          </div>
                        ))}

                        {section.groups.map((group, gIdx) => (
                          <div key={gIdx} className="space-y-2">
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                                {group.title}
                              </h4>
                              <div className="h-px flex-1 bg-slate-100" />
                              <span className="text-[10px] font-semibold text-slate-400">
                                {group.items.length}
                              </span>
                            </div>

                            <div className="rounded-xl border border-slate-100 divide-y divide-slate-100 bg-white shadow-2xs">
                              {group.items.map(renderItemRow)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 3. Search Results or Flat Category View */}
          {(!hasDistinctSections || searchQuery) && (
            <div className="space-y-6">
              {searchQuery && (
                <p className="text-xs font-medium text-slate-500">
                  Suchergebnisse für &quot;{searchQuery}&quot; ({filteredFlatItems.length} Treffer):
                </p>
              )}

              {/* Folders */}
              {filteredFlatItems.filter((i) => i.item_type === 'fold').length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Folder className="h-4 w-4 text-amber-500" />
                    <span>Ordner</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {filteredFlatItems
                      .filter((i) => i.item_type === 'fold')
                      .map((folder) => (
                        <div
                          key={folder.ref_id}
                          onClick={() => onNavigateFolder(folder.ref_id)}
                          className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-amber-300 hover:shadow-xs cursor-pointer"
                        >
                          <div className="flex items-center gap-3 truncate pr-2">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600 shrink-0 group-hover:scale-105 transition">
                              <Folder className="h-5 w-5 fill-amber-100" />
                            </div>
                            <div className="truncate">
                              <span className="text-xs font-bold text-slate-800 group-hover:text-amber-800 transition block truncate">
                                {folder.title}
                              </span>
                              {folder.description && (
                                <span className="text-[10px] text-slate-400 truncate block">
                                  {folder.description}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Podcasts / Videos */}
              {filteredFlatItems.filter((i) => i.item_type === 'mcst' || i.title.toLowerCase().includes('podcast')).length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-sky-600 flex items-center gap-1.5">
                    <Radio className="h-4 w-4 text-sky-500" />
                    <span>Podcasts & Vorlesungsaufzeichnungen</span>
                  </h3>
                  <div className="rounded-2xl border border-sky-100 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden">
                    {filteredFlatItems
                      .filter((i) => i.item_type === 'mcst' || i.title.toLowerCase().includes('podcast'))
                      .map(renderItemRow)}
                  </div>
                </div>
              )}

              {/* Files & Slides */}
              {filteredFlatItems.filter((i) => i.item_type === 'file').length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-red-500" />
                    <span>Dateien & Folien</span>
                  </h3>
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden">
                    {filteredFlatItems.filter((i) => i.item_type === 'file').map(renderItemRow)}
                  </div>
                </div>
              )}

              {/* Exercises & Other */}
              {filteredFlatItems.filter(
                (i) => !['fold', 'file', 'mcst'].includes(i.item_type) && !i.title.toLowerCase().includes('podcast')
              ).length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-500 flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-indigo-500" />
                    <span>Übungen & Interaktives</span>
                  </h3>
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden">
                    {filteredFlatItems
                      .filter(
                        (i) => !['fold', 'file', 'mcst'].includes(i.item_type) && !i.title.toLowerCase().includes('podcast')
                      )
                      .map(renderItemRow)}
                  </div>
                </div>
              )}

              {filteredFlatItems.length === 0 && (
                <div className="flex h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-center p-6">
                  <Search className="h-6 w-6 text-slate-300 mb-2" />
                  <p className="text-xs font-bold text-slate-700">Keine Materialien gefunden</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Versuche einen anderen Suchbegriff.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Course Logs / News Widget */}
        {logs.length > 0 && (
          <div className="lg:col-span-4 xl:col-span-4 space-y-4 lg:sticky lg:top-6">
            <CourseLogsPanel
              courseId={materialsData.container_ref_id}
              initialLogs={logs}
            />
          </div>
        )}
      </div>

      {/* Opencast Podcast Modal */}
      {activePodcast && (
        <PodcastModal
          refId={activePodcast.refId}
          title={activePodcast.title}
          onClose={() => setActivePodcast(null)}
          onNewPodcastFound={(count, epTitle) => {
            if (onNotifyChange) {
              onNotifyChange([
                {
                  id: `pod-${Date.now()}`,
                  type: 'podcast',
                  title: epTitle,
                  subtitle: `${count} neue Vorlesungsaufzeichnung(en) synchronisiert`,
                },
              ]);
            }
          }}
        />
      )}
    </div>
  );
};

export default CourseView;
