import { useEffect, useState } from 'react';
import { sessionFetch, apiError } from './api';
import { t } from './i18n';

export type DownloadState = 'preparing' | 'downloading' | 'saving' | 'completed' | 'error';

export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  totalBytes: number | null;
  loadedBytes: number;
  percent: number | null; // 0..100
  state: DownloadState;
  errorMessage?: string;
  startTime: number;
  abortController?: AbortController;
}

export interface StartDownloadOptions {
  fallbackFilename?: string;
  knownSize?: number | string;
}

export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, safeI)).toFixed(dm))} ${sizes[safeI]}`;
}

export function parseSizeStringToBytes(sizeStr?: number | string): number | null {
  if (typeof sizeStr === 'number') {
    return isNaN(sizeStr) || sizeStr < 0 ? null : sizeStr;
  }
  if (!sizeStr || typeof sizeStr !== 'string') return null;

  const match = sizeStr.trim().match(/^([\d.,]+)\s*([a-zA-Z]+)?$/);
  if (!match) return null;

  const rawNum = parseFloat(match[1].replace(',', '.'));
  if (isNaN(rawNum)) return null;

  const unit = (match[2] || 'B').toUpperCase();
  if (unit.startsWith('K')) return Math.round(rawNum * 1024);
  if (unit.startsWith('M')) return Math.round(rawNum * 1024 * 1024);
  if (unit.startsWith('G')) return Math.round(rawNum * 1024 * 1024 * 1024);
  return Math.round(rawNum);
}

function parseFilenameFromContentDisposition(disposition?: string | null, fallback?: string): string {
  if (!disposition) return fallback || 'download';

  // Try filename*=UTF-8''... RFC 5987
  const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  // Try standard filename="..." or filename=...
  const match = disposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  if (match) {
    const raw = (match[1] || match[2] || '').trim();
    if (raw) return raw;
  }

  return fallback || 'download';
}

class DownloadManagerService {
  private items = new Map<string, DownloadItem>();
  private listeners = new Set<() => void>();
  private cleanupTimers = new Map<string, any>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getAll(): DownloadItem[] {
    return Array.from(this.items.values()).sort((a, b) => b.startTime - a.startTime);
  }

  get(idOrUrl: string): DownloadItem | undefined {
    const matches = Array.from(this.items.values()).filter(item => item.url === idOrUrl);
    return this.items.get(idOrUrl) || matches.find(item => ['preparing', 'downloading', 'saving'].includes(item.state)) || matches[0];
  }

  cancel(id: string) {
    const item = this.get(id);
    if (!item) return;

    if (item.abortController && (item.state === 'preparing' || item.state === 'downloading')) {
      item.abortController.abort();
    }

    this.items.delete(item.id);
    if (this.cleanupTimers.has(item.id)) {
      clearTimeout(this.cleanupTimers.get(item.id));
      this.cleanupTimers.delete(item.id);
    }
    this.notify();
  }

  clear(id: string) {
    const item = this.get(id);
    if (!item) return;
    this.items.delete(item.id);
    if (this.cleanupTimers.has(item.id)) {
      clearTimeout(this.cleanupTimers.get(item.id));
      this.cleanupTimers.delete(item.id);
    }
    this.notify();
  }

  async startDownload(url: string, options?: StartDownloadOptions): Promise<void> {
    const existing = this.get(url);
    if (existing && ['preparing', 'downloading', 'saving'].includes(existing.state)) {
      return; // Already in flight
    }

    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const parsedKnown = parseSizeStringToBytes(options?.knownSize);
    const controller = new AbortController();

    const fallbackName = options?.fallbackFilename || url.split('?')[0].split('/').pop() || 'download';

    const item: DownloadItem = {
      id: downloadId,
      url,
      filename: fallbackName,
      totalBytes: parsedKnown,
      loadedBytes: 0,
      percent: null,
      state: 'preparing',
      startTime: Date.now(),
      abortController: controller,
    };

    this.items.set(downloadId, item);
    this.notify();

    let lastNotifyTime = 0;

    try {
      const response = await sessionFetch(url, {
        signal: controller.signal,
        trackPending: false,
      });

      if (!response.ok) {
        let errorDetail = '';
        try {
          const errJson = await response.json();
          errorDetail = apiError(errJson) || '';
        } catch {
          errorDetail = response.statusText || t('Download fehlgeschlagen (HTTP {p0})', { p0: response.status });
        }
        item.state = 'error';
        item.errorMessage = errorDetail || t('Download fehlgeschlagen');
        this.notify();
        this.scheduleCleanup(downloadId, 6000);
        return;
      }

      // Read Content-Disposition for exact filename
      const contentDisp = response.headers.get('content-disposition');
      const resolvedFilename = parseFilenameFromContentDisposition(contentDisp, item.filename);
      item.filename = resolvedFilename;

      // Read Content-Length before streaming begins
      const clHeader = response.headers.get('content-length');
      let total: number | null = null;
      if (clHeader) {
        const parsedCl = parseInt(clHeader, 10);
        if (!isNaN(parsedCl) && parsedCl > 0) {
          total = parsedCl;
        }
      }
      if (total === null && parsedKnown) {
        total = parsedKnown;
      }

      item.totalBytes = total;
      item.state = 'downloading';
      item.percent = total && total > 0 ? 0 : null;
      this.notify();

      // Read response body as stream
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedBytes += value.length;
            item.loadedBytes = receivedBytes;
            if (item.totalBytes && item.totalBytes > 0) {
              item.percent = Math.min(100, Math.round((receivedBytes / item.totalBytes) * 100));
            }

            const now = performance.now();
            if (now - lastNotifyTime > 60) {
              lastNotifyTime = now;
              this.notify();
            }
          }
        }
      } else {
        // Fallback if reader not supported
        const blob = await response.blob();
        chunks.push(new Uint8Array(await blob.arrayBuffer()));
        receivedBytes = blob.size;
        item.loadedBytes = receivedBytes;
        item.percent = 100;
      }

      // Stream completed, trigger saving
      item.state = 'saving';
      item.percent = 100;
      item.loadedBytes = receivedBytes;
      if (!item.totalBytes) {
        item.totalBytes = receivedBytes;
      }
      this.notify();

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const fileBlob = new Blob(chunks as BlobPart[], { type: contentType });
      const objectUrl = URL.createObjectURL(fileBlob);

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = item.filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 15000);

      item.state = 'completed';
      this.notify();
      this.scheduleCleanup(downloadId, 4000);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User aborted, removed already
        return;
      }
      item.state = 'error';
      item.errorMessage = err.message || t('Download fehlgeschlagen');
      this.notify();
      this.scheduleCleanup(downloadId, 6000);
    }
  }

  private scheduleCleanup(id: string, delayMs: number) {
    if (this.cleanupTimers.has(id)) {
      clearTimeout(this.cleanupTimers.get(id));
    }
    const timer = setTimeout(() => {
      this.items.delete(id);
      this.cleanupTimers.delete(id);
      this.notify();
    }, delayMs);
    this.cleanupTimers.set(id, timer);
  }
}

export const downloadManager = new DownloadManagerService();

/**
 * Hook to get all active downloads (for global floating progress bar).
 */
export function useDownloads(): DownloadItem[] {
  const [items, setItems] = useState<DownloadItem[]>(() => downloadManager.getAll());

  useEffect(() => {
    return downloadManager.subscribe(() => {
      setItems(downloadManager.getAll());
    });
  }, []);

  return items;
}

/**
 * Hook to get the download state for a specific URL or download ID (for in-button feedback).
 */
export function useDownloadItem(urlOrId?: string): DownloadItem | undefined {
  const [item, setItem] = useState<DownloadItem | undefined>(() => (urlOrId ? downloadManager.get(urlOrId) : undefined));

  useEffect(() => {
    if (!urlOrId) {
      setItem(undefined);
      return;
    }
    const update = () => {
      setItem(downloadManager.get(urlOrId));
    };
    update();
    return downloadManager.subscribe(update);
  }, [urlOrId]);

  return item;
}
