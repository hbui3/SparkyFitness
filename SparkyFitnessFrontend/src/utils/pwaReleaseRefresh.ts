export const PWA_UPDATE_CHECK_INTERVAL_MS = 60_000;

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
  reloadWindowLocation: () => void;
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
  reloadWindowLocation: () => window.location.reload(),
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

  const hadControllerAtStartup = serviceWorker.controller !== null;
  let reloadStarted = false;
  let stopped = false;
  let intervalId: unknown;

  const handleControllerChange: EventListener = () => {
    if (!hadControllerAtStartup || reloadStarted || stopped) {
      return;
    }

    reloadStarted = true;
    runtime.reloadWindowLocation();
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
