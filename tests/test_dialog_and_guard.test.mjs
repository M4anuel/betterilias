import test from 'node:test';
import assert from 'node:assert/strict';

// Test simulation of dialog system and NavigationGuardManager logic
class TestDialogSystem {
  constructor() {
    this.listener = null;
    this.idSeq = 0;
  }

  registerDialogListener(listener) {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  confirmDialog(options) {
    if (!this.listener) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      this.listener({
        ...options,
        id: ++this.idSeq,
        resolve,
      });
    });
  }

  alertDialog(options) {
    return this.confirmDialog({
      ...options,
      isAlert: true,
      confirmLabel: options.buttonLabel || 'OK',
    }).then(() => {});
  }
}

class TestNavigationGuardManager {
  constructor(dialogSystem) {
    this.guards = new Map();
    this.activePendingMutations = 0;
    this.dialogSystem = dialogSystem;
  }

  register(guard) {
    this.guards.set(guard.id, guard);
    return () => {
      this.guards.delete(guard.id);
    };
  }

  evaluateBool(val) {
    if (typeof val === 'function') return Boolean(val());
    return Boolean(val);
  }

  hasPendingOperations() {
    if (this.activePendingMutations > 0) return true;
    for (const guard of this.guards.values()) {
      if (this.evaluateBool(guard.isPending)) return true;
    }
    return false;
  }

  hasUnsavedChanges() {
    for (const guard of this.guards.values()) {
      if (this.evaluateBool(guard.isDirty)) return true;
    }
    return false;
  }

  getWarningMessage() {
    if (this.hasPendingOperations()) {
      return 'Ein Vorgang oder Upload wird gerade ausgeführt.';
    }
    for (const guard of this.guards.values()) {
      if (this.evaluateBool(guard.isDirty)) {
        if (typeof guard.message === 'function') return guard.message();
        if (typeof guard.message === 'string') return guard.message;
        return 'Sie haben ungespeicherte Änderungen.';
      }
    }
    return null;
  }

  async confirmNavigation() {
    const msg = this.getWarningMessage();
    if (!msg) return true;

    const isPending = this.hasPendingOperations();
    const confirmed = await this.dialogSystem.confirmDialog({
      title: isPending ? 'Vorgang abbrechen?' : 'Ungespeicherte Änderungen',
      message: msg,
      confirmLabel: isPending ? 'Trotzdem verlassen' : 'Änderungen verwerfen',
      cancelLabel: 'Auf Seite bleiben',
      variant: 'warning',
    });

    if (confirmed) {
      this.discardDirtyChanges();
    }
    return confirmed;
  }

  discardDirtyChanges() {
    for (const guard of this.guards.values()) {
      if (this.evaluateBool(guard.isDirty)) {
        try {
          guard.onDiscard?.();
        } catch (e) {
          console.error(e);
        }
      }
    }
  }
}

test('dialog system registers listeners, shows custom modal payload, and resolves answers', async () => {
  const dialog = new TestDialogSystem();
  let receivedState = null;

  const unregister = dialog.registerDialogListener((state) => {
    receivedState = state;
  });

  const promise = dialog.confirmDialog({
    title: 'Custom Warning Title',
    message: 'Custom warning message test',
    variant: 'danger',
    confirmLabel: 'Löschen',
    cancelLabel: 'Abbrechen',
  });

  assert.ok(receivedState);
  assert.equal(receivedState.title, 'Custom Warning Title');
  assert.equal(receivedState.message, 'Custom warning message test');
  assert.equal(receivedState.variant, 'danger');
  assert.equal(receivedState.confirmLabel, 'Löschen');

  // Simulate user clicking confirm
  receivedState.resolve(true);
  const result = await promise;
  assert.equal(result, true);

  unregister();
});

test('dialog system handles alert modal resolving to void', async () => {
  const dialog = new TestDialogSystem();
  let receivedState = null;

  dialog.registerDialogListener((state) => {
    receivedState = state;
  });

  const alertPromise = dialog.alertDialog({
    title: 'Fehler',
    message: 'Etwas ist schiefgelaufen',
    variant: 'danger',
  });

  assert.ok(receivedState);
  assert.equal(receivedState.isAlert, true);
  assert.equal(receivedState.confirmLabel, 'OK');

  receivedState.resolve(true);
  await alertPromise;
});

test('navigation guard suppresses warning when no state is dirty', async () => {
  const dialog = new TestDialogSystem();
  const guardManager = new TestNavigationGuardManager(dialog);

  let prompted = false;
  dialog.registerDialogListener(() => {
    prompted = true;
  });

  guardManager.register({
    id: 'clean-guard',
    isDirty: false,
  });

  const canNavigate = await guardManager.confirmNavigation();
  assert.equal(canNavigate, true);
  assert.equal(prompted, false);
});

test('navigation guard prompts on dirty state, resets dirty state on discard, preventing duplicate warnings', async () => {
  const dialog = new TestDialogSystem();
  const guardManager = new TestNavigationGuardManager(dialog);

  let isExerciseDirty = true;
  let discardCallbackInvoked = false;

  guardManager.register({
    id: 'exercise-guard-test',
    isDirty: () => isExerciseDirty,
    onDiscard: () => {
      discardCallbackInvoked = true;
      isExerciseDirty = false;
    },
  });

  let promptCount = 0;
  dialog.registerDialogListener((state) => {
    if (state) {
      promptCount++;
      // Auto confirm user discarding changes
      state.resolve(true);
    }
  });

  // First navigation attempt (e.g. child tab switch)
  const firstNav = await guardManager.confirmNavigation();
  assert.equal(firstNav, true);
  assert.equal(discardCallbackInvoked, true, 'onDiscard must be invoked when user confirms navigation');
  assert.equal(isExerciseDirty, false, 'dirty state must be reset to false');
  assert.equal(promptCount, 1, 'Should have prompted exactly once');

  // Second navigation attempt immediately following (e.g. parent handler or subsequent course navigation)
  const secondNav = await guardManager.confirmNavigation();
  assert.equal(secondNav, true);
  assert.equal(promptCount, 1, 'Should NOT prompt twice because dirty state was cleanly discarded!');
});

test('navigation guard does not invoke onDiscard if user cancels modal', async () => {
  const dialog = new TestDialogSystem();
  const guardManager = new TestNavigationGuardManager(dialog);

  let isDirty = true;
  let discarded = false;

  guardManager.register({
    id: 'cancel-guard-test',
    isDirty: () => isDirty,
    onDiscard: () => {
      discarded = true;
    },
  });

  dialog.registerDialogListener((state) => {
    if (state) {
      // User clicks "Auf Seite bleiben" (cancel)
      state.resolve(false);
    }
  });

  const canNav = await guardManager.confirmNavigation();
  assert.equal(canNav, false);
  assert.equal(discarded, false, 'onDiscard must NOT be invoked when user cancels');
  assert.equal(isDirty, true, 'state must remain dirty');
});
