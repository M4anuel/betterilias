import type { TAInfo } from '../types';

export const MAX_ASSISTANTS = 64;
export const MAX_NOTICE_LENGTH = 200;
export interface AllocationDefaults {
  version: 1;
  assistants: TAInfo[];
  priorityOrder: string[];
  nextId: number;
}

export function allocationDefaultsKey(sessionId: string | null, courseId: string | undefined, exerciseId: string): string | null {
  if (!sessionId) return null;
  return `betterilias_ta_defaults_v1:${encodeURIComponent(sessionId)}:${courseId ? 'course' : 'exercise'}:${encodeURIComponent(courseId || exerciseId)}`;
}

export function loadAllocationDefaults(key: string | null, label: (number: number) => string): AllocationDefaults {
  const fallback: AllocationDefaults = { version: 1, assistants: [1, 2].map(n => ({ id: `ta${n}`, name: label(n) })), priorityOrder: ['ta1', 'ta2'], nextId: 3 };
  if (!key) return fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    if (parsed?.version !== 1 || !Array.isArray(parsed.assistants) || !parsed.assistants.length || parsed.assistants.length > MAX_ASSISTANTS) return fallback;
    const assistants: TAInfo[] = [];
    const ids = new Set<string>();
    for (const item of parsed.assistants) {
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id)
          || typeof item.name !== 'string' || Array.from(item.name).length > 100) return fallback;
      ids.add(item.id);
      assistants.push({ id: item.id, name: item.name });
    }
    const priorityOrder = [...new Set<string>((Array.isArray(parsed.priorityOrder) ? parsed.priorityOrder : [])
      .filter((id: unknown): id is string => typeof id === 'string' && ids.has(id)))];
    assistants.forEach(item => { if (!priorityOrder.includes(item.id)) priorityOrder.push(item.id); });
    const minimum = Math.max(0, ...assistants.map(item => /^ta\d+$/.test(item.id) ? Number(item.id.slice(2)) : 0)) + 1;
    if (!Number.isSafeInteger(minimum) || minimum > 999999) return fallback;
    const nextId = Number.isSafeInteger(parsed.nextId) && parsed.nextId >= minimum && parsed.nextId < 1_000_000 ? parsed.nextId : minimum;
    return { version: 1, assistants, priorityOrder, nextId };
  } catch { return fallback; }
}

export function saveAllocationDefaults(key: string | null, value: AllocationDefaults): boolean {
  if (!key) return false;
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function allocationNoticeParts(notice: string): { id: string | null; name: string | null; human: string } {
  const match = /\[BI:([a-zA-Z0-9_-]{1,64})\|([^|\[\]\r\n]+)(?:\|[^\[\]\r\n]*)?\]$/.exec(notice);
  if (!match || match.index + match[0].length !== notice.length) return { id: null, name: null, human: notice };
  let human = notice.slice(0, match.index);
  if (human.endsWith(' ')) human = human.slice(0, -1);
  return { id: match[1], name: match[2], human };
}

export function validAssistant(assistant: TAInfo): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(assistant.id) && Boolean(assistant.name.trim()) && !/[|\[\]\r\n]/.test(assistant.name);
}

export function allocationNotice(previous: string, assistant: TAInfo): { notice: string; length: number; exceedsLimit: boolean } {
  const { human } = allocationNoticeParts(previous);
  const marker = `[BI:${assistant.id.trim()}|${assistant.name.trim()}]`;
  const notice = human ? `${human} ${marker}` : marker;
  const length = Array.from(notice).length;
  return { notice, length, exceedsLimit: length > MAX_NOTICE_LENGTH };
}
