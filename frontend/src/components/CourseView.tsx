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
  ArrowRight,
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
  SlidersHorizontal,
} from 'lucide-react';
import { CourseMaterialsResponse, MaterialItem } from '../types';
import { CompactBreadcrumbs } from './CompactBreadcrumbs';
import { CourseLogsPanel } from './CourseLogsPanel';
import { PodcastModal } from './PodcastModal';
import { SessionDrawer } from './SessionDrawer';
import { ContentOrderModal } from './ContentOrderModal';
import { api } from '../lib/api';
import { cache, ContentSectionId } from '../lib/cache';

export interface CourseSearchResult {
  item: MaterialItem;
  containerRefId: string;
  containerTitle: string;
  breadcrumbs: string[];
  isSubfolderItem: boolean;
}

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
  loadError?: string | null;
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
  loadError,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [activePodcast, setActivePodcast] = useState<{ refId: string; title: string } | null>(null);
  const [subfolderMaterials, setSubfolderMaterials] = useState<
    Record<string, { materials: CourseMaterialsResponse; path: string[] }>
  >({});
  const [folderStats, setFolderStats] = useState<
    Record<string, { total: number; files: number; folders: number; isMapped: boolean; isEmpty: boolean }>
  >({});
  const [isScanningTree, setIsScanningTree] = useState(false);
  const [searchCategoryFilter, setSearchCategoryFilter] = useState<'all' | 'file' | 'fold' | 'mcst' | 'exc'>('all');
  const [sectionOrder, setSectionOrder] = useState<ContentSectionId[]>(() =>
    cache.getContentSectionOrder()
  );
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);

  const handleSaveSectionOrder = (newOrder: ContentSectionId[]) => {
    setSectionOrder(newOrder);
    cache.setContentSectionOrder(newOrder);
  };

  const getFoldersFromRes = (res: CourseMaterialsResponse): MaterialItem[] => {
    const list: MaterialItem[] = [];
    for (const item of res.items || []) {
      if (item.item_type === 'fold' && !list.some((x) => x.ref_id === item.ref_id)) {
        list.push(item);
      }
    }
    for (const sec of res.sections || []) {
      for (const grp of sec.groups || []) {
        for (const item of grp.items || []) {
          if (item.item_type === 'fold' && !list.some((x) => x.ref_id === item.ref_id)) {
            list.push(item);
          }
        }
      }
    }
    return list;
  };

  const countFolderItems = (res: CourseMaterialsResponse) => {
    const files = (res.items || []).filter((i) => i.item_type !== 'fold').length;
    const folders = (res.items || []).filter((i) => i.item_type === 'fold').length;
    const sectionItems = (res.sections || []).flatMap((s) => s.groups.flatMap((g) => g.items)).length;
    const total = files + folders + sectionItems;
    return { files: files + sectionItems, folders, total };
  };

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

  // Recursive subfolder discovery & tree mapping on initial load
  useEffect(() => {
    if (!materialsData) return;

    let isMounted = true;
    const discovered: Record<string, { materials: CourseMaterialsResponse; path: string[] }> = {};
    const stats: Record<
      string,
      { total: number; files: number; folders: number; isMapped: boolean; isEmpty: boolean }
    > = {};
    const visited = new Set<string>();

    const rootMaterials =
      materialsData.container_ref_id === courseRefId
        ? materialsData
        : cache.getCachedMaterials(courseRefId) || materialsData;

    const crawlTree = async () => {
      const topFolders = getFoldersFromRes(rootMaterials);
      const queue: { folder: MaterialItem; path: string[]; depth: number }[] = [];

      for (const f of topFolders) {
        if (!visited.has(f.ref_id)) {
          visited.add(f.ref_id);
          queue.push({ folder: f, path: [f.title], depth: 1 });
        }
      }

      if (materialsData.container_ref_id !== courseRefId) {
        const currentFolders = getFoldersFromRes(materialsData);
        for (const f of currentFolders) {
          if (!visited.has(f.ref_id)) {
            visited.add(f.ref_id);
            queue.push({ folder: f, path: [f.title], depth: 1 });
          }
        }
      }

      const uncachedQueue: { folder: MaterialItem; path: string[]; depth: number }[] = [];

      // 1. Immediately map all cached folders from localStorage in 0ms
      while (queue.length > 0) {
        const { folder, path, depth } = queue.shift()!;
        const cached = cache.getCachedMaterials(folder.ref_id);
        if (cached) {
          discovered[folder.ref_id] = { materials: cached, path };
          const c = countFolderItems(cached);
          stats[folder.ref_id] = {
            total: c.total,
            files: c.files,
            folders: c.folders,
            isMapped: true,
            isEmpty: c.total === 0,
          };

          if (depth < 6) {
            const childFolders = getFoldersFromRes(cached);
            for (const cf of childFolders) {
              if (!visited.has(cf.ref_id)) {
                visited.add(cf.ref_id);
                queue.push({ folder: cf, path: [...path, cf.title], depth: depth + 1 });
              }
            }
          }
        } else {
          uncachedQueue.push({ folder, path, depth });
        }
      }

      if (isMounted) {
        setSubfolderMaterials({ ...discovered });
        setFolderStats({ ...stats });
      }

      // 2. Fetch uncached folders recursively in background until entire tree is mapped
      if (uncachedQueue.length > 0) {
        setIsScanningTree(true);
        let fetchedCount = 0;
        const maxFetch = 40;

        while (uncachedQueue.length > 0 && fetchedCount < maxFetch && isMounted) {
          const { folder, path, depth } = uncachedQueue.shift()!;
          fetchedCount++;

          try {
            const fresh = await api.getMaterials(folder.ref_id);
            cache.setCachedMaterials(folder.ref_id, fresh);

            if (!isMounted) break;

            discovered[folder.ref_id] = { materials: fresh, path };
            const c = countFolderItems(fresh);
            stats[folder.ref_id] = {
              total: c.total,
              files: c.files,
              folders: c.folders,
              isMapped: true,
              isEmpty: c.total === 0,
            };

            // Recursively discover nested folders inside this fresh folder!
            if (depth < 6) {
              const childFolders = getFoldersFromRes(fresh);
              for (const cf of childFolders) {
                if (!visited.has(cf.ref_id)) {
                  visited.add(cf.ref_id);
                  const childCached = cache.getCachedMaterials(cf.ref_id);
                  if (childCached) {
                    discovered[cf.ref_id] = { materials: childCached, path: [...path, cf.title] };
                    const cc = countFolderItems(childCached);
                    stats[cf.ref_id] = {
                      total: cc.total,
                      files: cc.files,
                      folders: cc.folders,
                      isMapped: true,
                      isEmpty: cc.total === 0,
                    };
                  } else {
                    uncachedQueue.push({ folder: cf, path: [...path, cf.title], depth: depth + 1 });
                  }
                }
              }
            }

            setSubfolderMaterials({ ...discovered });
            setFolderStats({ ...stats });

            // Small 40ms yield to stay light on browser & backend
            await new Promise((res) => setTimeout(res, 40));
          } catch (e) {
            console.warn(`Could not preload subfolder ${folder.ref_id}`, e);
            if (isMounted) {
              stats[folder.ref_id] = {
                total: 0,
                files: 0,
                folders: 0,
                isMapped: false,
                isEmpty: false,
              };
              setFolderStats({ ...stats });
            }
          }
        }

        if (isMounted) {
          setIsScanningTree(false);
        }
      }
    };

    crawlTree();

    return () => {
      isMounted = false;
    };
  }, [courseRefId, materialsData?.container_ref_id]);

  if (!materialsData) {
    if (loadError) {
      return (
        <div className="flex h-96 flex-col items-center justify-center p-8 text-center animate-in fade-in duration-200">
          <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-xs max-w-md space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-600 mx-auto">
              <RefreshCw className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Vorlesungsinhalte konnten nicht geladen werden</h3>
            <p className="text-xs text-slate-500 leading-relaxed">{loadError}</p>
            <button
              type="button"
              onClick={onManualRefresh}
              className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition cursor-pointer shadow-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Erneut versuchen</span>
            </button>
          </div>
        </div>
      );
    }

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

  // Comprehensive repository search across current view + all subfolders
  const searchResults: CourseSearchResult[] = [];
  if (materialsData && searchQuery.trim().length > 0) {
    const q = searchQuery.toLowerCase().trim();
    const seenItemRefIds = new Set<string>();

    const itemMatches = (item: MaterialItem) =>
      item.title.toLowerCase().includes(q) ||
      (!!item.description && item.description.toLowerCase().includes(q));

    const currentTitle = materialsData.title || courseNickname || 'Hauptordner';

    // 1. Items in current container
    for (const item of materialsData.items) {
      if (itemMatches(item) && !seenItemRefIds.has(item.ref_id)) {
        seenItemRefIds.add(item.ref_id);
        searchResults.push({
          item,
          containerRefId: materialsData.container_ref_id,
          containerTitle: currentTitle,
          breadcrumbs: [currentTitle],
          isSubfolderItem: false,
        });
      }
    }

    // Section items in current container
    for (const sec of materialsData.sections || []) {
      for (const grp of sec.groups || []) {
        for (const item of grp.items || []) {
          if (itemMatches(item) && !seenItemRefIds.has(item.ref_id)) {
            seenItemRefIds.add(item.ref_id);
            searchResults.push({
              item,
              containerRefId: materialsData.container_ref_id,
              containerTitle: currentTitle,
              breadcrumbs: [currentTitle, sec.title || '', grp.title || ''].filter(Boolean) as string[],
              isSubfolderItem: false,
            });
          }
        }
      }
    }

    // 2. Items in crawled subfolders
    for (const [folderId, entry] of Object.entries(subfolderMaterials)) {
      if (folderId === materialsData.container_ref_id) continue;
      const folderTitle = entry.materials.title || entry.path[entry.path.length - 1] || 'Unterordner';

      for (const item of entry.materials.items || []) {
        if (itemMatches(item) && !seenItemRefIds.has(item.ref_id)) {
          seenItemRefIds.add(item.ref_id);
          searchResults.push({
            item,
            containerRefId: folderId,
            containerTitle: folderTitle,
            breadcrumbs: entry.path,
            isSubfolderItem: true,
          });
        }
      }

      for (const sec of entry.materials.sections || []) {
        for (const grp of sec.groups || []) {
          for (const item of grp.items || []) {
            if (itemMatches(item) && !seenItemRefIds.has(item.ref_id)) {
              seenItemRefIds.add(item.ref_id);
              searchResults.push({
                item,
                containerRefId: folderId,
                containerTitle: folderTitle,
                breadcrumbs: [...entry.path, sec.title || ''].filter(Boolean) as string[],
                isSubfolderItem: true,
              });
            }
          }
        }
      }
    }
  }

  const filteredSearchResults = searchResults.filter((r) => {
    if (searchCategoryFilter === 'all') return true;
    if (searchCategoryFilter === 'file') return r.item.item_type === 'file';
    if (searchCategoryFilter === 'fold') return r.item.item_type === 'fold';
    if (searchCategoryFilter === 'mcst')
      return r.item.item_type === 'mcst' || r.item.title.toLowerCase().includes('podcast');
    if (searchCategoryFilter === 'exc')
      return !['fold', 'file', 'mcst'].includes(r.item.item_type) && !r.item.title.toLowerCase().includes('podcast');
    return true;
  });

  const searchFileCount = searchResults.filter((r) => r.item.item_type === 'file').length;
  const searchFoldCount = searchResults.filter((r) => r.item.item_type === 'fold').length;
  const searchMcstCount = searchResults.filter(
    (r) => r.item.item_type === 'mcst' || r.item.title.toLowerCase().includes('podcast')
  ).length;
  const searchExcCount = searchResults.filter(
    (r) => !['fold', 'file', 'mcst'].includes(r.item.item_type) && !r.item.title.toLowerCase().includes('podcast')
  ).length;

  const renderSearchResultRow = (result: CourseSearchResult) => {
    const { item, containerRefId, breadcrumbs, isSubfolderItem } = result;
    const isFile = item.item_type === 'file';
    const isFolder = item.item_type === 'fold';
    const isPodcast =
      item.item_type === 'mcst' ||
      item.title.toLowerCase().includes('podcast') ||
      item.url.toLowerCase().includes('xoct');
    const downloadUrl = isFile ? api.getDownloadUrl(item.ref_id, item.download_url) : null;

    return (
      <div
        key={`${containerRefId}_${item.ref_id}`}
        className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 hover:bg-slate-50/80 transition gap-3"
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="mt-0.5">{getItemIcon(item)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-900 leading-snug">
                {item.title}
              </span>
              {item.file_size && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
                  {item.file_size}
                </span>
              )}
            </div>
            {item.description && (
              <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                {item.description}
              </p>
            )}
            {/* Breadcrumbs / Location Badge */}
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-100/90 px-2 py-0.5 rounded-md w-fit mt-1.5 border border-slate-200/50">
              <Folder className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="font-semibold text-slate-600 truncate max-w-md">
                {breadcrumbs.join(' › ') || 'Hauptordner'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {isSubfolderItem && (
            <button
              type="button"
              onClick={() => onNavigateFolder(containerRefId)}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition shadow-2xs"
              title="Zu diesem Ordner navigieren"
            >
              <Folder className="h-3 w-3 text-amber-500" />
              <span>In Ordner anzeigen</span>
            </button>
          )}

          {isFolder ? (
            <button
              type="button"
              onClick={() => onNavigateFolder(item.ref_id)}
              className="flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 text-xs font-semibold transition shadow-2xs"
            >
              <span>Öffnen</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          ) : isPodcast ? (
            <button
              type="button"
              onClick={() => setActivePodcast({ refId: item.ref_id, title: item.title })}
              className="flex items-center gap-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white px-2.5 py-1 text-xs font-semibold transition shadow-2xs"
            >
              <Play className="h-3 w-3" />
              <span>Aufzeichnungen</span>
            </button>
          ) : isFile && downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="flex items-center gap-1 rounded-lg bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 text-xs font-semibold transition shadow-2xs"
            >
              <Download className="h-3 w-3" />
              <span>Download</span>
            </a>
          ) : (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 text-xs font-semibold transition shadow-2xs"
            >
              <span>ILIAS</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    );
  };

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
      const stat = folderStats[item.ref_id];
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
          <div className="flex items-center gap-2 shrink-0">
            {stat ? (
              stat.isMapped ? (
                stat.isEmpty ? (
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                    Leer
                  </span>
                ) : (
                  <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200/50">
                    {stat.files > 0
                      ? `${stat.files} ${stat.files === 1 ? 'Datei' : 'Dateien'}`
                      : `${stat.folders} ${stat.folders === 1 ? 'Ordner' : 'Ordner'}`}
                  </span>
                )
              ) : null
            ) : isScanningTree ? (
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <RefreshCw className="h-2.5 w-2.5 animate-spin text-slate-400" />
              </span>
            ) : null}
            <span className="text-[11px] font-semibold text-slate-400 group-hover:text-amber-600 transition shrink-0">
              Öffnen →
            </span>
          </div>
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

        {/* Search & Actions Bar */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={() => setIsOrderModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition shadow-2xs cursor-pointer shrink-0"
            title="Reihenfolge der Abschnitte anpassen"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
            <span className="hidden sm:inline">Reihenfolge</span>
          </button>

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
      </div>

      {/* Main Grid: Content (Left) and Logs (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Content Area */}
        <div
          className={`space-y-6 ${
            logs.length > 0 ? 'lg:col-span-8 xl:col-span-8' : 'lg:col-span-12'
          }`}
        >
          {/* SEARCH RESULTS VIEW (Repo-wide across current folder and all subfolders) */}
          {searchQuery.trim().length > 0 ? (
            <div className="space-y-6">
              {/* Header & Scanning indicator */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Search className="h-4 w-4 text-red-600" />
                    <span>Suchergebnisse für &quot;{searchQuery}&quot;</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                      {filteredSearchResults.length} {filteredSearchResults.length === 1 ? 'Treffer' : 'Treffer'}
                    </span>
                  </h2>
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                    <span>
                      Durchsucht: Aktueller Ordner + {Object.keys(subfolderMaterials).length} Unterordner
                    </span>
                    {isScanningTree && (
                      <span className="flex items-center gap-1 text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md font-medium text-[11px]">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        <span>Analysiere Ordnerstruktur...</span>
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="self-start sm:self-auto text-xs font-semibold text-slate-500 hover:text-red-600 transition cursor-pointer"
                >
                  Suche zurücksetzen
                </button>
              </div>

              {/* Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSearchCategoryFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                    searchCategoryFilter === 'all'
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Alle ({searchResults.length})
                </button>
                {searchFileCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchCategoryFilter('file')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      searchCategoryFilter === 'file'
                        ? 'bg-red-600 text-white shadow-2xs'
                        : 'bg-red-50 text-red-700 hover:bg-red-100'
                    }`}
                  >
                    Dateien & Folien ({searchFileCount})
                  </button>
                )}
                {searchFoldCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchCategoryFilter('fold')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      searchCategoryFilter === 'fold'
                        ? 'bg-amber-600 text-white shadow-2xs'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    }`}
                  >
                    Unterordner ({searchFoldCount})
                  </button>
                )}
                {searchMcstCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchCategoryFilter('mcst')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      searchCategoryFilter === 'mcst'
                        ? 'bg-sky-600 text-white shadow-2xs'
                        : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                    }`}
                  >
                    Podcasts ({searchMcstCount})
                  </button>
                )}
                {searchExcCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchCategoryFilter('exc')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      searchCategoryFilter === 'exc'
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    Übungen & Weiteres ({searchExcCount})
                  </button>
                )}
              </div>

              {/* Search Results List */}
              {filteredSearchResults.length > 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden">
                  {filteredSearchResults.map(renderSearchResultRow)}
                </div>
              ) : (
                <div className="flex h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
                  <Search className="h-8 w-8 text-slate-300 mb-2" />
                  <h4 className="text-sm font-bold text-slate-700">Keine Suchergebnisse gefunden</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    In diesem Kurs oder dessen Unterordnern wurden keine Materialien zu &quot;{searchQuery}&quot; gefunden.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                  >
                    Suche zurücksetzen
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* NORMAL COURSE VIEW (Customizable Section Order) */
            (() => {
              const renderFoldersBlock = () => {
                const folders = filteredFlatItems.filter((i) => i.item_type === 'fold');
                if (folders.length === 0) return null;

                return (
                  <div key="sec-folders" className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <Folder className="h-4 w-4 text-amber-500" />
                        <span>Ordner</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {folders.length}
                        </span>
                      </h3>
                      {isScanningTree && (
                        <div className="flex items-center gap-1.5 text-[11px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md font-medium">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          <span>Analysiere Unterordner...</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {folders.map((folder) => {
                        const stat = folderStats[folder.ref_id];
                        return (
                          <div
                            key={folder.ref_id}
                            onClick={() => onNavigateFolder(folder.ref_id)}
                            className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-amber-300 hover:shadow-xs cursor-pointer gap-2.5"
                          >
                            <div className="flex items-start gap-3 truncate pr-2">
                              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 shrink-0 group-hover:scale-105 transition">
                                <Folder className="h-5 w-5 fill-amber-100" />
                              </div>
                              <div className="min-w-0 flex-1 truncate">
                                <span className="text-xs font-bold text-slate-800 group-hover:text-amber-800 transition block truncate">
                                  {folder.title}
                                </span>
                                {folder.description && (
                                  <span className="text-[10px] text-slate-400 truncate block mt-0.5">
                                    {folder.description}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px]">
                              {stat ? (
                                stat.isMapped ? (
                                  stat.isEmpty ? (
                                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-400">
                                      Leer
                                    </span>
                                  ) : (
                                    <span className="rounded-md bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700 border border-amber-200/50">
                                      {stat.files > 0
                                        ? `${stat.files} ${stat.files === 1 ? 'Datei' : 'Dateien'}`
                                        : `${stat.folders} ${stat.folders === 1 ? 'Ordner' : 'Ordner'}`}
                                    </span>
                                  )
                                ) : (
                                  <span className="text-slate-400">Ordner</span>
                                )
                              ) : isScanningTree ? (
                                <span className="inline-flex items-center gap-1 text-slate-400">
                                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                                  <span>Prüfe...</span>
                                </span>
                              ) : (
                                <span className="text-slate-400">Ordner</span>
                              )}

                              <span className="font-semibold text-slate-400 group-hover:text-amber-600 transition">
                                Öffnen →
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              };

              const renderFilesBlock = () => {
                const files = filteredFlatItems.filter((i) => i.item_type === 'file');
                if (files.length === 0) return null;

                return (
                  <div key="sec-files" className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-red-500" />
                      <span>Dateien & Folien</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {files.length}
                      </span>
                    </h3>
                    <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden">
                      {files.map(renderItemRow)}
                    </div>
                  </div>
                );
              };

              const renderPodcastsBlock = () => {
                const podcasts = filteredFlatItems.filter(
                  (i) => i.item_type === 'mcst' || i.title.toLowerCase().includes('podcast')
                );
                if (podcasts.length === 0) return null;

                return (
                  <div key="sec-podcasts" className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-sky-600 flex items-center gap-1.5">
                      <Radio className="h-4 w-4 text-sky-500" />
                      <span>Podcasts & Vorlesungsaufzeichnungen</span>
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                        {podcasts.length}
                      </span>
                    </h3>
                    <div className="rounded-2xl border border-sky-100 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden">
                      {podcasts.map(renderItemRow)}
                    </div>
                  </div>
                );
              };

              const renderSessionsBlock = () => {
                if (sessions.length === 0) return null;

                return (
                  <div key="sec-sessions" className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1.5">
                        <Calendar className="h-4 w-4 text-emerald-500" />
                        <span>Sitzungen (Termine)</span>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          {sessions.length}
                        </span>
                      </h3>
                    </div>
                    <SessionDrawer sessions={sessions} />
                  </div>
                );
              };

              const renderExercisesBlock = () => {
                const exercises = filteredFlatItems.filter(
                  (i) => !['fold', 'file', 'mcst'].includes(i.item_type) && !i.title.toLowerCase().includes('podcast')
                );
                if (exercises.length === 0) return null;

                return (
                  <div key="sec-exercises" className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-500 flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-indigo-500" />
                      <span>Übungen & Sonstiges</span>
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                        {exercises.length}
                      </span>
                    </h3>
                    <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden">
                      {exercises.map(renderItemRow)}
                    </div>
                  </div>
                );
              };

              const renderRichTextBlock = () => {
                if (richTextBlocks.length === 0) return null;

                return (
                  <div key="sec-richtext" className="space-y-4">
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
                );
              };

              const renderSectionsBlock = () => {
                if (!hasDistinctSections) return null;

                return (
                  <div key="sec-sections" className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Vorlesungsteile & Module
                      </span>
                      <button
                        type="button"
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
                );
              };

              const renderedBlocks = sectionOrder
                .map((secKey) => {
                  switch (secKey) {
                    case 'folders':
                      return renderFoldersBlock();
                    case 'files':
                      return renderFilesBlock();
                    case 'podcasts':
                      return renderPodcastsBlock();
                    case 'sessions':
                      return renderSessionsBlock();
                    case 'exercises':
                      return renderExercisesBlock();
                    case 'richtext':
                      return renderRichTextBlock();
                    case 'sections':
                      return renderSectionsBlock();
                    default:
                      return null;
                  }
                })
                .filter(Boolean);

              if (renderedBlocks.length === 0) {
                return (
                  <div className="flex h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-center p-6">
                    <Search className="h-6 w-6 text-slate-300 mb-2" />
                    <p className="text-xs font-bold text-slate-700">Keine Materialien vorhanden</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">In diesem Bereich wurden noch keine Materialien gefunden.</p>
                  </div>
                );
              }

              return <div className="space-y-6">{renderedBlocks}</div>;
            })()
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

      {/* Content Section Order Modal */}
      {isOrderModalOpen && (
        <ContentOrderModal
          isOpen={isOrderModalOpen}
          onClose={() => setIsOrderModalOpen(false)}
          order={sectionOrder}
          onSaveOrder={handleSaveSectionOrder}
        />
      )}
    </div>
  );
};

export default CourseView;
