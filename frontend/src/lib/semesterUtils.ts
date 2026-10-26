import { t } from './i18n';

export interface SemesterOption {
  id: string;
  short: string;
  full: string;
  term: 'FS' | 'HS';
  year: number;
  isCurrent?: boolean;
  isPreview?: boolean;
}

export function parseSemesterId(semId: string): { term: 'FS' | 'HS'; year: number } | null {
  if (!semId) return null;
  const match = semId.trim().match(/^(FS|HS)\s*(\d{4})$/i);
  if (!match) return null;
  return {
    term: match[1].toUpperCase() as 'FS' | 'HS',
    year: parseInt(match[2], 10),
  };
}

export function getSemesterOrderKey(semId: string): number {
  const parsed = parseSemesterId(semId);
  if (!parsed) return 0;
  return parsed.year * 2 + (parsed.term === 'HS' ? 1 : 0);
}

export function getNextSemester(semId: string): string {
  const parsed = parseSemesterId(semId);
  if (!parsed) return semId;
  return parsed.term === 'FS' ? `HS${parsed.year}` : `FS${parsed.year + 1}`;
}

export function getPreviousSemester(semId: string): string {
  const parsed = parseSemesterId(semId);
  if (!parsed) return semId;
  return parsed.term === 'HS' ? `FS${parsed.year}` : `HS${parsed.year - 1}`;
}

export function getCurrentSemester(): string {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() >= 7 ? `HS${year}` : `FS${year}`;
}

export function getPreviewSemester(currentSemId: string = getCurrentSemester()): string {
  return getNextSemester(currentSemId);
}

/**
 * Default start semester is HS 5 years ago (e.g. HS2021).
 */
export function getDefaultStartSemester(): string {
  const currentYear = new Date().getFullYear();
  return `HS${currentYear - 5}`;
}

export function getSemesterOption(
  semId: string,
  options?: { currentSemId?: string; previewSemId?: string }
): SemesterOption {
  const currentSemId = options?.currentSemId || getCurrentSemester();
  const previewSemId = options?.previewSemId || getPreviewSemester(currentSemId);
  const parsed = parseSemesterId(semId) || { term: 'HS' as const, year: 2026 };

  const isCurrent = semId === currentSemId;
  const isPreview = semId === previewSemId;
  return {
    id: semId,
    get short() {
      const termShort = t(parsed.term === 'HS' ? 'semester.short_autumn' : 'semester.short_spring');
      return `${termShort} ${parsed.year}`;
    },
    get full() {
      const termName = t(parsed.term === 'HS' ? 'semester.autumn' : 'semester.spring');
      const suffix = isCurrent ? ` (${t('semester.current')})` : isPreview ? ` (${t('semester.preview')})` : '';
      return `${termName} ${parsed.year}${suffix}`;
    },
    term: parsed.term,
    year: parsed.year,
    isCurrent,
    isPreview,
  };
}

/**
 * Generates semesters from preview down to startSemester (default: HS 5 years ago).
 * Grouped cleanly into current/preview and past semesters without any archive splitting.
 */
export function generateSemesterList(
  startSemId: string = getDefaultStartSemester(),
  currentSemId: string = getCurrentSemester()
): { all: SemesterOption[]; currentAndPreview: SemesterOption[]; past: SemesterOption[] } {
  const previewSemId = getPreviewSemester(currentSemId);
  const currentOrder = getSemesterOrderKey(currentSemId);
  const startOrder = getSemesterOrderKey(startSemId);

  const all: SemesterOption[] = [];
  const currentAndPreview: SemesterOption[] = [];
  const past: SemesterOption[] = [];

  let curr = previewSemId;
  for (let i = 0; i < 35; i++) {
    const opt = getSemesterOption(curr, { currentSemId, previewSemId });
    all.push(opt);

    if (getSemesterOrderKey(curr) >= currentOrder) {
      currentAndPreview.push(opt);
    } else {
      past.push(opt);
    }

    if (getSemesterOrderKey(curr) <= startOrder) {
      break;
    }
    curr = getPreviousSemester(curr);
  }

  return { all, currentAndPreview, past };
}

/**
 * Semesters available to choose as start in the modal dialog.
 */
export function getAvailableStartSemesters(currentSemId: string = getCurrentSemester()): SemesterOption[] {
  const list: SemesterOption[] = [];
  let curr = currentSemId;
  const lowest = 'FS2012';

  for (let i = 0; i < 35; i++) {
    list.push(getSemesterOption(curr, { currentSemId }));
    if (curr === lowest) break;
    curr = getPreviousSemester(curr);
  }

  return list;
}
