import { ErrorNotice } from './ErrorNotice';
import { useConnectionRetry } from '../lib/connection';
import { t, useLanguage } from '../lib/i18n';
import React, { useEffect, useState, useMemo } from 'react';
import { ChevronRight, Folder, Home, Lock, Search, X, FolderTree, ArrowRight, Layers } from 'lucide-react';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { RepositoryResponse, MembershipAction } from '../types';
import { CourseIcon } from './CourseIcon';
import { SyncRefreshControl } from './SyncRefreshControl';
import {
  ingestRepositoryResponse,
  useRepositoryGraph,
  formatRepositoryCounts,
  RepositoryGraphNode,
} from '../lib/repositoryGraph';

interface Props {
  refId: string;
  onNavigate: (refId: string) => void;
  onOpenCourse: (refId: string) => void;
  onManageMembership: (refId: string, title: string, action: MembershipAction) => void;
}

export const RepositoryView: React.FC<Props> = ({ refId, onNavigate, onOpenCourse, onManageMembership }) => {
  useLanguage();
  const [data, setData] = useState<RepositoryResponse | null>(() => {
    const cached = cache.getCachedRepository(refId);
    if (cached) {
      ingestRepositoryResponse(cached);
    }
    return cached;
  });
  const [location] = useState(() => cache.getRepositoryLocation(refId));
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [revision, setRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTree, setShowTree] = useState(false);

  useConnectionRetry(() => setRevision((value) => value + 1));

  // Access the reactive lazy repository graph
  const { currentNode, ancestors, siblings, children, discoveredCount, searchDiscovered } = useRepositoryGraph(refId);

  useEffect(() => {
    let active = true;
    setError(null);
    setIsRefreshing(true);
    api
      .getRepository(refId)
      .then((next) => {
        if (active) {
          cache.setCachedRepository(next);
          ingestRepositoryResponse(next);
          setData(next);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setIsRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [refId, revision]);

  const crumbs = (data?.breadcrumbs || location?.breadcrumbs || []).filter((b) => b.ref_id !== '1');
  const title = data?.title || location?.title;

  // Search results from discovered graph nodes
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchDiscovered(searchQuery);
  }, [searchQuery, searchDiscovered]);

  const handleSelectNode = (node: RepositoryGraphNode) => {
    setSearchQuery('');
    if (node.item_type === 'crs') {
      onOpenCourse(node.ref_id);
    } else {
      onNavigate(node.ref_id);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      {/* Breadcrumb Navigation */}
      <nav aria-label={t("Magazin-Pfad")} className="flex items-center flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
        <button
          type="button"
          onClick={() => onNavigate('1')}
          aria-label={t("Magazin öffnen")}
          className="p-1 hover:text-teal-600 dark:hover:text-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500 rounded"
        >
          <Home className="h-4 w-4" />
        </button>
        {crumbs.map((crumb, index) => (
          <React.Fragment key={`${crumb.ref_id}-${index}`}>
            <ChevronRight className="h-3 w-3 text-slate-400" aria-hidden="true" />
            <button
              type="button"
              onClick={() => crumb.ref_id && onNavigate(crumb.ref_id)}
              disabled={!crumb.ref_id}
              aria-current={crumb.ref_id === refId ? 'page' : undefined}
              className="hover:underline font-medium text-slate-700 dark:text-slate-200 disabled:opacity-60"
            >
              {crumb.title}
            </button>
          </React.Fragment>
        ))}
      </nav>

      {/* Header with Title, Stats, Tree Toggle, and Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {title || <span aria-label={t("Titel wird geladen")} className="block h-8 w-48 rounded bg-slate-200 dark:bg-slate-800" />}
          </h1>
          {currentNode?.item_counts && currentNode.item_counts.total > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {formatRepositoryCounts(currentNode.item_counts)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {discoveredCount > 0 && (
            <button
              type="button"
              onClick={() => setShowTree((prev) => !prev)}
              aria-expanded={showTree}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                showTree
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <FolderTree className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
              <span>{showTree ? t("repository.hide_tree") : t("repository.show_tree")}</span>
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">
                {discoveredCount}
              </span>
            </button>
          )}
          <SyncRefreshControl
            isSyncing={isRefreshing}
            onRefresh={() => setRevision((v) => v + 1)}
            title={t("Magazin aktualisieren")}
            ariaLabel={t("Magazin aktualisieren")}
          />
        </div>
      </div>

      {/* Error Notice */}
      {error && <ErrorNotice message={error} onRetry={() => setRevision((value) => value + 1)} />}

      {/* Search Bar across discovered repository graph */}
      {discoveredCount > 1 && (
        <div className="relative">
          <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 transition-all">
            <Search className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("repository.search_placeholder")}
              className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={t("repository.clear_search")}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Discovered Tree Explorer Drawer / Panel */}
      {showTree && (
        <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 backdrop-blur space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <FolderTree className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("repository.tree_title")}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("repository.tree_description")}</p>
              </div>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-teal-100/70 dark:bg-teal-900/40 text-teal-800 dark:text-teal-300">
              {discoveredCount} {t("repository.discovered_badge")}
            </span>
          </div>

          {/* Ancestor Lineage */}
          {ancestors.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {t("repository.path")}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {ancestors.map((anc) => (
                  <button
                    key={anc.ref_id}
                    type="button"
                    onClick={() => onNavigate(anc.ref_id)}
                    className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-teal-500 font-medium transition-colors"
                  >
                    {anc.title}
                  </button>
                ))}
                <span className="px-2.5 py-1 rounded-md bg-teal-600 text-white font-bold">
                  {title || currentNode?.title}
                </span>
              </div>
            </div>
          )}

          {/* Sibling Categories */}
          {siblings.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {t("repository.siblings_title")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {siblings.map((sib) => (
                  <button
                    key={sib.ref_id}
                    type="button"
                    onClick={() => handleSelectNode(sib)}
                    className="px-2.5 py-1 text-xs rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-teal-600 dark:hover:text-teal-400 hover:border-teal-500 transition-colors flex items-center gap-1.5"
                  >
                    <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span>{sib.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Discovered Children in Current Node */}
          {children.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {t("repository.subcategories")} ({children.length})
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {children.map((child) => (
                  <button
                    key={child.ref_id}
                    type="button"
                    onClick={() => handleSelectNode(child)}
                    className="flex items-center justify-between p-2.5 text-xs text-left rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-teal-500 transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {child.item_type === 'crs' ? (
                        <CourseIcon iconName={cache.getCourseIcon(child.ref_id)} className="h-4 w-4 text-teal-600 shrink-0" />
                      ) : (
                        <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                      )}
                      <span className="font-semibold truncate text-slate-800 dark:text-slate-200">{child.title}</span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-teal-500 transition-colors shrink-0 ml-1" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Discovered Search Results (when active) */}
      {searchQuery.trim() ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300">
              {t("repository.search_results")} ({searchResults.length})
            </h2>
          </div>
          {searchResults.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">{t("repository.no_matches")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {searchResults.map((node) => {
                const pathStr = (node.path_titles || []).slice(0, -1).join(' > ');
                return (
                  <button
                    key={node.ref_id}
                    type="button"
                    onClick={() => handleSelectNode(node)}
                    className="flex flex-col items-start gap-1 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-left text-sm hover:border-teal-500 transition-colors"
                  >
                    <div className="flex items-center gap-2 w-full">
                      {node.item_type === 'crs' ? (
                        <CourseIcon iconName={cache.getCourseIcon(node.ref_id)} className="h-5 w-5 text-teal-600 shrink-0" />
                      ) : (
                        <Folder className="h-5 w-5 text-amber-500 shrink-0" />
                      )}
                      <span className="font-bold text-slate-900 dark:text-white truncate">{node.title}</span>
                    </div>
                    {pathStr && <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate w-full">{pathStr}</span>}
                    {node.description && <span className="text-xs text-slate-500 line-clamp-2">{node.description}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Normal Items Grid */
        <div>
          {!data ? (
            !error && <p role="status" className="text-slate-500 text-sm">{t("Inhalte werden geladen…")}</p>
          ) : data.items.length === 0 ? (
            <p className="text-slate-500 text-sm">{t("Keine sichtbaren Einträge vorhanden.")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((item) => {
                const container = ['cat', 'fold', 'grp', 'crs'].includes(item.item_type);
                const content = (
                  <>
                    {!item.accessible ? (
                      <Lock className="h-5 w-5 shrink-0 text-slate-400" />
                    ) : item.item_type === 'crs' ? (
                      <CourseIcon
                        iconName={cache.getCourseIcon(item.ref_id, { breadcrumbs: data.breadcrumbs })}
                        className="h-5 w-5 shrink-0 text-teal-600"
                      />
                    ) : (
                      <Folder className="h-5 w-5 shrink-0 text-amber-500" />
                    )}
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-900 dark:text-white">{item.title}</span>
                      {item.description && <span className="block text-xs text-slate-500 mt-1">{item.description}</span>}
                      {!item.accessible && (
                        <span className="block text-xs text-slate-500 mt-1">{t("Inhalt nicht zugänglich")}</span>
                      )}
                    </span>
                  </>
                );
                const className =
                  'flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left text-sm hover:border-teal-500 disabled:opacity-60 disabled:cursor-default transition-colors';
                return container || !item.accessible ? (
                  <div key={item.ref_id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <button
                      type="button"
                      disabled={!item.accessible}
                      className={`${className} w-full !border-0`}
                      onClick={() => (item.item_type === 'crs' ? onOpenCourse(item.ref_id) : onNavigate(item.ref_id))}
                    >
                      {content}
                    </button>
                    {(item.membership?.can_join || item.membership?.can_leave) && (
                      <button
                        type="button"
                        onClick={() =>
                          onManageMembership(item.ref_id, item.title, item.membership?.can_join ? 'join' : 'leave')
                        }
                        aria-label={`${item.membership?.can_join ? t("Kurs beitreten") : t("Kurs verlassen")}: ${item.title}`}
                        className="mx-4 mb-3 text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline"
                      >
                        {item.membership?.can_join ? t("Kurs beitreten") : t("Kurs verlassen")}
                      </button>
                    )}
                  </div>
                ) : (
                  <a
                    key={item.ref_id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className={className}
                  >
                    {content}
                    <span className="sr-only">{t("In ILIAS öffnen")}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
