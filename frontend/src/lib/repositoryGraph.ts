import { useEffect, useState } from 'react';
import { BreadcrumbItem, RepositoryResponse } from '../types';
import { cache } from './cache';
import { t } from './i18n';

export interface RepositoryItemCounts {
  total: number;
  categories: number;
  courses: number;
  folders: number;
  groups: number;
  other: number;
}

export interface RepositoryGraphNode {
  ref_id: string;
  title: string;
  item_type: string;
  url: string;
  parent_ref_id: string | null;
  children_ref_ids: string[];
  depth: number;
  path_ref_ids: string[];
  path_titles: string[];
  accessible: boolean;
  description?: string;
  is_expanded: boolean;
  updated_at: string;
  item_counts?: RepositoryItemCounts;
}

export interface RepositoryGraph {
  root_ref_id: string;
  nodes: Record<string, RepositoryGraphNode>;
  updated_at: string;
}

export const REPOSITORY_GRAPH_UPDATED_EVENT = 'betterilias-repository-graph-updated';
const REPOSITORY_GRAPH_KEY_PREFIX = 'ilias_repository_graph_';

function getStorageKey(): string {
  const session = cache.getSessionId() || 'default';
  return `${REPOSITORY_GRAPH_KEY_PREFIX}${session}`;
}

export function createDefaultGraph(): RepositoryGraph {
  return {
    root_ref_id: '1',
    nodes: {
      '1': {
        ref_id: '1',
        title: 'Magazin',
        item_type: 'root',
        url: '',
        parent_ref_id: null,
        children_ref_ids: [],
        depth: 0,
        path_ref_ids: ['1'],
        path_titles: ['Magazin'],
        accessible: true,
        is_expanded: false,
        updated_at: new Date().toISOString(),
      },
    },
    updated_at: new Date().toISOString(),
  };
}

export function getRepositoryGraph(): RepositoryGraph {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return createDefaultGraph();
    const parsed = JSON.parse(raw) as RepositoryGraph;
    if (!parsed || typeof parsed.nodes !== 'object') {
      return createDefaultGraph();
    }
    return parsed;
  } catch {
    return createDefaultGraph();
  }
}

export function saveRepositoryGraph(graph: RepositoryGraph): void {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(graph));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(REPOSITORY_GRAPH_UPDATED_EVENT, { detail: { graph } }));
    }
  } catch (err) {
    console.warn('Failed to save repository graph to localStorage', err);
  }
}

export function clearRepositoryGraph(): void {
  try {
    localStorage.removeItem(getStorageKey());
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(REPOSITORY_GRAPH_UPDATED_EVENT, { detail: { graph: createDefaultGraph() } }));
    }
  } catch (err) {
    console.warn('Failed to clear repository graph', err);
  }
}

export function countRepositoryItems(items: RepositoryResponse['items'] = []): RepositoryItemCounts {
  const counts: RepositoryItemCounts = {
    total: items.length,
    categories: 0,
    courses: 0,
    folders: 0,
    groups: 0,
    other: 0,
  };

  for (const item of items) {
    const type = (item.item_type || '').toLowerCase();
    switch (type) {
      case 'cat':
        counts.categories++;
        break;
      case 'crs':
        counts.courses++;
        break;
      case 'fold':
        counts.folders++;
        break;
      case 'grp':
        counts.groups++;
        break;
      default:
        counts.other++;
        break;
    }
  }

  return counts;
}

export function formatRepositoryCounts(
  counts?: RepositoryItemCounts,
  tFn: typeof t = t
): string {
  if (!counts || counts.total === 0) return '';
  const parts: string[] = [];

  if (counts.categories > 0) {
    parts.push(`${counts.categories} ${counts.categories === 1 ? tFn('Kategorie') : tFn('Kategorien')}`);
  }
  if (counts.courses > 0) {
    parts.push(`${counts.courses} ${counts.courses === 1 ? tFn('Kurs') : tFn('Kurse')}`);
  }
  if (counts.folders > 0) {
    parts.push(`${counts.folders} ${counts.folders === 1 ? tFn('Ordner') : tFn('folder_stats.folders_many')}`);
  }
  if (counts.groups > 0) {
    parts.push(`${counts.groups} ${counts.groups === 1 ? tFn('Gruppe') : tFn('Gruppen')}`);
  }
  if (counts.other > 0) {
    parts.push(`${counts.other} ${counts.other === 1 ? tFn('Element') : tFn('Elemente')}`);
  }

  return parts.join(', ');
}

/**
 * Lazily ingests a single container's `RepositoryResponse` into the repository graph.
 * Discovered child items become unexpanded nodes in the graph; the container itself
 * is marked `is_expanded: true`. Parent/child relations from breadcrumbs are linked.
 */
export function ingestRepositoryResponse(res: RepositoryResponse | null | undefined): void {
  if (!res || !res.container_ref_id) return;

  const graph = getRepositoryGraph();
  const now = new Date().toISOString();
  const currentRefId = String(res.container_ref_id);

  // 1. Process breadcrumbs to establish ancestor chain and link parent -> child
  const validCrumbs = (res.breadcrumbs || []).filter((b): b is BreadcrumbItem & { ref_id: string } => Boolean(b && b.ref_id));
  const pathRefIds: string[] = [];
  const pathTitles: string[] = [];

  for (let i = 0; i < validCrumbs.length; i++) {
    const crumb = validCrumbs[i];
    const crumbRefId = String(crumb.ref_id);
    pathRefIds.push(crumbRefId);
    pathTitles.push(crumb.title || crumbRefId);

    const parentRefId = i > 0 ? String(validCrumbs[i - 1].ref_id) : (crumbRefId === '1' ? null : '1');

    if (!graph.nodes[crumbRefId]) {
      graph.nodes[crumbRefId] = {
        ref_id: crumbRefId,
        title: crumb.title || (crumbRefId === '1' ? 'Magazin' : `Kategorie ${crumbRefId}`),
        item_type: crumbRefId === '1' ? 'root' : 'cat',
        url: '',
        parent_ref_id: parentRefId,
        children_ref_ids: [],
        depth: i,
        path_ref_ids: [...pathRefIds],
        path_titles: [...pathTitles],
        accessible: true,
        is_expanded: false,
        updated_at: now,
      };
    } else {
      const existing = graph.nodes[crumbRefId];
      if (crumb.title && existing.title !== crumb.title) {
        existing.title = crumb.title;
      }
      if (parentRefId && !existing.parent_ref_id && crumbRefId !== '1') {
        existing.parent_ref_id = parentRefId;
      }
      existing.depth = i;
      existing.path_ref_ids = [...pathRefIds];
      existing.path_titles = [...pathTitles];
    }

    // Link parent node to this child
    if (parentRefId && graph.nodes[parentRefId]) {
      const parentNode = graph.nodes[parentRefId];
      if (!parentNode.children_ref_ids.includes(crumbRefId)) {
        parentNode.children_ref_ids.push(crumbRefId);
      }
    }
  }

  // 2. Identify parent of current container
  let directParentRefId: string | null = null;
  const currentCrumbIndex = validCrumbs.findIndex((c) => String(c.ref_id) === currentRefId);
  if (currentCrumbIndex > 0) {
    directParentRefId = String(validCrumbs[currentCrumbIndex - 1].ref_id);
  } else if (validCrumbs.length > 0 && String(validCrumbs[validCrumbs.length - 1].ref_id) !== currentRefId) {
    directParentRefId = String(validCrumbs[validCrumbs.length - 1].ref_id);
  } else if (currentRefId !== '1') {
    directParentRefId = '1';
  }

  // 3. Collect child ref_ids from response items
  const childrenRefIds: string[] = [];
  const currentDepth = pathRefIds.length > 0 ? pathRefIds.length - 1 : (currentRefId === '1' ? 0 : 1);

  for (const item of res.items || []) {
    if (!item.ref_id) continue;
    const childRefId = String(item.ref_id);
    childrenRefIds.push(childRefId);

    const existingChild = graph.nodes[childRefId];
    if (existingChild) {
      existingChild.title = item.title || existingChild.title;
      existingChild.item_type = item.item_type || existingChild.item_type;
      existingChild.url = item.url || existingChild.url;
      existingChild.accessible = item.accessible !== false;
      existingChild.description = item.description || existingChild.description;
      existingChild.parent_ref_id = currentRefId;
      existingChild.depth = currentDepth + 1;
      existingChild.path_ref_ids = [...pathRefIds, childRefId];
      existingChild.path_titles = [...pathTitles, item.title || childRefId];
      existingChild.updated_at = now;
    } else {
      graph.nodes[childRefId] = {
        ref_id: childRefId,
        title: item.title || `Item ${childRefId}`,
        item_type: item.item_type || 'other',
        url: item.url || '',
        parent_ref_id: currentRefId,
        children_ref_ids: [],
        depth: currentDepth + 1,
        path_ref_ids: [...pathRefIds, childRefId],
        path_titles: [...pathTitles, item.title || childRefId],
        accessible: item.accessible !== false,
        description: item.description,
        is_expanded: false,
        updated_at: now,
      };
    }
  }

  // 4. Update the current container node
  const existingNode = graph.nodes[currentRefId];
  const itemCounts = countRepositoryItems(res.items);

  if (existingNode) {
    existingNode.title = res.title || existingNode.title;
    existingNode.parent_ref_id = directParentRefId || existingNode.parent_ref_id;
    existingNode.children_ref_ids = childrenRefIds;
    existingNode.is_expanded = true;
    existingNode.depth = currentDepth;
    existingNode.item_counts = itemCounts;
    existingNode.updated_at = now;
    if (pathRefIds.length > 0) {
      existingNode.path_ref_ids = pathRefIds;
      existingNode.path_titles = pathTitles;
    }
  } else {
    graph.nodes[currentRefId] = {
      ref_id: currentRefId,
      title: res.title || (currentRefId === '1' ? 'Magazin' : `Container ${currentRefId}`),
      item_type: currentRefId === '1' ? 'root' : 'cat',
      url: '',
      parent_ref_id: directParentRefId,
      children_ref_ids: childrenRefIds,
      depth: currentDepth,
      path_ref_ids: pathRefIds.length > 0 ? pathRefIds : [currentRefId],
      path_titles: pathTitles.length > 0 ? pathTitles : [res.title || currentRefId],
      accessible: true,
      is_expanded: true,
      updated_at: now,
      item_counts: itemCounts,
    };
  }

  // Ensure direct parent has this node registered in its children
  if (directParentRefId && graph.nodes[directParentRefId]) {
    const parent = graph.nodes[directParentRefId];
    if (!parent.children_ref_ids.includes(currentRefId)) {
      parent.children_ref_ids.push(currentRefId);
    }
  }

  graph.updated_at = now;
  saveRepositoryGraph(graph);
}

export function getNode(refId: string): RepositoryGraphNode | null {
  const graph = getRepositoryGraph();
  return graph.nodes[String(refId)] || null;
}

export function getChildren(refId: string): RepositoryGraphNode[] {
  const graph = getRepositoryGraph();
  const node = graph.nodes[String(refId)];
  if (!node) return [];
  return node.children_ref_ids
    .map((cid) => graph.nodes[cid])
    .filter((n): n is RepositoryGraphNode => Boolean(n));
}

export function getAncestors(refId: string): RepositoryGraphNode[] {
  const graph = getRepositoryGraph();
  const node = graph.nodes[String(refId)];
  if (!node) return [];
  const ancestors: RepositoryGraphNode[] = [];
  for (const pid of node.path_ref_ids) {
    if (pid !== node.ref_id && graph.nodes[pid]) {
      ancestors.push(graph.nodes[pid]);
    }
  }
  return ancestors;
}

export function getSiblings(refId: string): RepositoryGraphNode[] {
  const graph = getRepositoryGraph();
  const node = graph.nodes[String(refId)];
  if (!node || !node.parent_ref_id) return [];
  const parent = graph.nodes[node.parent_ref_id];
  if (!parent) return [];
  return parent.children_ref_ids
    .filter((cid) => cid !== node.ref_id)
    .map((cid) => graph.nodes[cid])
    .filter((n): n is RepositoryGraphNode => Boolean(n));
}

/**
 * Searches across all discovered nodes in the repository graph by title or description.
 */
export function searchDiscoveredNodes(query: string, maxResults = 25): RepositoryGraphNode[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return [];

  const graph = getRepositoryGraph();
  const results: RepositoryGraphNode[] = [];

  for (const node of Object.values(graph.nodes)) {
    if (node.ref_id === '1') continue; // Skip root Magazin
    const matchTitle = (node.title || '').toLowerCase().includes(clean);
    const matchDesc = (node.description || '').toLowerCase().includes(clean);
    if (matchTitle || matchDesc) {
      results.push(node);
      if (results.length >= maxResults) break;
    }
  }

  return results;
}

/**
 * React hook for accessing and reacting to the repository graph.
 */
export function useRepositoryGraph(activeRefId?: string | null) {
  const [graph, setGraph] = useState<RepositoryGraph>(() => getRepositoryGraph());

  useEffect(() => {
    const handleUpdate = () => {
      setGraph(getRepositoryGraph());
    };

    window.addEventListener(REPOSITORY_GRAPH_UPDATED_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(REPOSITORY_GRAPH_UPDATED_EVENT, handleUpdate);
    };
  }, []);

  const currentNode = activeRefId ? graph.nodes[String(activeRefId)] || null : null;
  const children = activeRefId ? getChildren(activeRefId) : [];
  const ancestors = activeRefId ? getAncestors(activeRefId) : [];
  const siblings = activeRefId ? getSiblings(activeRefId) : [];
  const discoveredCount = Object.keys(graph.nodes).length - 1; // Exclude root

  return {
    graph,
    currentNode,
    children,
    ancestors,
    siblings,
    discoveredCount: Math.max(0, discoveredCount),
    searchDiscovered: (q: string) => searchDiscoveredNodes(q),
  };
}
