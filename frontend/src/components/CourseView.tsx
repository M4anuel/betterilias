import { t, useLanguage, generatedTitle } from '../lib/i18n';
import React, { useState, useEffect } from 'react';
import {
  Folder,
  FileText,
  Download,
  ExternalLink,
  Search,
  CheckCircle,
  AlertCircle,
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
  Bookmark,
  Files,
  MessageSquare,
} from 'lucide-react';
import { CourseMaterialsResponse, MaterialItem, CourseContentBlock, CourseMembership, MembershipAction, ExerciseTab } from '../types';
import { CourseIcon } from './CourseIcon';
import { CompactBreadcrumbs } from './CompactBreadcrumbs';
import { PodcastModal } from './PodcastModal';
import { CourseManagement } from './CourseManagement';
import { navigationGuard } from '../lib/navigationGuard';
import { SessionDrawer } from './SessionDrawer';
import { ContentOrderModal } from './ContentOrderModal';
import { ExerciseView } from './ExerciseView';
import { api } from '../lib/api';
import { cache, CourseBlocksCustomization } from '../lib/cache';

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

export function cleanRichContentTitle(title?: string | null): string {
  if (!title) return '';
  return title
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/PageTocPH/g, '')
    .replace(/Break(?=\s*<\/|\s*$|\s*<)|\bBreak\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanRichContentHtml(html?: string | null, blockTitle?: string | null, containerRefId?: string | null): string {
  if (!html) return '';
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/PageTocPH/g, '')
    .replace(/Break(?=\s*<\/|\s*$|\s*<)|\bBreak\b/g, '');

  // Safeguard: Preserve pre-resolved video players, or wrap Opencast video containers
  cleaned = cleaned.replace(
    /<div\s+[^>]*class=["'][^"']*ocpc-container[^"']*["'][^>]*>[\s\S]*?<iframe\s+[^>]*src=["']([^"']*)["'][^>]*>[\s\S]*?<\/iframe>[\s\S]*?<\/div>/gi,
    (match, src) => {
      if (match.includes('<video') || match.includes('betterilias-video-player-container')) {
        return match;
      }
      let targetUrl = containerRefId
        ? `https://ilias.unibe.ch/ilias.php?baseClass=ilrepositorygui&cmdNode=yv:oj&cmdClass=ilobjfoldergui&ref_id=${containerRefId}&item_ref_id=0`
        : 'https://ilias.unibe.ch';
      let fullSrc = src;
      if (src.startsWith('http')) fullSrc = src;
      else if (src.startsWith('/')) fullSrc = `https://ilias.unibe.ch${src}`;
      else fullSrc = `https://ilias.unibe.ch/${src}`;

      return `<div class="betterilias-video-player-container my-3" data-video-stream-url="${fullSrc}" style="max-width: 960px;"><div class="betterilias-video-placeholder ocpc-video-card" data-video-url="${fullSrc}"><div class="betterilias-video-inner"><div class="betterilias-video-play-btn"><svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg></div><div class="betterilias-video-info"><span class="betterilias-video-title">${t('video.load_and_play')}</span><span class="betterilias-video-desc">${t('video.opencast_player')}</span></div><a href="${targetUrl}" target="_blank" rel="noreferrer" class="betterilias-video-btn"><span>${t('video.view_on_ilias')}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a></div></div></div>`;
    }
  );

  // Transform and sanitize PDF iframes and embeds: Ensure absolute URL, hide viewer chrome, fit container width
  const pdfParams = 'toolbar=0&navpanes=0&scrollbar=0&pagemode=none&view=FitH';
  const formatPdfUrl = (url: string) => {
    let full = url;
    if (!full.startsWith('http')) {
      full = full.startsWith('/') ? `https://ilias.unibe.ch${full}` : `https://ilias.unibe.ch/${full}`;
    }
    if (!full.includes('#')) {
      return `${full}#${pdfParams}`;
    }
    if (!full.includes('toolbar=')) {
      return `${full}&${pdfParams}`;
    }
    return full;
  };

  cleaned = cleaned.replace(
    /<(iframe|embed)(\s+[^>]*?)src=["']([^"']*\.pdf[^"']*)["']([^>]*)>([\s\S]*?)(?:<\/\1>|(?=\s*<|$))/gi,
    (_match, tag, preAttrs, src, postAttrs, inner) => {
      const fullSrc = formatPdfUrl(src);
      const rawAttrs = `${preAttrs} ${postAttrs}`;
      let combinedClass = 'pdf-embed';
      const classMatch = rawAttrs.match(/class=["']([^"']*)["']/i);
      let cleanedAttrs = rawAttrs;
      if (classMatch) {
        if (!classMatch[1].includes('pdf-embed')) {
          combinedClass = `${classMatch[1]} pdf-embed`.trim();
        } else {
          combinedClass = classMatch[1];
        }
        cleanedAttrs = cleanedAttrs.replace(/class=["'][^"']*["']/i, '');
      }

      const cleanPdfUrl = fullSrc.split('#')[0];
      if (tag.toLowerCase() === 'embed') {
        return `<embed class="${combinedClass}" src="${fullSrc}" data-pdf-src="${cleanPdfUrl}" ${cleanedAttrs.trim()} />`;
      }
      return `<iframe class="${combinedClass}" src="${fullSrc}" data-pdf-src="${cleanPdfUrl}" scrolling="no" frameborder="0" ${cleanedAttrs.trim()}>${inner}</iframe>`;
    }
  );

  cleaned = cleaned.replace(
    /<object(\s+[^>]*?)data=["']([^"']*\.pdf[^"']*)["']([^>]*)>([\s\S]*?)<\/object>/gi,
    (_match, _preAttrs, src) => {
      const fullSrc = formatPdfUrl(src);
      const cleanPdfUrl = fullSrc.split('#')[0];
      return `<iframe class="pdf-embed" src="${fullSrc}" data-pdf-src="${cleanPdfUrl}" scrolling="no" frameborder="0"></iframe>`;
    }
  );

  // Safeguard: Never allow remaining relative iframes to loop into BetterIlias router
  cleaned = cleaned.replace(
    /<iframe\s+[^>]*src=["'](\.[^"']+|\/[^"']*)["'][^>]*>[\s\S]*?<\/iframe>/gi,
    () => {
      return `<div class="p-4 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 text-xs"><span>${t('embedded.ilias_content')}</span><a href="https://ilias.unibe.ch" target="_blank" rel="noreferrer" class="text-sky-600 font-bold hover:underline">${t('embedded.open_in_ilias')}</a></div>`;
    }
  );

  if (blockTitle) {
    const cleanTitle = cleanRichContentTitle(blockTitle);
    if (cleanTitle) {
      const escaped = cleanTitle
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '(?:\\s|&nbsp;|\\xa0)+');
      cleaned = cleaned.replace(
        new RegExp(`^\\s*<h[1-6][^>]*>\\s*(?:${escaped})?\\s*<\\/h[1-6]>`, 'i'),
        ''
      ).trim();
    }
  }
  cleaned = cleaned.replace(/<h[1-6][^>]*>\s*<\/h[1-6]>/gi, '').trim();
  if (cleaned.includes('<table') || cleaned.includes('pdf-embed')) {
    const document = new DOMParser().parseFromString(cleaned, 'text/html');
    document.querySelectorAll('table').forEach(table => {
      const wrapper = document.createElement('div');
      wrapper.className = 'ilc_table_StandardTable_wrapper';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', t('media.scroll_table'));
      table.before(wrapper);
      wrapper.append(table);
    });
    document.querySelectorAll<HTMLElement>('[data-pdf-src]').forEach(pdf => {
      const href = pdf.dataset.pdfSrc;
      if (!href || !/^https?:\/\//i.test(href)) return;
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.className = 'inline-flex items-center py-2 text-sm font-semibold';
      link.textContent = t('media.open_pdf');
      pdf.after(link);
    });
    cleaned = document.body.innerHTML;
  }
  return cleaned;
}

interface CourseViewProps {
  managementMode: boolean;
  onManagementModeChange: (enabled: boolean) => void;
  courseRefId: string;
  courseNickname: string;
  materialsData: CourseMaterialsResponse | null;
  membership?: CourseMembership;
  onManageMembership: (action: MembershipAction) => void;
  onNavigateFolder: (folderRefId: string) => void;
  onNavigateHome: () => void;
  onNavigateRepository: (refId: string) => void;
  onNavigateSemester?: (semester: string) => void;
  onNavigateCourseRoot: (courseRefId: string) => void;
  isRevalidating: boolean;
  onManualRefresh: () => void;
  onNotifyChange?: (notifications: any[]) => void;
  loadError?: string | null;
  activeExerciseRefId?: string | null;
  activeExerciseTab?: ExerciseTab | null;
  onSelectExercise?: (exerciseRefId: string | null) => void;
  onExerciseTabChange?: (tab: ExerciseTab) => void;
}

export const CourseView: React.FC<CourseViewProps> = ({
  managementMode: isManaging,
  onManagementModeChange: setIsManaging,
  courseRefId,
  courseNickname,
  materialsData,
  membership,
  onManageMembership,
  onNavigateFolder,
  onNavigateHome,
  onNavigateRepository,
  onNavigateSemester,
  onNavigateCourseRoot,
  isRevalidating,
  onManualRefresh,
  onNotifyChange,
  loadError,
  activeExerciseRefId: controlledExerciseRefId,
  activeExerciseTab,
  onSelectExercise,
  onExerciseTabChange,
}) => {
  const language = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedDrawers, setCollapsedDrawers] = useState<Record<string, boolean>>(() =>
    cache.getCourseDrawersState(courseRefId)
  );

  useEffect(() => {
    setCollapsedDrawers(cache.getCourseDrawersState(courseRefId));
  }, [courseRefId]);
  const [activePodcast, setActivePodcast] = useState<{ refId: string; title: string } | null>(null);
  const [internalExerciseRefId, setInternalExerciseRefId] = useState<string | null>(null);
  const activeExerciseRefId =
    controlledExerciseRefId !== undefined ? controlledExerciseRefId : internalExerciseRefId;
  const setActiveExerciseRefId = (id: string | null) => {
    if (onSelectExercise) {
      onSelectExercise(id);
    } else {
      setInternalExerciseRefId(id);
    }
  };
  const [subfolderMaterials, setSubfolderMaterials] = useState<
    Record<string, { materials: CourseMaterialsResponse; path: string[] }>
  >({});
  const [folderStats, setFolderStats] = useState<
    Record<string, { total: number; files: number; folders: number; isMapped: boolean; isEmpty: boolean }>
  >({});
  const [isScanningTree, setIsScanningTree] = useState(false);
  const [searchCategoryFilter, setSearchCategoryFilter] = useState<'all' | 'file' | 'fold' | 'mcst' | 'exc'>('all');
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);

  // Dynamically inspect embedded PDFs to adapt to any weird aspect ratio and handle scrolling
  useEffect(() => {
    const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe.pdf-embed[data-pdf-src]');
    iframes.forEach(async (iframe) => {
      const src = iframe.getAttribute('data-pdf-src');
      if (!src) return;
      const cacheKey = `pdf_aspect_${src}`;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.aspect_ratio) {
            iframe.style.aspectRatio = `${parsed.aspect_ratio}`;
          }
          if (parsed.pages > 1) {
            iframe.setAttribute('scrolling', 'auto');
            iframe.style.overflow = 'auto';
          } else {
            iframe.setAttribute('scrolling', 'no');
            iframe.style.overflow = 'hidden';
          }
          return;
        } catch {
          // ignore
        }
      }
      try {
        const info = await api.getPdfInfo(src);
        if (info && info.aspect_ratio) {
          iframe.style.aspectRatio = `${info.aspect_ratio}`;
          if (info.pages > 1) {
            iframe.setAttribute('scrolling', 'auto');
            iframe.style.overflow = 'auto';
          } else {
            iframe.setAttribute('scrolling', 'no');
            iframe.style.overflow = 'hidden';
          }
          sessionStorage.setItem(cacheKey, JSON.stringify(info));
        }
      } catch {
        // default remains
      }
    });
  }, [materialsData]);

  // Per-course dynamic blocks customization & ordering
  const [blockOrder, setBlockOrder] = useState<string[]>(() => {
    const saved = cache.getCourseBlocksCustomization(courseRefId);
    return saved?.blockOrder || [];
  });
  const [hiddenBlockIds, setHiddenBlockIds] = useState<string[]>(() => {
    const saved = cache.getCourseBlocksCustomization(courseRefId);
    return saved?.hiddenBlockIds || [];
  });
  const [showAllFilesBlock, setShowAllFilesBlock] = useState<boolean>(() => {
    const saved = cache.getCourseBlocksCustomization(courseRefId);
    return !!saved?.showAllFilesBlock;
  });

  // Check ILIAS layout change and reset if hash mismatch
  useEffect(() => {
    if (!materialsData) return;
    const currentHash = materialsData.layout_hash || '';
    const saved = cache.getCourseBlocksCustomization(courseRefId);

    if (saved) {
      if (currentHash && saved.layoutHash && saved.layoutHash !== currentHash) {
        // ILIAS layout changed on server (blocks added/renamed/moved); auto-reset to ILIAS default
        cache.clearCourseBlocksCustomization(courseRefId);
        setBlockOrder((materialsData.blocks || []).map((b) => b.id));
        setHiddenBlockIds([]);
        setShowAllFilesBlock(false);
      } else {
        setBlockOrder(saved.blockOrder || (materialsData.blocks || []).map((b) => b.id));
        setHiddenBlockIds(saved.hiddenBlockIds || []);
        setShowAllFilesBlock(!!saved.showAllFilesBlock);
      }
    } else {
      setBlockOrder((materialsData.blocks || []).map((b) => b.id));
      setHiddenBlockIds([]);
      setShowAllFilesBlock(false);
    }
  }, [courseRefId, materialsData?.layout_hash]);

  const handleSaveBlockOrder = (newOrder: string[]) => {
    setBlockOrder(newOrder);
    cache.setCourseBlocksCustomization(courseRefId, {
      layoutHash: materialsData?.layout_hash || '',
      blockOrder: newOrder,
      hiddenBlockIds,
      showAllFilesBlock,
    });
  };

  const handleToggleHideBlock = (blockId: string) => {
    const next = hiddenBlockIds.includes(blockId)
      ? hiddenBlockIds.filter((id) => id !== blockId)
      : [...hiddenBlockIds, blockId];
    setHiddenBlockIds(next);
    cache.setCourseBlocksCustomization(courseRefId, {
      layoutHash: materialsData?.layout_hash || '',
      blockOrder,
      hiddenBlockIds: next,
      showAllFilesBlock,
    });
  };

  const handleToggleShowAllFiles = (show: boolean) => {
    setShowAllFilesBlock(show);
    cache.setCourseBlocksCustomization(courseRefId, {
      layoutHash: materialsData?.layout_hash || '',
      blockOrder,
      hiddenBlockIds,
      showAllFilesBlock: show,
    });
  };

  const handleResetBlocksToDefault = () => {
    const defaultOrder = (materialsData?.blocks || []).map((b) => b.id);
    setBlockOrder(defaultOrder);
    setHiddenBlockIds([]);
    setShowAllFilesBlock(false);
    cache.clearCourseBlocksCustomization(courseRefId);
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
    const seen = new Set<string>();
    let files = 0;
    let folders = 0;

    const processItem = (item: MaterialItem) => {
      const id = item?.ref_id || item?.url || item?.title;
      if (!id || seen.has(id)) return;
      seen.add(id);
      if (item.item_type === 'fold') {
        folders++;
      } else {
        files++;
      }
    };

    for (const item of res.items || []) {
      processItem(item);
    }
    for (const sec of res.sections || []) {
      for (const grp of sec.groups || []) {
        for (const item of grp.items || []) {
          processItem(item);
        }
      }
      for (const item of sec.items || []) {
        processItem(item);
      }
    }

    const total = files + folders;
    return { files, folders, total };
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

  // Predictive pre-fetching of management data for TAs/instructors (when ILIAS Saver is OFF)
  useEffect(() => {
    if (isManaging) return;
    const auth = materialsData?.authoring;
    if (!auth || (!auth.can_create && !auth.can_manage && !auth.can_edit_page)) return;
    if (cache.getIliasSaverEnabled()) return; // When ILIAS Saver is ON, management is only fetched on explicit click

    const containerId = materialsData.container_ref_id || auth.ref_id;
    if (!containerId) return;

    const cached = cache.getCachedManagement(containerId);
    const ts = cache.getCacheTimestamp(`ilias_management_${containerId}`);
    if (cached && ts && Date.now() - ts < 60_000) return;

    api.getManagement(containerId).then((res) => {
      cache.setCachedManagement(containerId, res);
    }).catch(() => {});
  }, [materialsData, isManaging]);

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
          } catch (e: any) {
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
            const errMsg = String(e?.message || '');
            if (
              errMsg.includes('SESSION_EXPIRED') ||
              errMsg.includes('401') ||
              errMsg.toLowerCase().includes('session expired') ||
              errMsg.toLowerCase().includes('unauthorized')
            ) {
              break;
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

  const toggleDrawer = (drawerId: string) => {
    setCollapsedDrawers((prev) => {
      const isCurrentlyCollapsed = !!prev[drawerId];
      const next = {
        ...prev,
        [drawerId]: !isCurrentlyCollapsed,
      };
      cache.setCourseDrawersState(courseRefId, next);
      return next;
    });
    setTimeout(() => {
      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise().catch(() => {});
      }
    }, 50);
  };


  const countTotalItemsInBlock = (b: CourseContentBlock): number => {
    let count = b.items?.length || 0;
    if (b.sessions?.length) count += b.sessions.length;
    if (b.child_blocks) {
      for (const cb of b.child_blocks) {
        count += countTotalItemsInBlock(cb);
      }
    }
    return count;
  };

  // Collect all files in the course for the virtual "All Files" block
  const allCourseFiles = React.useMemo(() => {
    if (!materialsData) return [];
    const files: MaterialItem[] = [];
    const seen = new Set<string>();

    const addFile = (item: MaterialItem) => {
      if (item.item_type === 'file' && !seen.has(item.ref_id)) {
        seen.add(item.ref_id);
        files.push(item);
      }
    };

    for (const item of materialsData.items || []) {
      addFile(item);
    }
    for (const sec of materialsData.sections || []) {
      for (const grp of sec.groups || []) {
        for (const item of grp.items || []) {
          addFile(item);
        }
      }
    }
    const collectFromBlocks = (blist: CourseContentBlock[]) => {
      for (const b of blist) {
        for (const it of b.items || []) {
          addFile(it);
        }
        if (b.child_blocks) collectFromBlocks(b.child_blocks);
      }
    };
    collectFromBlocks(materialsData.blocks || []);
    return files;
  }, [materialsData]);

  // Construct available blocks (including virtual all-files block if enabled)
  const rawBlocks = React.useMemo(() => {
    const localise = (block: CourseContentBlock): CourseContentBlock => ({
      ...block, title: generatedTitle(block), child_blocks: block.child_blocks?.map(localise),
    });
    return (materialsData?.blocks || []).map(localise);
  }, [materialsData?.blocks, language]);
  const availableBlocks: CourseContentBlock[] = React.useMemo(() => {
    if (!materialsData) return [];
    if (!showAllFilesBlock) return rawBlocks;
    const virtualBlock: CourseContentBlock = {
      id: 'block-all-files',
      block_type: 'all_files',
      title: t("Alle Dateien des Kurses"),
      items: allCourseFiles,
      level: 1,
      child_blocks: [],
      sessions: [],
    };
    return [...rawBlocks, virtualBlock];
  }, [materialsData, rawBlocks, showAllFilesBlock, allCourseFiles, language]);

  // Map of blocks by id for ordered rendering
  const orderedBlocksToRender: CourseContentBlock[] = React.useMemo(() => {
    if (!materialsData) return [];
    const blockMap = new Map<string, CourseContentBlock>();
    for (const b of availableBlocks) {
      blockMap.set(b.id, b);
    }

    const ordered: CourseContentBlock[] = [];
    const seenIds = new Set<string>();

    // 1. Follow blockOrder
    for (const id of blockOrder) {
      const b = blockMap.get(id);
      if (b && !seenIds.has(id)) {
        if (!hiddenBlockIds.includes(id)) {
          ordered.push(b);
        }
        seenIds.add(id);
      }
    }

    // 2. Append any blocks from availableBlocks not yet ordered
    for (const b of availableBlocks) {
      if (!seenIds.has(b.id)) {
        if (!hiddenBlockIds.includes(b.id)) {
          ordered.push(b);
        }
        seenIds.add(b.id);
      }
    }

    return ordered;
  }, [materialsData, availableBlocks, blockOrder, hiddenBlockIds]);

  if (!materialsData) {
    if (loadError) {
      return (
        <div className="flex h-96 flex-col items-center justify-center p-8 text-center animate-in fade-in duration-200">
          <div className="rounded-2xl border border-red-200 dark:border-red-950/60 bg-white dark:bg-slate-900 p-6 shadow-xs max-w-md space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 mx-auto">
              <RefreshCw className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">{t("Vorlesungsinhalte konnten nicht geladen werden")}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{loadError}</p>
            <button
              type="button"
              onClick={onManualRefresh}
              style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white hover:opacity-90 transition cursor-pointer shadow-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>{t("Erneut versuchen")}</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-96 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
          <div
            className="h-7 w-7 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: 'var(--accent, #0AACA5)', borderTopColor: 'transparent' }}
          />
          <p className="text-xs font-semibold">{t("Lade Vorlesungsinhalte...")}</p>
        </div>
      </div>
    );
  }

  if (activeExerciseRefId) {
    return (
      <ExerciseView
        exerciseRefId={activeExerciseRefId}
        courseNickname={courseNickname}
        courseRefId={courseRefId}
        courseBreadcrumbs={materialsData?.breadcrumbs || []}
        activeTabProp={activeExerciseTab}
        onTabChange={onExerciseTabChange}
        onBack={() => setActiveExerciseRefId(null)}
        onNavigateHome={onNavigateHome}
        onNavigateCourse={(ref) => {
          onNavigateCourseRoot(ref);
          setActiveExerciseRefId(null);
        }}
        onNavigateFolder={(folderRefId) => {
          onNavigateFolder(folderRefId);
          setActiveExerciseRefId(null);
        }}
        onNavigateRepository={onNavigateRepository}
        onNavigateSemester={onNavigateSemester}
        onNotifyChange={onNotifyChange}
      />
    );
  }

  const isInsideSubfolder = !!materialsData && materialsData.container_ref_id !== courseRefId;
  const sections = materialsData?.sections || [];
  const richTextBlocks = materialsData?.rich_text_blocks || [];
  const sessions = materialsData?.sessions || [];
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

  const filteredFlatItems = (materialsData?.items || []).filter(matchesSearch);

  // Comprehensive repository search across current view + all subfolders
  const searchResults: CourseSearchResult[] = [];
  if (materialsData && searchQuery.trim().length > 0) {
    const q = searchQuery.toLowerCase().trim();
    const seenItemRefIds = new Set<string>();

    const itemMatches = (item: MaterialItem) =>
      item.title.toLowerCase().includes(q) ||
      (!!item.description && item.description.toLowerCase().includes(q));

    const currentTitle = materialsData.title || courseNickname || t("Hauptordner");

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
      const folderTitle = entry.materials.title || entry.path[entry.path.length - 1] || t("Unterordner");

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
      return (
        r.item.item_type === 'exc' ||
        r.item.url.toLowerCase().includes('ilexercise') ||
        r.item.url.toLowerCase().includes('/go/exc/')
      );
    return true;
  });

  const searchFileCount = searchResults.filter((r) => r.item.item_type === 'file').length;
  const searchFoldCount = searchResults.filter((r) => r.item.item_type === 'fold').length;
  const searchMcstCount = searchResults.filter(
    (r) => r.item.item_type === 'mcst' || r.item.title.toLowerCase().includes('podcast')
  ).length;
  const searchExcCount = searchResults.filter(
    (r) =>
      r.item.item_type === 'exc' ||
      r.item.url.toLowerCase().includes('ilexercise') ||
      r.item.url.toLowerCase().includes('/go/exc/')
  ).length;

  const renderSearchResultRow = (result: CourseSearchResult) => {
    const { item, containerRefId, breadcrumbs, isSubfolderItem } = result;
    const isFile = item.item_type === 'file';
    const isFolder = item.item_type === 'fold';
    const isPodcast =
      !isFile &&
      (item.item_type === 'mcst' ||
        item.url.toLowerCase().includes('xoct') ||
        item.url.toLowerCase().includes('/go/mcst/'));
    const isExercise =
      !isFile &&
      !isFolder &&
      (item.item_type === 'exc' ||
        item.url.toLowerCase().includes('ilexercise') ||
        item.url.toLowerCase().includes('ilobjexercisegui') ||
        item.url.toLowerCase().includes('/go/exc/'));
    const downloadUrl = isFile ? api.getDownloadUrl(item.ref_id, item.download_url) : null;

    return (
      <div
        key={`${containerRefId}_${item.ref_id}`}
        className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition gap-3"
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="mt-0.5">{getItemIcon(item)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                {item.title}
              </span>
              {item.file_size && (
                <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  {item.file_size}
                </span>
              )}
            </div>
            {item.description && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 line-clamp-1 mt-0.5">
                {item.description}
              </p>
            )}
            {/* Breadcrumbs / Location Badge */}
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100/90 dark:bg-slate-800 px-2 py-0.5 rounded-md w-fit mt-1.5 border border-slate-200/50 dark:border-slate-700/50">
              <Folder className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="font-semibold text-slate-600 dark:text-slate-300 truncate max-w-md">
                {breadcrumbs.join(' › ') || t("Hauptordner")}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {isSubfolderItem && (
            <button
              type="button"
              onClick={() => onNavigateFolder(containerRefId)}
              className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition shadow-2xs"
              title={t("Zu diesem Ordner navigieren")}
            >
              <Folder className="h-3 w-3 text-amber-500" />
              <span>{t("In Ordner anzeigen")}</span>
            </button>
          )}

          {isFolder ? (
            <button
              type="button"
              onClick={() => onNavigateFolder(item.ref_id)}
              className="flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 text-xs font-semibold transition shadow-2xs"
            >
              <span>{t("Öffnen")}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          ) : isPodcast ? (
            <button
              type="button"
              onClick={() => setActivePodcast({ refId: item.ref_id, title: item.title })}
              className="flex items-center gap-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white px-2.5 py-1 text-xs font-semibold transition shadow-2xs"
            >
              <Play className="h-3 w-3" />
              <span>{t("Aufzeichnungen")}</span>
            </button>
          ) : isExercise ? (
            <button
              type="button"
              onClick={() => setActiveExerciseRefId(item.ref_id)}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 text-xs font-semibold transition shadow-2xs cursor-pointer"
            >
              <Layers className="h-3 w-3" />
              <span>{t("Übungen")}</span>
            </button>
          ) : isFile && downloadUrl ? (
            <a
              href={downloadUrl}
              download
              style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
              className="flex items-center gap-1 rounded-lg text-white px-2.5 py-1 text-xs font-semibold hover:opacity-90 transition shadow-2xs"
            >
              <Download className="h-3 w-3" />
              <span>{t("Download")}</span>
            </a>
          ) : (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-1 text-xs font-semibold transition shadow-2xs"
            >
              <span>{t("ILIAS")}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    );
  };

  const getItemIcon = (item: MaterialItem) => {
    if (item.item_type === 'fold') return <Folder className="h-4 w-4 text-amber-500 fill-amber-50 dark:fill-amber-950/40 shrink-0" />;
    if (item.item_type === 'file') return <FileText className="h-4 w-4 text-teal-600 fill-teal-50 dark:fill-teal-950/40 shrink-0" />;
    if (item.item_type === 'exc') return <Layers className="h-4 w-4 text-indigo-500 shrink-0" />;
    if (item.item_type === 'mcst') return <Radio className="h-4 w-4 text-sky-500 shrink-0" />;
    if (item.item_type === 'sess') return <Calendar className="h-4 w-4 text-emerald-500 shrink-0" />;
    if (item.item_type === 'voting' || item.title.toLowerCase().includes('voting') || item.url.includes('xlvo')) {
      return <Vote className="h-4 w-4 text-purple-500 shrink-0" />;
    }
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

  // Interactive handler for ILIAS Page Editor vertical accordions (.ilc_va_cntr_VAccordCntr) and video cards
  const handleRichContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Handle Opencast video placeholder clicks & in-place playback
    const videoBtn = target.closest<HTMLElement>('.betterilias-video-btn, a[href*="ilias.unibe.ch"]');
    if (videoBtn) {
      // Allow default link behavior to open ILIAS
      return;
    }
    const videoCard = target.closest<HTMLElement>('.betterilias-video-placeholder, .ocpc-video-card, [data-video-stream-url]');
    if (videoCard) {
      e.preventDefault();
      const streamUrl = videoCard.getAttribute('data-video-stream-url') || videoCard.getAttribute('data-video-url');
      if (streamUrl) {
        const container = videoCard.closest<HTMLElement>('.betterilias-video-player-container') || videoCard;
        const titleSpan = videoCard.querySelector('.betterilias-video-title');
        if (titleSpan) titleSpan.textContent = t('video.loading');

        fetch(`/api/courses/video-stream-info?url=${encodeURIComponent(streamUrl)}`)
          .then((res) => res.json())
          .then((data) => {
            if (data && data.mp4_url) {
              const posterAttr = data.preview_url ? `poster="${data.preview_url}"` : '';
              const durStr = data.duration
                ? `${Math.floor(data.duration / 60).toString().padStart(2, '0')}:${(data.duration % 60).toString().padStart(2, '0')}`
                : '';
              const titleText = data.title ? (durStr ? `${data.title} (${durStr})` : data.title) : t('video.tutorial');
              container.innerHTML = `
                <video controls autoplay playsinline preload="auto" ${posterAttr} class="w-full aspect-video rounded-xl bg-black shadow-md border border-slate-800">
                  <source src="${data.mp4_url}" type="video/mp4" />
                  ${t('video.unsupported')}
                </video>
                <div class="betterilias-video-caption flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mt-2 px-1">
                  <span class="font-medium truncate">${titleText}</span>
                  <a href="${data.fallback_url || 'https://ilias.unibe.ch'}" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-sky-600 hover:text-sky-500 font-semibold hover:underline shrink-0">
                    <span>${t('video.view_on_ilias')}</span>
                    <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                  </a>
                </div>
              `;
            } else if (data && data.fallback_url) {
              window.open(data.fallback_url, '_blank', 'noreferrer');
            }
          })
          .catch(() => {
            if (streamUrl) window.open(streamUrl, '_blank', 'noreferrer');
          });
        return;
      }
    }
    const toggleBtn = target.closest<HTMLElement>(
      '.ilc_va_ihead_VAccordIHeadDezent, .ilc_va_ihead_VAccordIHeadDef, .il_VAccordionToggleDef [role="button"], .il_VAccordionToggleDef'
    );
    if (!toggleBtn) return;

    e.preventDefault();
    const accordionItem = toggleBtn.closest('.ilc_va_icntr_VAccordICntr');
    if (!accordionItem) return;

    const content = accordionItem.querySelector('.il_VAccordionContentDef');
    if (!content) return;

    const headBtn = accordionItem.querySelector<HTMLElement>('[role="button"]') || toggleBtn;
    const isExpanded = headBtn.getAttribute('aria-expanded') === 'true';

    headBtn.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
    if (isExpanded) {
      content.classList.add('ilAccHideContent');
    } else {
      content.classList.remove('ilAccHideContent');
    }
  };

  // Render a rich tile card for courses with tile layout (e.g. Programming with R)
  const renderTileItemCard = (item: MaterialItem) => {
    const isFile = item.item_type === 'file';
    const isFolder = item.item_type === 'fold';
    const isPodcast =
      !isFile &&
      (item.item_type === 'mcst' ||
        item.url.toLowerCase().includes('xoct') ||
        item.url.toLowerCase().includes('/go/mcst/'));
    const isExercise =
      !isFile &&
      !isFolder &&
      (item.item_type === 'exc' ||
        item.url.toLowerCase().includes('ilexercise') ||
        item.url.toLowerCase().includes('ilobjexercisegui') ||
        item.url.toLowerCase().includes('/go/exc/'));
    const downloadUrl = isFile ? api.getDownloadUrl(item.ref_id, item.download_url) : null;
    const stat = isFolder ? folderStats[item.ref_id] : null;

    const handleTileClick = () => {
      if (isFolder) {
        onNavigateFolder(item.ref_id);
      } else if (isPodcast) {
        setActivePodcast({ refId: item.ref_id, title: item.title });
      } else if (isExercise) {
        setActiveExerciseRefId(item.ref_id);
      } else if (isFile && downloadUrl) {
        window.open(downloadUrl, '_blank');
      } else if (item.url) {
        window.open(item.url, '_blank', 'noreferrer');
      }
    };

    return (
      <div
        key={item.ref_id || item.url || item.title}
        onClick={handleTileClick}
        className="group flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs hover:shadow-md hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 transition cursor-pointer select-none"
      >
        {/* Cover Image or Visual Header */}
        {item.image_url ? (
          <div className="relative aspect-16/10 w-full overflow-hidden bg-slate-100 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-800">
            <img
              src={item.image_url}
              alt={item.title}
              className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        ) : (
          <div className="relative aspect-16/10 w-full flex items-center justify-center bg-linear-to-br from-slate-50 to-slate-100 dark:from-slate-800/80 dark:to-slate-850 border-b border-slate-100 dark:border-slate-800">
            {getItemIcon(item)}
          </div>
        )}

        {/* Card Content Body */}
        <div className="p-3.5 flex flex-col justify-between flex-1 gap-2.5">
          <div>
            <h4
              className="text-xs sm:text-sm font-bold text-slate-800 group-hover:text-amber-800 dark:text-slate-100 dark:group-hover:text-amber-300 transition line-clamp-2"
              title={item.title}
            >
              {item.title}
            </h4>
            {item.description && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                {item.description}
              </p>
            )}
          </div>

          {/* Footer Metadata & Action */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1.5 truncate">
              {getItemIcon(item)}
              {isFolder && stat?.isMapped ? (
                stat.isEmpty ? (
                  <span>{t("Leer")}</span>
                ) : (
                  <span>
                    {stat.files > 0 && stat.folders > 0
                      ? `${stat.files} ${stat.files === 1 ? t("Datei") : t("Dateien")}, ${stat.folders} ${stat.folders === 1 ? t("Ordner") : t("Ordner")}`
                      : stat.files > 0
                      ? `${stat.files} ${stat.files === 1 ? t("Datei") : t("Dateien")}`
                      : `${stat.folders} ${stat.folders === 1 ? t("Ordner") : t("Ordner")}`}
                  </span>
                )
              ) : item.file_size ? (
                <span className="font-mono">{item.file_size}</span>
              ) : (
                <span className="capitalize">{item.item_type || 'Element'}</span>
              )}
            </div>

            <span className="font-semibold text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition shrink-0">
              {isFolder ? 'Öffnen →' : isPodcast ? 'Aufnahmen' : isExercise ? 'Übungen' : isFile ? 'Download' : 'Öffnen'}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Render a single material item row
  const renderItemRow = (item: MaterialItem) => {
    const isFile = item.item_type === 'file';
    const isFolder = item.item_type === 'fold';
    const isPodcast =
      !isFile &&
      (item.item_type === 'mcst' ||
        item.url.toLowerCase().includes('xoct') ||
        item.url.toLowerCase().includes('/go/mcst/'));
    const isExercise =
      !isFile &&
      !isFolder &&
      (item.item_type === 'exc' ||
        item.url.toLowerCase().includes('ilexercise') ||
        item.url.toLowerCase().includes('ilobjexercisegui') ||
        item.url.toLowerCase().includes('/go/exc/'));
    const isVoting =
      item.item_type === 'voting' ||
      item.title.toLowerCase().includes('voting') ||
      item.url.toLowerCase().includes('xlvo');
    const downloadUrl = isFile ? api.getDownloadUrl(item.ref_id, item.download_url) : null;

    if (isFolder) {
      const stat = folderStats[item.ref_id];
      return (
        <div
          key={item.ref_id}
          onClick={() => onNavigateFolder(item.ref_id)}
          className="flex items-center justify-between p-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition rounded-xl border border-transparent hover:border-amber-200 dark:hover:border-amber-800/60 cursor-pointer group"
        >
          <div className="flex items-center gap-3 truncate pr-2">
            {item.image_url ? (
              <img
                src={item.image_url}
                alt=""
                className="h-8 w-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0 group-hover:scale-105 transition"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 shrink-0 group-hover:scale-105 transition">
                <Folder className="h-4 w-4 fill-amber-100 dark:fill-amber-950/60" />
              </div>
            )}
            <div className="truncate">
              <span className="text-xs font-bold text-slate-800 group-hover:text-amber-800 dark:text-slate-100 dark:group-hover:text-amber-300 transition block truncate">
                {item.title}
              </span>
              {item.description && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate block">{item.description}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {stat ? (
              stat.isMapped ? (
                stat.isEmpty ? (
                  <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                    {t("Leer")}
                  </span>
                ) : (
                  <span className="rounded-md bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/50">
                    {stat.files > 0 && stat.folders > 0
                      ? `${stat.files} ${stat.files === 1 ? t("Datei") : t("Dateien")}, ${stat.folders} ${stat.folders === 1 ? t("Ordner") : t("Ordner")}`
                      : stat.files > 0
                      ? `${stat.files} ${stat.files === 1 ? t("Datei") : t("Dateien")}`
                      : `${stat.folders} ${stat.folders === 1 ? t("Ordner") : t("Ordner")}`}
                  </span>
                )
              ) : null
            ) : isScanningTree ? (
              <span className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                <RefreshCw className="h-2.5 w-2.5 animate-spin text-slate-400" />
              </span>
            ) : null}
            <span className="text-[11px] font-semibold text-slate-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition shrink-0">
              {t("Öffnen →")}
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
          className="flex items-center justify-between p-3 hover:bg-sky-50/70 dark:hover:bg-sky-950/40 transition rounded-xl border border-transparent hover:border-sky-200 dark:hover:border-sky-800/60 cursor-pointer group gap-3"
        >
          <div className="flex items-center gap-3 truncate">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 shrink-0 group-hover:scale-105 transition">
              <Radio className="h-4 w-4" />
            </div>
            <div className="truncate">
              <span className="text-xs font-bold text-slate-800 group-hover:text-sky-800 dark:text-slate-100 dark:group-hover:text-sky-300 transition block truncate">
                {item.title}
              </span>
              <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium block truncate">
                {item.description || t("Opencast Vorlesungsaufzeichnungen ansehen")}
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
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-700 transition shadow-2xs cursor-pointer"
            >
              <Play className="h-3 w-3 fill-white" />
              <span>{t("Aufnahmen")}</span>
            </button>
          </div>
        </div>
      );
    }

    if (isExercise) {
      return (
        <div
          key={item.ref_id}
          onClick={() => setActiveExerciseRefId(item.ref_id)}
          className="flex items-center justify-between p-3 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 transition rounded-xl border border-transparent hover:border-indigo-200 dark:hover:border-indigo-800/60 cursor-pointer group gap-3"
        >
          <div className="flex items-center gap-3 truncate">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 shrink-0 group-hover:scale-105 transition">
              <Layers className="h-4 w-4" />
            </div>
            <div className="truncate">
              <span className="text-xs font-bold text-slate-800 group-hover:text-indigo-800 dark:text-slate-100 dark:group-hover:text-indigo-300 transition block truncate">
                {item.title}
              </span>
              <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium block truncate">
                {item.description || t("Übungsblätter, Abgaben & Bewertungen verwalten")}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveExerciseRefId(item.ref_id);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700 transition shadow-2xs cursor-pointer"
            >
              <Layers className="h-3 w-3" />
              <span>{t("Öffnen")}</span>
            </button>
          </div>
        </div>
      );
    }

    if (isVoting) {
      return (
        <div
          key={item.ref_id}
          className="flex items-center justify-between p-3 hover:bg-purple-50/70 dark:hover:bg-purple-950/40 transition rounded-xl border border-transparent hover:border-purple-200 dark:hover:border-purple-800/60 group gap-3"
        >
          <div className="flex items-center gap-3 truncate">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 shrink-0 group-hover:scale-105 transition">
              <Vote className="h-4 w-4" />
            </div>
            <div className="truncate">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-slate-800 group-hover:text-purple-800 dark:text-slate-100 dark:group-hover:text-purple-300 transition block truncate"
                title={item.title}
              >
                {item.title}
              </a>
              <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium block truncate">
                {item.description || t("ILIAS Live Voting")}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-purple-700 transition shadow-2xs"
            >
              <Vote className="h-3 w-3" />
              <span>{t("Live Voting")}</span>
              <ExternalLink className="h-3 w-3 opacity-80" />
            </a>
          </div>
        </div>
      );
    }

    return (
      <div
        key={item.ref_id}
        className="flex items-center justify-between p-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-slate-700 gap-3"
      >
        <div className="flex items-center gap-3 truncate">
          {item.image_url ? (
            <img
              src={item.image_url}
              alt=""
              className="h-8 w-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
              {getItemIcon(item)}
            </div>
          )}
          <div className="truncate">
            {isFile && downloadUrl ? (
              <a
                href={downloadUrl}
                download
                className="text-xs font-bold text-slate-900 dark:text-slate-100 hover:text-[var(--accent)] dark:hover:text-[var(--accent)] transition block truncate"
                title={item.title}
              >
                {item.title}
              </a>
            ) : (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-slate-900 dark:text-slate-100 hover:text-[var(--accent)] dark:hover:text-[var(--accent)] transition block truncate"
                title={item.title}
              >
                {item.title}
              </a>
            )}
            {item.description && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">{item.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {item.file_size && (
            <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-mono font-medium text-slate-600 dark:text-slate-400">
              {item.file_size}
            </span>
          )}
          {isFile && downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-[var(--accent)] hover:text-white transition shadow-2xs"
            >
              <Download className="h-3 w-3" />
              <span>{t("Download")}</span>
            </a>
          ) : (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition shadow-2xs"
            >
              <span>{t("ILIAS")}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    );
  };

    const renderDrawerBlock = (block: CourseContentBlock): React.ReactNode => {
    const isCollapsed = !!collapsedDrawers[block.id];
    const totalCount = countTotalItemsInBlock(block);

    return (
      <div
        key={block.id}
        className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden transition dark:border-slate-800 dark:bg-slate-900"
      >
        <button
          type="button"
          onClick={() => toggleDrawer(block.id)}
          className="flex w-full items-center justify-between p-3.5 bg-slate-50/70 hover:bg-slate-100/60 dark:bg-slate-800/70 dark:hover:bg-slate-800 transition text-left select-none cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <ChevronDown
              className={`h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform duration-200 ${
                isCollapsed ? '-rotate-90' : 'rotate-0'
              }`}
            />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {block.title || t("Schublade")}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <span className="rounded-full bg-slate-200/60 dark:bg-slate-700/60 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                {totalCount}
              </span>
            )}
          </div>
        </button>

        {!isCollapsed && (
          <div className="p-4 space-y-4 border-t border-slate-100 dark:border-slate-800">
            {block.html_content && (
              <div
                onClick={handleRichContentClick}
                className="ilias-rich-content text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-sans rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5"
                dangerouslySetInnerHTML={{ __html: cleanRichContentHtml(block.html_content, block.title, materialsData?.container_ref_id || courseRefId) }}
              />
            )}

            {block.child_blocks && block.child_blocks.length > 0 && (
              <div className="space-y-4">
                {block.child_blocks.map(renderBlock)}
              </div>
            )}

            {block.items && block.items.length > 0 && (
              block.presentation === 'tiles' || block.items.some((it) => !!it.image_url) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                  {block.items.map(renderTileItemCard)}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-100 divide-y divide-slate-100 bg-white shadow-2xs overflow-hidden dark:border-slate-800 dark:divide-slate-800 dark:bg-slate-900">
                  {block.items.map(renderItemRow)}
                </div>
              )
            )}

            {block.sessions && block.sessions.length > 0 && (
              <SessionDrawer sessions={block.sessions} courseRefId={courseRefId} />
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTextBlock = (block: CourseContentBlock): React.ReactNode => {
    const cleanTitle = cleanRichContentTitle(block.title);
    const cleanedHtml = cleanRichContentHtml(block.html_content, cleanTitle || block.title, materialsData?.container_ref_id || courseRefId);
    const cleanedPlain = (block.plain_text || '')
      .replace(/PageTocPH/g, '')
      .replace(/Break(?=\s*<\/|\s*$|\s*<)|\bBreak\b/g, '')
      .trim();

    if (!cleanedHtml && !cleanedPlain && !cleanTitle) return null;

    // Detect section divider headings (e.g. "Informationen zur Lehrveranstaltung", "Zusätzliches Lernangebot", "Materialien")
    const isDividerHeading =
      (block.html_content?.includes('ilc_text_inline_Accent') ||
        block.html_content?.includes('ilc_strong_Strong') ||
        block.html_content?.includes('ilc_heading')) &&
      cleanedPlain.length < 90 &&
      !cleanedHtml.includes('<table') &&
      !cleanedHtml.includes('<iframe') &&
      !cleanedHtml.includes('<ul') &&
      !cleanedHtml.includes('<ol');

    if (isDividerHeading) {
      return (
        <div key={block.id} className="pt-6 pb-2 border-b border-slate-200/80 dark:border-slate-800">
          <div
            onClick={handleRichContentClick}
            className="ilias-rich-content text-base font-bold text-[#d81e5b] dark:text-[#fb7185] tracking-tight flex items-center gap-2"
            dangerouslySetInnerHTML={{ __html: cleanedHtml }}
          />
        </div>
      );
    }

    return (
      <div
        key={block.id}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
      >
        {cleanTitle && (
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
            {getRichBlockIcon(cleanTitle)}
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{cleanTitle}</h3>
          </div>
        )}
        {cleanedHtml && (
          <div
            onClick={handleRichContentClick}
            className="ilias-rich-content text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-sans"
            dangerouslySetInnerHTML={{ __html: cleanedHtml }}
          />
        )}
      </div>
    );
  };

  const renderSessionsBlock = (block: CourseContentBlock): React.ReactNode => {
    const sessList = block.sessions && block.sessions.length > 0 ? block.sessions : sessions;
    if (sessList.length === 0) return null;

    return (
      <div key={block.id} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-emerald-500" />
            <span>{block.title || t("Sitzungen (Termine)")}</span>
            <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
              {sessList.length}
            </span>
          </h3>
        </div>
        <SessionDrawer sessions={sessList} courseRefId={courseRefId} />
      </div>
    );
  };

  const renderAllFilesBlock = (block: CourseContentBlock): React.ReactNode => {
    if (!block.items || block.items.length === 0) return null;

    return (
      <div key={block.id} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <Files className="h-4 w-4 text-amber-500" />
            <span>{block.title || t("Alle Dateien des Kurses")}</span>
            <span className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              {block.items.length}
            </span>
          </h3>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden dark:border-slate-800 dark:bg-slate-900 dark:divide-slate-800">
          {block.items.map(renderItemRow)}
        </div>
      </div>
    );
  };

  const renderItemsBlock = (block: CourseContentBlock): React.ReactNode => {
    const items = block.items || [];
    if (items.length === 0) return null;

    const isTilePresentation =
      block.presentation === 'tiles' || items.some((i) => !!i.image_url);

    if (isTilePresentation) {
      return (
        <div key={block.id} className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Folder className="h-4 w-4 text-amber-500" />
              <span>{block.title || 'Materialien'}</span>
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                {items.length}
              </span>
            </h3>
            {isScanningTree && (
              <div className="flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-md font-medium">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>{t("Analysiere Unterordner...")}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map(renderTileItemCard)}
          </div>
        </div>
      );
    }

    // Check if all items are folders
    const allFolders = items.every((i) => i.item_type === 'fold');
    if (allFolders) {
      return (
        <div key={block.id} className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Folder className="h-4 w-4 text-amber-500" />
              <span>{block.title || t("Ordner")}</span>
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                {items.length}
              </span>
            </h3>
            {isScanningTree && (
              <div className="flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-md font-medium">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>{t("Analysiere Unterordner...")}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {items.map((folder) => {
              const stat = folderStats[folder.ref_id];
              return (
                <div
                  key={folder.ref_id}
                  onClick={() => onNavigateFolder(folder.ref_id)}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-amber-300 hover:shadow-xs cursor-pointer gap-2.5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-amber-700/60"
                >
                  <div className="flex items-start gap-3 truncate pr-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 shrink-0 group-hover:scale-105 transition">
                      <Folder className="h-5 w-5 fill-amber-100 dark:fill-amber-950/60" />
                    </div>
                    <div className="min-w-0 flex-1 truncate">
                      <span className="text-xs font-bold text-slate-800 group-hover:text-amber-800 dark:text-slate-100 dark:group-hover:text-amber-300 transition block truncate">
                        {folder.title}
                      </span>
                      {folder.description && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate block mt-0.5">
                          {folder.description}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800 text-[10px]">
                    {stat ? (
                      stat.isMapped ? (
                        stat.isEmpty ? (
                          <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-medium text-slate-400 dark:text-slate-500">
                            {t("Leer")}
                          </span>
                        ) : (
                          <span className="rounded-md bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/50">
                            {stat.files > 0 && stat.folders > 0
                              ? `${stat.files} ${stat.files === 1 ? t("Datei") : t("Dateien")}, ${stat.folders} ${stat.folders === 1 ? t("Ordner") : t("Ordner")}`
                              : stat.files > 0
                              ? `${stat.files} ${stat.files === 1 ? t("Datei") : t("Dateien")}`
                              : `${stat.folders} ${stat.folders === 1 ? t("Ordner") : t("Ordner")}`}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">{t("Ordner")}</span>
                      )
                    ) : isScanningTree ? (
                      <span className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500">
                        <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                        <span>{t("Prüfe...")}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">{t("Ordner")}</span>
                    )}

                    <span className="font-semibold text-slate-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition">
                      {t("Öffnen →")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // Not all folders - check specific types for styling
    let titleColor = 'text-slate-500 dark:text-slate-400';
    let badgeClass = 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    let icon = <Layers className="h-4 w-4 text-indigo-500" />;

    const allPodcasts = items.length > 0 && items.every((i) => i.item_type === 'mcst' || i.title.toLowerCase().includes('podcast'));
    const allExercises = items.length > 0 && items.every((i) => i.item_type === 'exc');
    const allForums = items.length > 0 && items.every((i) => i.item_type === 'frm');
    const allFiles = items.length > 0 && items.every((i) => i.item_type === 'file');

    if (allPodcasts) {
      titleColor = 'text-sky-600 dark:text-sky-400';
      badgeClass = 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300';
      icon = <Radio className="h-4 w-4 text-sky-500" />;
    } else if (allExercises) {
      titleColor = 'text-indigo-600 dark:text-indigo-400';
      badgeClass = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300';
      icon = <Layers className="h-4 w-4 text-indigo-500" />;
    } else if (allForums) {
      titleColor = 'text-purple-600 dark:text-purple-400';
      badgeClass = 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300';
      icon = <MessageSquare className="h-4 w-4 text-purple-500" />;
    } else if (allFiles) {
      titleColor = 'text-teal-600 dark:text-teal-400';
      badgeClass = 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300';
      icon = <FileText className="h-4 w-4 text-teal-500" />;
    } else {
      // Mixed contents (e.g. Inhalte, Materialien)
      titleColor = 'text-indigo-600 dark:text-indigo-400';
      badgeClass = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300';
      icon = <BookOpen className="h-4 w-4 text-indigo-500" />;
    }

    return (
      <div key={block.id} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className={`text-xs font-bold uppercase tracking-wider ${titleColor} flex items-center gap-1.5`}>
            {icon}
            <span>{block.title || t("Inhalte")}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
              {items.length}
            </span>
          </h3>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100 overflow-hidden dark:border-slate-800 dark:bg-slate-900 dark:divide-slate-800">
          {items.map(renderItemRow)}
        </div>
      </div>
    );
  };

  const renderHeadingBlock = (block: CourseContentBlock): React.ReactNode => {
    return (
      <div key={block.id} className="pt-6 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="h-5 w-1 rounded-full bg-indigo-600" />
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">
            {block.title || t("Abschnitt")}
          </h2>
        </div>
      </div>
    );
  };

  const renderColumnsBlock = (block: CourseContentBlock): React.ReactNode => {
    const colCount = block.columns || block.child_blocks?.length || 2;
    const gridColsClass =
      colCount === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : colCount === 3
        ? 'grid-cols-1 md:grid-cols-3'
        : 'grid-cols-1 md:grid-cols-2';

    return (
      <div key={block.id} className={`grid ${gridColsClass} gap-4 items-start`}>
        {block.child_blocks?.map((colBlock, idx) => (
          <div key={colBlock.id || idx} className="space-y-4">
            {colBlock.child_blocks?.map(renderBlock)}
          </div>
        ))}
      </div>
    );
  };

  const renderBlock = (block: CourseContentBlock): React.ReactNode => {
    switch (block.block_type) {
      case 'columns':
        return renderColumnsBlock(block);
      case 'heading':
        return renderHeadingBlock(block);
      case 'drawer':
        return renderDrawerBlock(block);
      case 'text':
        return renderTextBlock(block);
      case 'sessions':
        return renderSessionsBlock(block);
      case 'all_files':
        return renderAllFilesBlock(block);
      case 'items':
      default:
        return renderItemsBlock(block);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Top Header with Breadcrumbs & Sync Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <CompactBreadcrumbs
          rawBreadcrumbs={materialsData?.breadcrumbs || []}
          courseNickname={courseNickname}
          courseRefId={courseRefId}
          currentFolderRefId={materialsData?.container_ref_id || ''}
          onNavigateHome={onNavigateHome}
          onNavigateRepository={onNavigateRepository}
          onNavigateSemester={onNavigateSemester}
          onNavigateCourse={onNavigateCourseRoot}
          onNavigateFolder={onNavigateFolder}
        />

        {/* Sync / Refresh status */}
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          {materialsData?.authoring && (materialsData.authoring.can_create || materialsData.authoring.can_manage || materialsData.authoring.can_edit_page) &&
            <button
              aria-pressed={isManaging}
              disabled={isRevalidating}
              onClick={() => { if (navigationGuard.confirmNavigation()) setIsManaging(!isManaging); }}
              title={isRevalidating ? t("Aktualisierung läuft... Bitte warten") : undefined}
              className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-900/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {t(isManaging ? 'management.done' : 'management.enter')}
            </button>}
          {isRevalidating ? (
            <div className="flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>{t("Synchronisiere...")}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
              <CheckCircle className="h-3 w-3 text-emerald-500" />
              <span>{t("Lokal bereitgestellt")}</span>
            </div>
          )}

          <button
            onClick={onManualRefresh}
            disabled={isRevalidating}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 transition disabled:opacity-50 cursor-pointer"
            title={t("Neu von ILIAS abrufen")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main Title Row & Search */}
      {isManaging && materialsData?.authoring && (materialsData.authoring.can_create || materialsData.authoring.can_manage || materialsData.authoring.can_edit_page) ? <CourseManagement key={materialsData.container_ref_id}
        context={materialsData.authoring} title={materialsData.title || courseNickname} courseRefId={courseRefId}
        onRefresh={onManualRefresh} onOpenFolder={onNavigateFolder} /> : <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            {isInsideSubfolder && (
              <button
                onClick={() => onNavigateCourseRoot(courseRefId)}
                className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>{t("Zurück")}</span>
              </button>
            )}
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-tight">
              {!isInsideSubfolder && <CourseIcon iconName={cache.getCourseIcon(courseRefId, { breadcrumbs: materialsData?.breadcrumbs })} className="inline-block h-5 w-5 mr-2" />}
              {materialsData?.title || courseNickname}
            </h1>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            {(materialsData?.items?.length || 0)} {((materialsData?.items?.length || 0) === 1 ? t("Material") : t("Materialien"))} {t("verfügbar")}
          </p>
        </div>

        {/* Search & Actions Bar */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-0 w-full md:w-auto">
          {membership?.can_leave && <button type="button" onClick={() => onManageMembership('leave')}
            className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold shrink-0 hover:bg-slate-100 dark:hover:bg-slate-800">{t("Kurs verlassen")}</button>}
          <button
            type="button"
            onClick={() => setIsOrderModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition shadow-2xs cursor-pointer shrink-0"
            title={t("Reihenfolge der Abschnitte anpassen")}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            <span className="hidden sm:inline">{t("Reihenfolge")}</span>
          </button>

          <div className="relative min-w-0 w-full md:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder={t("Vorlesung durchsuchen...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-4 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/30 transition shadow-2xs"
            />
          </div>
        </div>
      </div>

      {/* Main course content */}
      {membership?.can_join && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 p-4">
        <p className="text-sm">{t("Du bist diesem Kurs noch nicht beigetreten.")}</p>
        <button type="button" onClick={() => onManageMembership('join')} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white">{t("Kurs beitreten")}</button>
      </div>}
      {!isInsideSubfolder && materialsData && !membership?.can_join && materialsData.items.length === 0 && !(materialsData.blocks?.length) && !(materialsData.sessions?.length) &&
        <p className="text-sm text-slate-500">{t("Für diesen Kurs sind keine Inhalte sichtbar. Falls die Anmeldung über KSL erfolgt, verwalte sie dort.")}</p>}
      <div>
        {/* Main Content Area */}
        <div className="space-y-6">
          {/* SEARCH RESULTS VIEW (Repo-wide across current folder and all subfolders) */}
          {searchQuery.trim().length > 0 ? (
            <div className="space-y-6">
              {/* Header & Scanning indicator */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Search className="h-4 w-4" style={{ color: 'var(--accent, #0AACA5)' }} />
                    <span>{t("Suchergebnisse für \"")}{searchQuery}&quot;</span>
                    <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {filteredSearchResults.length} {filteredSearchResults.length === 1 ? t("Treffer") : t("Treffer")}
                    </span>
                  </h2>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                    <span>
                      {t("Durchsucht: Aktueller Ordner +")} {Object.keys(subfolderMaterials).length} {t("Unterordner")}
                    </span>
                    {isScanningTree && (
                      <span className="flex items-center gap-1 text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-2.5 py-0.5 rounded-md font-medium text-[11px]">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        <span>{t("Analysiere Ordnerstruktur...")}</span>
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="self-start sm:self-auto text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-[var(--accent)] transition cursor-pointer"
                >
                  {t("Suche zurücksetzen")}
                </button>
              </div>

              {/* Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSearchCategoryFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                    searchCategoryFilter === 'all'
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-2xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {t("Alle (")}{searchResults.length})
                </button>
                {searchFileCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchCategoryFilter('file')}
                    style={searchCategoryFilter === 'file' ? { backgroundColor: 'var(--accent, #0AACA5)' } : {}}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      searchCategoryFilter === 'file'
                        ? 'text-white shadow-2xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {t("Dateien & Folien (")}{searchFileCount})
                  </button>
                )}
                {searchFoldCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchCategoryFilter('fold')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      searchCategoryFilter === 'fold'
                        ? 'bg-amber-600 text-white shadow-2xs'
                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60'
                    }`}
                  >
                    {t("Unterordner (")}{searchFoldCount})
                  </button>
                )}
                {searchMcstCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchCategoryFilter('mcst')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      searchCategoryFilter === 'mcst'
                        ? 'bg-sky-600 text-white shadow-2xs'
                        : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60'
                    }`}
                  >
                    {t("Podcasts (")}{searchMcstCount})
                  </button>
                )}
                {searchExcCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchCategoryFilter('exc')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      searchCategoryFilter === 'exc'
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60'
                    }`}
                  >
                    {t("Übungen & Weiteres (")}{searchExcCount})
                  </button>
                )}
              </div>

              {/* Search Results List */}
              {filteredSearchResults.length > 0 ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                  {filteredSearchResults.map(renderSearchResultRow)}
                </div>
              ) : (
                <div className="flex h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center">
                  <Search className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">{t("Keine Suchergebnisse gefunden")}</h4>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm">
                    {t("In diesem Kurs oder dessen Unterordnern wurden keine Materialien zu \"")}{searchQuery}{t("\" gefunden.")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="mt-4 rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
                  >
                    {t("Suche zurücksetzen")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* NORMAL COURSE VIEW (Customizable Course Blocks) */
            (() => {
              // 1. Uncached error state
              if (!materialsData && loadError) {
                return (
                  <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-red-200 dark:border-red-950/60 bg-red-50/50 dark:bg-red-950/20 p-6 text-center">
                    <AlertCircle className="h-8 w-8 text-red-500 mb-2" />
                    <p className="text-sm font-bold text-red-900 dark:text-red-300">{t("Fehler beim Abrufen der Vorlesungsinhalte")}</p>
                    <p className="text-xs text-red-700 dark:text-red-400 mt-1 max-w-md">{loadError}</p>
                    <button
                      type="button"
                      onClick={onManualRefresh}
                      style={{ backgroundColor: 'var(--accent, #0AACA5)' }}
                      className="mt-4 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-90 transition cursor-pointer"
                    >
                      {t("Erneut versuchen")}
                    </button>
                  </div>
                );
              }

              // 2. Uncached loading state (in-flight request)
              if (!materialsData || (isRevalidating && orderedBlocksToRender.length === 0)) {
                return (
                  <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center animate-in fade-in duration-150">
                    <div
                      className="h-8 w-8 animate-spin rounded-full border-3 border-t-transparent mb-3"
                      style={{ borderColor: 'var(--accent, #0AACA5)', borderTopColor: 'transparent' }}
                    />
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t("Lade Vorlesungsinhalte...")}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t("Materialien werden von ILIAS abgerufen")}</p>
                  </div>
                );
              }

              const rendered = orderedBlocksToRender.map(renderBlock).filter(Boolean);

              // 3. Request completed and confirmed empty
              if (rendered.length === 0) {
                return (
                  <div className="flex h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center p-6">
                    <Search className="h-6 w-6 text-slate-300 dark:text-slate-600 mb-2" />
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{t("Keine Materialien vorhanden")}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("In diesem Bereich wurden noch keine Materialien gefunden.")}</p>
                  </div>
                );
              }

              return <div className="space-y-6">{rendered}</div>;
            })()
          )}
        </div>

      </div>

      </>}
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

      {/* Content Blocks Order & Customization Modal */}
      {isOrderModalOpen && (
        <ContentOrderModal
          isOpen={isOrderModalOpen}
          onClose={() => setIsOrderModalOpen(false)}
          blocks={availableBlocks}
          blockOrder={blockOrder}
          hiddenBlockIds={hiddenBlockIds}
          showAllFilesBlock={showAllFilesBlock}
          onSaveOrder={handleSaveBlockOrder}
          onToggleHideBlock={handleToggleHideBlock}
          onToggleShowAllFiles={handleToggleShowAllFiles}
          onResetToDefault={handleResetBlocksToDefault}
        />
      )}
    </div>
  );
};

export default CourseView;
