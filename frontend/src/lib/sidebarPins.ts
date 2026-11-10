import { createContext, createElement, ReactNode, useContext, useEffect, useState } from 'react';
import { cache } from './cache';
import { MaterialItem } from '../types';

export interface SidebarPin {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  href: string;
}

const changed = 'betterilias-pins-changed';
const key = () => {
  const account = cache.getSessionId();
  return account ? `betterilias_sidebar_pins_${encodeURIComponent(account)}` : null;
};

export function safePinHref(href: string): boolean {
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin && url.pathname === window.location.pathname
      ? Boolean(url.searchParams.get('course'))
      : url.protocol === 'https:' && url.hostname === 'ilias.unibe.ch';
  } catch { return false; }
}

function readPins(): SidebarPin[] {
  try {
    const storageKey = key();
    const data: unknown = storageKey ? JSON.parse(localStorage.getItem(storageKey) || '[]') : [];
    return Array.isArray(data) ? data.filter((p): p is SidebarPin => p &&
      ['id', 'courseId', 'courseTitle', 'title', 'href'].every(field => typeof p[field] === 'string') &&
      safePinHref(p.href)).slice(0, 300) : [];
  } catch { return []; }
}

export function courseHref(courseId: string, containerId = courseId, exerciseId?: string): string {
  const params = new URLSearchParams({ course: courseId });
  if (containerId !== courseId) params.set('folder', containerId);
  if (exerciseId) params.set('exercise', exerciseId);
  return `?${params}`;
}

export function materialPin(courseId: string, courseTitle: string, containerId: string, item: MaterialItem): SidebarPin | null {
  const exercise = item.item_type === 'exc' || /ilexercise|ilobjexercisegui|\/go\/exc\//i.test(item.url);
  const href = item.item_type === 'fold' ? courseHref(courseId, item.ref_id)
    : exercise ? courseHref(courseId, containerId, item.ref_id) : item.url;
  if (!href || !safePinHref(href)) return null;
  return { id: `${courseId}:item:${item.ref_id}`, courseId, courseTitle, title: item.title, href };
}

function useSidebarPinsStore() {
  const [pins, setPins] = useState(readPins);
  useEffect(() => {
    const update = () => setPins(readPins());
    window.addEventListener(changed, update);
    window.addEventListener('storage', update);
    window.addEventListener('betterilias-session-changed', update);
    return () => {
      window.removeEventListener(changed, update);
      window.removeEventListener('storage', update);
      window.removeEventListener('betterilias-session-changed', update);
    };
  }, []);
  const toggle = (pin: SidebarPin) => {
    const storageKey = key();
    if (!storageKey || !safePinHref(pin.href)) return false;
    const current = readPins();
    const next = current.some(p => p.id === pin.id) ? current.filter(p => p.id !== pin.id) : [...current, pin].slice(-300);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event(changed));
      return true;
    } catch { return false; }
  };
  return { pins, toggle, available: Boolean(key()) };
}

const PinsContext = createContext<ReturnType<typeof useSidebarPinsStore> | null>(null);
export function SidebarPinsProvider({ children }: { children: ReactNode }) {
  return createElement(PinsContext.Provider, { value: useSidebarPinsStore() }, children);
}
export function useSidebarPins() {
  const value = useContext(PinsContext);
  if (!value) throw new Error('SidebarPinsProvider missing');
  return value;
}
