export const PWA_UPDATE_CHECK_INTERVAL_MS = 60_000;

let updateAvailable = false;
const updateListeners = new Set<() => void>();

export const isPwaUpdateAvailable = () => updateAvailable;
export const subscribeToPwaUpdate = (listener: () => void) => {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
};

interface PwaServiceWorkerRegistration {
  update: () => Promise<unknown>;
}

interface PwaServiceWorkerContainer {
  controller: unknown | null;
  ready: Promise<PwaServiceWorkerRegistration>;
  addEventListener: (type: 'controllerchange', listener: EventListener) => void;
  removeEventListener: (
    type: 'controllerchange',
    listener: EventListener
  ) => void;
}

export interface PwaReleaseRefreshRuntime {
  getServiceWorker: () => PwaServiceWorkerContainer | null;
  notifyUpdateAvailable: () => void;
  startInterval: (callback: () => void, delay: number) => unknown;
  clearInterval: (intervalId: unknown) => void;
}

export const pwaReleaseRefreshRuntime: PwaReleaseRefreshRuntime = {
  getServiceWorker: () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    return navigator.serviceWorker;
  },
  notifyUpdateAvailable: () => {
    updateAvailable = true;
    updateListeners.forEach((listener) => listener());
  },
  startInterval: (callback, delay) => window.setInterval(callback, delay),
  clearInterval: (intervalId) => window.clearInterval(intervalId as number),
};

/**
 * Keeps long-lived PWA tabs aligned with the frontend version deployed on the
 * server. Vite's auto-update service worker claims clients immediately, but an
 * already-rendered React page otherwise continues running its old JavaScript
 * until the user reloads it manually.
 */
export const startPwaReleaseRefresh = (
  runtime: PwaReleaseRefreshRuntime = pwaReleaseRefreshRuntime
): (() => void) => {
  const serviceWorker = runtime.getServiceWorker();
  if (!serviceWorker) {
    return () => undefined;
  }

  let hasController = serviceWorker.controller !== null;
  let updateNotified = false;
  let stopped = false;
  let intervalId: unknown;

  const handleControllerChange: EventListener = () => {
    if (stopped || updateNotified) {
      return;
    }
    if (!hasController) {
      hasController = true;
      return;
    }

    updateNotified = true;
    runtime.notifyUpdateAvailable();
  };

  serviceWorker.addEventListener('controllerchange', handleControllerChange);

  void serviceWorker.ready
    .then((registration) => {
      if (stopped) {
        return;
      }

      const checkForUpdate = () => {
        void Promise.resolve()
          .then(() => registration.update())
          .catch(() => undefined);
      };

      checkForUpdate();
      intervalId = runtime.startInterval(
        checkForUpdate,
        PWA_UPDATE_CHECK_INTERVAL_MS
      );
    })
    .catch(() => undefined);

  return () => {
    stopped = true;
    serviceWorker.removeEventListener(
      'controllerchange',
      handleControllerChange
    );
    if (intervalId !== undefined) {
      runtime.clearInterval(intervalId);
    }
  };
};
