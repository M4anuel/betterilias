import { t } from './i18n';
import { useEffect, useRef } from 'react';

export interface GuardItem {
  id: string;
  isDirty?: boolean | (() => boolean);
  isPending?: boolean | (() => boolean);
  message?: string | (() => string);
}

export interface GuardOptions {
  id?: string;
  isDirty?: boolean | (() => boolean);
  isPending?: boolean | (() => boolean);
  message?: string | (() => string);
}

function evaluateBool(val?: boolean | (() => boolean)): boolean {
  if (typeof val === 'function') return Boolean(val());
  return Boolean(val);
}

class NavigationGuardManager {
  private guards = new Map<string, GuardItem>();
  private activePendingMutations = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
        const msg = this.getWarningMessage();
        if (msg) {
          e.preventDefault();
          e.returnValue = msg;
          return msg;
        }
      });
    }
  }

  public register(guard: GuardItem): () => void {
    this.guards.set(guard.id, guard);
    return () => {
      this.guards.delete(guard.id);
    };
  }

  public incrementPending(): void {
    this.activePendingMutations++;
  }

  public decrementPending(): void {
    this.activePendingMutations = Math.max(0, this.activePendingMutations - 1);
  }

  public getPendingCount(): number {
    return this.activePendingMutations;
  }

  public hasPendingOperations(): boolean {
    if (this.activePendingMutations > 0) return true;
    for (const guard of this.guards.values()) {
      if (evaluateBool(guard.isPending)) return true;
    }
    return false;
  }

  public hasUnsavedChanges(): boolean {
    for (const guard of this.guards.values()) {
      if (evaluateBool(guard.isDirty)) return true;
    }
    return false;
  }

  public getWarningMessage(): string | null {
    if (this.hasPendingOperations()) {
      return t(
        "Ein Vorgang oder Upload wird gerade ausgeführt. Wenn Sie die Seite jetzt verlassen, wird er möglicherweise abgebrochen. Möchten Sie wirklich fortfahren?"
      );
    }
    for (const guard of this.guards.values()) {
      if (evaluateBool(guard.isDirty)) {
        if (typeof guard.message === 'function') {
          return guard.message();
        }
        if (typeof guard.message === 'string') {
          return guard.message;
        }
        return t(
          "Sie haben ungespeicherte Änderungen. Möchten Sie die Seite wirklich verlassen und Ihre Änderungen verwerfen?"
        );
      }
    }
    return null;
  }

  public confirmNavigation(): boolean {
    const msg = this.getWarningMessage();
    if (!msg) return true;
    return window.confirm(msg);
  }
}

export const navigationGuard = new NavigationGuardManager();

let guardCounter = 0;

export function useNavigationGuard(guard: GuardOptions): void {
  const guardRef = useRef(guard);
  guardRef.current = guard;

  const idRef = useRef<string>(guard.id || `guard_${++guardCounter}`);

  useEffect(() => {
    const id = idRef.current;
    return navigationGuard.register({
      id,
      isDirty: () => evaluateBool(guardRef.current.isDirty),
      isPending: () => evaluateBool(guardRef.current.isPending),
      message: () => {
        const m = guardRef.current.message;
        if (typeof m === 'function') return m();
        return (
          m ||
          t(
            "Sie haben ungespeicherte Änderungen. Möchten Sie die Seite wirklich verlassen und Ihre Änderungen verwerfen?"
          )
        );
      },
    });
  }, []);
}
