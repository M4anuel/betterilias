import { useEffect, useState } from 'react';
import { CourseContentBlock, CourseMaterialsResponse, MaterialItem } from '../types';
import { cache } from './cache';
import { t } from './i18n';

export interface FolderStats {
  files: number;
  folders: number;
  exercises: number;
  forums: number;
  podcasts: number;
  tests: number;
  links: number;
  sessions: number;
  votings: number;
  other: number;
  total: number;
  loaded: boolean;
}

export interface CourseTreeNode {
  ref_id: string;
  title: string;
  item_type: string;
  url: string;
  parent_ref_id: string | null;
  depth: number;
  path: string[];
  path_ref_ids: string[];
  children_ref_ids: string[];
}

export interface CourseContentTree {
  course_ref_id: string;
  course_title: string;
  root_ref_id: string;
  max_depth_scanned: number;
  updated_at: string;
  nodes: Record<string, CourseTreeNode>;
}

export type CourseAssignmentTarget =
  | {
      kind: 'exercise';
      courseRefId: string;
      containerRefId: string;
      exerciseRefId: string;
      title: string;
      href: string;
    }
  | {
      kind: 'folder';
      courseRefId: string;
      folderRefId: string;
      title: string;
      href: string;
    };

export const COURSE_TREE_UPDATED_EVENT = 'betterilias-course-tree-updated';
const COURSE_TREE_KEY_PREFIX = 'ilias_course_tree_';

/**
 * Normalize a MaterialItem's type using both its explicit `item_type` and URL/title heuristics
 * so exercises, forums, podcasts, tests, links, live votings, and folders are never misclassified as files.
 */
export function normalizeMaterialItemType(item: Pick<MaterialItem, 'item_type' | 'url' | 'title'>): string {
  const rawType = (item.item_type || '').toLowerCase().trim();
  const urlLower = (item.url || '').toLowerCase();
  const titleLower = (item.title || '').toLowerCase();

  if (rawType === 'fold' || urlLower.includes('/go/fold/') || urlLower.includes('_fold_')) {
    return 'fold';
  }
  if (
    rawType === 'exc' ||
    urlLower.includes('ilexercise') ||
    urlLower.includes('ilobjexercisegui') ||
    urlLower.includes('/go/exc/') ||
    urlLower.includes('_exc_')
  ) {
    return 'exc';
  }
  if (
    rawType === 'frm' ||
    urlLower.includes('ilobjforumgui') ||
    urlLower.includes('/go/frm/') ||
    urlLower.includes('_frm_')
  ) {
    return 'frm';
  }
  if (
    rawType === 'mcst' ||
    urlLower.includes('/go/mcst/') ||
    urlLower.includes('_mcst_') ||
    urlLower.includes('xoct') ||
    urlLower.includes('opencast') ||
    urlLower.includes('mediacast') ||
    titleLower.includes('podcast')
  ) {
    return 'mcst';
  }
  if (
    rawType === 'voting' ||
    urlLower.includes('xlvo') ||
    titleLower.includes('live voting')
  ) {
    return 'voting';
  }
  if (
    rawType === 'tst' ||
    urlLower.includes('ilobjtestgui') ||
    urlLower.includes('/go/tst/') ||
    urlLower.includes('_tst_')
  ) {
    return 'tst';
  }
  if (
    rawType === 'webr' ||
    urlLower.includes('/go/webr/') ||
    urlLower.includes('_webr_') ||
    urlLower.includes('weblink')
  ) {
    return 'webr';
  }
  if (
    rawType === 'sess' ||
    urlLower.includes('/go/sess/') ||
    urlLower.includes('_sess_')
  ) {
    return 'sess';
  }
  if (
    rawType === 'file' ||
    urlLower.includes('/go/file/') ||
    urlLower.includes('_file_') ||
    urlLower.includes('cmd=sendfile') ||
    urlLower.includes('ilobjfilegui')
  ) {
    return 'file';
  }
  return rawType || 'other';
}

/**
 * Extract all unique MaterialItems from a CourseMaterialsResponse across flat `items`,
 * `sections`, and nested `blocks` (including drawers and multi-column layouts).
 */
export function extractAllMaterialItems(res: CourseMaterialsResponse | null | undefined): MaterialItem[] {
  if (!res) return [];
  const items: MaterialItem[] = [];
  const seen = new Set<string>();

  const addItem = (item: MaterialItem | null | undefined) => {
    if (!item || !item.ref_id || seen.has(item.ref_id)) return;
    seen.add(item.ref_id);
    items.push(item);
  };

  for (const item of res.items || []) {
    addItem(item);
  }
  for (const sec of res.sections || []) {
    for (const item of sec.items || []) {
      addItem(item);
    }
    for (const grp of sec.groups || []) {
      for (const item of grp.items || []) {
        addItem(item);
      }
    }
  }

  const walkBlocks = (blocks: CourseContentBlock[] | undefined) => {
    if (!blocks) return;
    for (const block of blocks) {
      if (block.block_type === 'all_files') continue;
      for (const item of block.items || []) {
        addItem(item);
      }
      if (block.child_blocks?.length) {
        walkBlocks(block.child_blocks);
      }
    }
  };
  walkBlocks(res.blocks);

  return items;
}

/**
 * Extract all unique folder items from a CourseMaterialsResponse (including inside sections and blocks).
 */
export function getFoldersFromMaterials(res: CourseMaterialsResponse | null | undefined): MaterialItem[] {
  return extractAllMaterialItems(res).filter((item) => normalizeMaterialItemType(item) === 'fold');
}

/**
 * Accurately count all items inside a folder by category rather than labeling all non-folders as files.
 */
export function countFolderItems(res: CourseMaterialsResponse | null | undefined): FolderStats {
  const stats: FolderStats = {
    files: 0,
    folders: 0,
    exercises: 0,
    forums: 0,
    podcasts: 0,
    tests: 0,
    links: 0,
    sessions: 0,
    votings: 0,
    other: 0,
    total: 0,
    loaded: true,
  };

  if (!res) return stats;

  const allItems = extractAllMaterialItems(res);
  const seenSessionRefs = new Set<string>();

  for (const item of allItems) {
    const type = normalizeMaterialItemType(item);
    stats.total++;
    switch (type) {
      case 'fold':
        stats.folders++;
        break;
      case 'file':
        stats.files++;
        break;
      case 'exc':
        stats.exercises++;
        break;
      case 'frm':
        stats.forums++;
        break;
      case 'mcst':
        stats.podcasts++;
        break;
      case 'tst':
        stats.tests++;
        break;
      case 'webr':
        stats.links++;
        break;
      case 'sess':
        stats.sessions++;
        seenSessionRefs.add(item.ref_id);
        break;
      case 'voting':
        stats.votings++;
        break;
      default:
        stats.other++;
        break;
    }
  }

  for (const sess of res.sessions || []) {
    if (sess?.ref_id && !seenSessionRefs.has(sess.ref_id)) {
      seenSessionRefs.add(sess.ref_id);
      stats.sessions++;
      stats.total++;
    }
  }

  return stats;
}

/**
 * Format a concise, localized human-readable summary of a folder's contents.
 */
export function formatFolderStats(
  stat: FolderStats | undefined,
  tFn: typeof t = t
): string {
  if (!stat || !stat.loaded) return '';
  if (stat.total === 0) return tFn('Leer');

  const parts: string[] = [];

  if (stat.folders > 0) {
    parts.push(`${stat.folders} ${stat.folders === 1 ? tFn('Ordner') : tFn('folder_stats.folders_many')}`);
  }
  if (stat.files > 0) {
    parts.push(`${stat.files} ${stat.files === 1 ? tFn('Datei') : tFn('Dateien')}`);
  }
  if (stat.exercises > 0) {
    parts.push(`${stat.exercises} ${stat.exercises === 1 ? tFn('folder_stats.exercise_one') : tFn('Übungen')}`);
  }
  if (stat.forums > 0) {
    parts.push(`${stat.forums} ${stat.forums === 1 ? tFn('folder_stats.forum_one') : tFn('folder_stats.forum_many')}`);
  }
  if (stat.podcasts > 0) {
    parts.push(`${stat.podcasts} ${stat.podcasts === 1 ? tFn('folder_stats.podcast_one') : tFn('Aufzeichnungen')}`);
  }
  if (stat.tests > 0) {
    parts.push(`${stat.tests} ${stat.tests === 1 ? tFn('folder_stats.test_one') : tFn('folder_stats.test_many')}`);
  }
  if (stat.votings > 0) {
    parts.push(`${stat.votings} ${stat.votings === 1 ? tFn('Live Voting') : tFn('folder_stats.voting_many')}`);
  }
  if (stat.links > 0) {
    parts.push(`${stat.links} ${stat.links === 1 ? tFn('folder_stats.link_one') : tFn('folder_stats.link_many')}`);
  }
  if (stat.sessions > 0) {
    parts.push(`${stat.sessions} ${stat.sessions === 1 ? tFn('folder_stats.session_one') : tFn('folder_stats.session_many')}`);
  }
  if (stat.other > 0) {
    parts.push(`${stat.other} ${stat.other === 1 ? tFn('Element') : tFn('Elemente')}`);
  }

  if (parts.length === 0) {
    return tFn('Leer');
  }

  return parts.join(', ');
}

/**
 * Build a relative application href for navigating to a course, folder, or exercise.
 */
export function buildCourseTargetHref(courseRefId: string, containerRefId = courseRefId, exerciseRefId?: string): string {
  const params = new URLSearchParams({ course: courseRefId });
  if (containerRefId && containerRefId !== courseRefId) {
    params.set('folder', containerRefId);
  }
  if (exerciseRefId) {
    params.set('exercise', exerciseRefId);
  }
  return `?${params.toString()}`;
}

export function getCourseTree(courseRefId: string): CourseContentTree | null {
  if (!courseRefId) return null;
  try {
    const raw = localStorage.getItem(`${COURSE_TREE_KEY_PREFIX}${courseRefId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CourseContentTree;
    if (!parsed || parsed.course_ref_id !== courseRefId || typeof parsed.nodes !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCourseTree(tree: CourseContentTree): void {
  if (!tree?.course_ref_id) return;
  try {
    localStorage.setItem(`${COURSE_TREE_KEY_PREFIX}${tree.course_ref_id}`, JSON.stringify(tree));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(COURSE_TREE_UPDATED_EVENT, { detail: { courseRefId: tree.course_ref_id } })
      );
    }
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Create or update a container and its child items in a course's content tree/graph.
 */
export function upsertCourseTreeContainer(params: {
  courseRefId: string;
  courseTitle?: string;
  materials: CourseMaterialsResponse;
  parentRefId?: string | null;
  depth?: number;
  path?: string[];
  pathRefIds?: string[];
}): CourseContentTree {
  const {
    courseRefId,
    courseTitle,
    materials,
    parentRefId = null,
    depth = 0,
    path,
    pathRefIds,
  } = params;

  const existing = getCourseTree(courseRefId);
  const containerId = materials.container_ref_id || courseRefId;
  const isRoot = containerId === courseRefId;
  const resolvedCourseTitle =
    courseTitle ||
    (isRoot ? materials.title : existing?.course_title) ||
    existing?.course_title ||
    courseRefId;

  const nodes: Record<string, CourseTreeNode> = existing?.nodes ? { ...existing.nodes } : {};
  const existingContainer = nodes[containerId];

  const resolvedDepth = isRoot ? 0 : depth || existingContainer?.depth || 1;
  const resolvedParentRefId = isRoot ? null : parentRefId ?? existingContainer?.parent_ref_id ?? courseRefId;
  const containerTitle = materials.title || existingContainer?.title || resolvedCourseTitle;

  const resolvedPath =
    path && path.length > 0
      ? path
      : existingContainer?.path?.length
      ? existingContainer.path
      : isRoot
      ? [containerTitle]
      : [resolvedCourseTitle, containerTitle];

  const resolvedPathRefIds =
    pathRefIds && pathRefIds.length > 0
      ? pathRefIds
      : existingContainer?.path_ref_ids?.length
      ? existingContainer.path_ref_ids
      : isRoot
      ? [courseRefId]
      : [courseRefId, containerId];

  const childItems = extractAllMaterialItems(materials);
  const childRefIds: string[] = [];

  for (const item of childItems) {
    if (!item.ref_id || item.ref_id === containerId) continue;
    childRefIds.push(item.ref_id);
    const normalizedType = normalizeMaterialItemType(item);
    const prevChild = nodes[item.ref_id];
    nodes[item.ref_id] = {
      ref_id: item.ref_id,
      title: item.title,
      item_type: normalizedType,
      url: item.url || prevChild?.url || '',
      parent_ref_id: containerId,
      depth: resolvedDepth + 1,
      path: [...resolvedPath, item.title],
      path_ref_ids: [...resolvedPathRefIds, item.ref_id],
      children_ref_ids: prevChild?.children_ref_ids || [],
    };
  }

  nodes[containerId] = {
    ref_id: containerId,
    title: containerTitle,
    item_type: isRoot ? 'crs' : 'fold',
    url: existingContainer?.url || '',
    parent_ref_id: resolvedParentRefId,
    depth: resolvedDepth,
    path: resolvedPath,
    path_ref_ids: resolvedPathRefIds,
    children_ref_ids: childRefIds,
  };

  // Ensure root node always exists in the graph
  if (!nodes[courseRefId]) {
    nodes[courseRefId] = {
      ref_id: courseRefId,
      title: resolvedCourseTitle,
      item_type: 'crs',
      url: '',
      parent_ref_id: null,
      depth: 0,
      path: [resolvedCourseTitle],
      path_ref_ids: [courseRefId],
      children_ref_ids: isRoot ? childRefIds : [containerId],
    };
  }

  const maxDepth = Object.values(nodes).reduce((max, n) => Math.max(max, n.depth), 0);

  const nextTree: CourseContentTree = {
    course_ref_id: courseRefId,
    course_title: resolvedCourseTitle,
    root_ref_id: courseRefId,
    max_depth_scanned: Math.max(existing?.max_depth_scanned || 0, maxDepth),
    updated_at: new Date().toISOString(),
    nodes,
  };

  saveCourseTree(nextTree);
  return nextTree;
}

/**
 * Rebuild or enrich a course's content tree from any materials already cached in localStorage
 * (up to depth 2 subfolders) so previously visited courses have a tree immediately.
 */
export function syncCourseTreeFromCache(courseRefId: string, courseTitle?: string): CourseContentTree | null {
  if (!courseRefId) return null;
  const rootMaterials = cache.getCachedMaterials(courseRefId);
  if (!rootMaterials) {
    return getCourseTree(courseRefId);
  }

  const rootTitle = rootMaterials.title || courseTitle || courseRefId;
  let tree = upsertCourseTreeContainer({
    courseRefId,
    courseTitle: rootTitle,
    materials: rootMaterials,
    parentRefId: null,
    depth: 0,
    path: [rootTitle],
    pathRefIds: [courseRefId],
  });

  const level1Folders = getFoldersFromMaterials(rootMaterials);
  for (const f1 of level1Folders) {
    const f1Materials = cache.getCachedMaterials(f1.ref_id);
    if (!f1Materials) continue;
    const f1Path = [rootTitle, f1.title];
    const f1PathRefs = [courseRefId, f1.ref_id];
    tree = upsertCourseTreeContainer({
      courseRefId,
      courseTitle: rootTitle,
      materials: f1Materials,
      parentRefId: courseRefId,
      depth: 1,
      path: f1Path,
      pathRefIds: f1PathRefs,
    });

    const level2Folders = getFoldersFromMaterials(f1Materials);
    for (const f2 of level2Folders) {
      const f2Materials = cache.getCachedMaterials(f2.ref_id);
      if (!f2Materials) continue;
      tree = upsertCourseTreeContainer({
        courseRefId,
        courseTitle: rootTitle,
        materials: f2Materials,
        parentRefId: f1.ref_id,
        depth: 2,
        path: [...f1Path, f2.title],
        pathRefIds: [...f1PathRefs, f2.ref_id],
      });
    }
  }

  return tree;
}

/**
 * Resolve the one-click assignment quick-link target from a course's content tree/graph:
 * 1. If there is exactly 1 exercise/assignment block (`exc`) in the lecture: link directly to that exercise.
 * 2. If there are multiple exercise blocks (`exc`) and ALL of them reside in the exact same subfolder
 *    (and nowhere else in the lecture): link to that parent folder.
 * 3. Otherwise (0 exercises, or multiple exercises in the course root or spread across different folders):
 *    return `null` (display no quick-link).
 */
export function resolveCourseAssignmentTarget(tree: CourseContentTree | null | undefined): CourseAssignmentTarget | null {
  if (!tree || !tree.nodes) return null;

  const excNodes = Object.values(tree.nodes).filter((node) => node.item_type === 'exc');
  if (excNodes.length === 0) {
    return null;
  }

  if (excNodes.length === 1) {
    const exc = excNodes[0];
    const containerRefId = exc.parent_ref_id || tree.course_ref_id;
    return {
      kind: 'exercise',
      courseRefId: tree.course_ref_id,
      containerRefId,
      exerciseRefId: exc.ref_id,
      title: exc.title,
      href: buildCourseTargetHref(tree.course_ref_id, containerRefId, exc.ref_id),
    };
  }

  // Multiple assignment blocks: check if all share the exact same parent subfolder
  const parentIds = new Set(excNodes.map((n) => n.parent_ref_id || tree.course_ref_id));
  if (parentIds.size === 1) {
    const [commonParentId] = Array.from(parentIds);
    if (commonParentId && commonParentId !== tree.course_ref_id) {
      const parentNode = tree.nodes[commonParentId];
      if (!parentNode || parentNode.item_type === 'fold') {
        const folderTitle = parentNode?.title || 'Übungen';
        return {
          kind: 'folder',
          courseRefId: tree.course_ref_id,
          folderRefId: commonParentId,
          title: folderTitle,
          href: buildCourseTargetHref(tree.course_ref_id, commonParentId),
        };
      }
    }
  }

  return null;
}

/**
 * Get the resolved assignment quick-link target for a course, syncing from cached materials if needed.
 */
export function getCourseAssignmentTarget(courseRefId: string, courseTitle?: string): CourseAssignmentTarget | null {
  let tree = getCourseTree(courseRefId);
  if (!tree && cache.getCachedMaterials(courseRefId)) {
    tree = syncCourseTreeFromCache(courseRefId, courseTitle);
  }
  return resolveCourseAssignmentTarget(tree);
}

/**
 * Retrieve a specific node from a course's content tree/graph (for pinning & navigation).
 */
export function getCourseTreeNode(courseRefId: string, refId: string): CourseTreeNode | null {
  const tree = getCourseTree(courseRefId);
  return tree?.nodes?.[refId] || null;
}

/**
 * Retrieve all folder nodes in a course's content tree/graph sorted by depth and title.
 */
export function getCourseTreeFolders(courseRefId: string): CourseTreeNode[] {
  const tree = getCourseTree(courseRefId);
  if (!tree?.nodes) return [];
  return Object.values(tree.nodes)
    .filter((node) => node.item_type === 'fold')
    .sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));
}

/**
 * React hook that returns a map of `courseRefId -> CourseAssignmentTarget` and automatically
 * updates whenever course trees are built or updated during background crawling.
 */
export function useCourseAssignmentTargets(
  courses: ReadonlyArray<{ ref_id: string; title: string }>
): Record<string, CourseAssignmentTarget> {
  const computeTargets = () => {
    const map: Record<string, CourseAssignmentTarget> = {};
    for (const course of courses) {
      const target = getCourseAssignmentTarget(course.ref_id, course.title);
      if (target) {
        map[course.ref_id] = target;
      }
    }
    return map;
  };

  const [targets, setTargets] = useState<Record<string, CourseAssignmentTarget>>(computeTargets);

  useEffect(() => {
    setTargets(computeTargets());
    const handleUpdate = () => setTargets(computeTargets());
    window.addEventListener(COURSE_TREE_UPDATED_EVENT, handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener(COURSE_TREE_UPDATED_EVENT, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses.map((c) => c.ref_id).join(',')]);

  return targets;
}
