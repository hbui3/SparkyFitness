import {
  PWA_UPDATE_CHECK_INTERVAL_MS,
  type PwaReleaseRefreshRuntime,
  startPwaReleaseRefresh,
} from '@/utils/pwaReleaseRefresh';

interface ServiceWorkerHarness {
  runtime: PwaReleaseRefreshRuntime;
  update: jest.Mock<Promise<void>, []>;
  notify: jest.Mock<void, []>;
  startInterval: jest.Mock<unknown, [() => void, number]>;
  clearInterval: jest.Mock<void, [unknown]>;
  emitControllerChange: () => void;
}

const createServiceWorkerHarness = (
  hasController = true
): ServiceWorkerHarness => {
  let controllerChangeListener: EventListener | undefined;
  const update = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const notify = jest.fn<void, []>();
  const intervalId = Symbol('pwa-update-interval');
  const startInterval = jest
    .fn<unknown, [() => void, number]>()
    .mockReturnValue(intervalId);
  const clearInterval = jest.fn<void, [unknown]>();

  return {
    runtime: {
      getServiceWorker: () => ({
        controller: hasController ? {} : null,
        ready: Promise.resolve({ update }),
        addEventListener: (_type, listener) => {
          controllerChangeListener = listener;
        },
        removeEventListener: (_type, listener) => {
          if (controllerChangeListener === listener) {
            controllerChangeListener = undefined;
          }
        },
      }),
      notifyUpdateAvailable: notify,
      startInterval,
      clearInterval,
    },
    update,
    notify,
    startInterval,
    clearInterval,
    emitControllerChange: () =>
      controllerChangeListener?.(new Event('controllerchange')),
  };
};

describe('pwaReleaseRefresh', () => {
  it('checks immediately, polls, and notifies once without reloading when an update takes control', async () => {
    const harness = createServiceWorkerHarness();

    const stop = startPwaReleaseRefresh(harness.runtime);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.startInterval).toHaveBeenCalledWith(
      expect.any(Function),
      PWA_UPDATE_CHECK_INTERVAL_MS
    );

    harness.emitControllerChange();
    harness.emitControllerChange();

    expect(harness.notify).toHaveBeenCalledTimes(1);

    stop();
    expect(harness.clearInterval).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the first service worker is installed', async () => {
    const harness = createServiceWorkerHarness(false);

    startPwaReleaseRefresh(harness.runtime);
    await Promise.resolve();

    harness.emitControllerChange();

    expect(harness.notify).not.toHaveBeenCalled();
    harness.emitControllerChange();
    expect(harness.notify).toHaveBeenCalledTimes(1);
  });

  it('does nothing when service workers are unavailable', () => {
    const notify = jest.fn<void, []>();
    const startInterval = jest.fn<unknown, [() => void, number]>();

    const stop = startPwaReleaseRefresh({
      getServiceWorker: () => null,
      notifyUpdateAvailable: notify,
      startInterval,
      clearInterval: jest.fn<void, [unknown]>(),
    });

    stop();

    expect(notify).not.toHaveBeenCalled();
    expect(startInterval).not.toHaveBeenCalled();
  });
});
