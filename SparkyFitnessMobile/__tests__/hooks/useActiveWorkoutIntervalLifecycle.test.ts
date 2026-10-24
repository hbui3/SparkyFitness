import { renderHook } from '@testing-library/react-native';
import { useActiveWorkoutIntervalLifecycle } from '../../src/hooks/useActiveWorkoutIntervalLifecycle';
import {
  startIntervalAudioSession,
  stopIntervalAudioSession,
} from '../../src/services/sounds';

jest.mock('../../src/services/sounds', () => ({
  startIntervalAudioSession: jest.fn(async () => undefined),
  stopIntervalAudioSession: jest.fn(async () => undefined),
}));
jest.mock('../../src/services/speech', () => ({
  stopGuidedSpeech: jest.fn(),
}));

const mockStart = startIntervalAudioSession as jest.MockedFunction<
  typeof startIntervalAudioSession
>;
const mockStop = stopIntervalAudioSession as jest.MockedFunction<
  typeof stopIntervalAudioSession
>;

describe('useActiveWorkoutIntervalLifecycle', () => {
  beforeEach(() => {
    mockStart.mockClear();
    mockStop.mockClear();
  });

  it('leaves the audio mode alone for a standard workout without guided mode', () => {
    const { unmount } = renderHook(() =>
      useActiveWorkoutIntervalLifecycle('standard', false)
    );
    unmount();
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('starts the silent-mode session for interval formats', () => {
    const { unmount } = renderHook(() =>
      useActiveWorkoutIntervalLifecycle('tabata', false)
    );
    expect(mockStart).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('starts the same session for a guided standard workout', () => {
    const { rerender, unmount } = renderHook(
      ({ guided }: { guided: boolean }) =>
        useActiveWorkoutIntervalLifecycle('standard', guided),
      { initialProps: { guided: true } }
    );
    expect(mockStart).toHaveBeenCalledTimes(1);
    rerender({ guided: false });
    expect(mockStop).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('opens one session when a guided workout is also an interval format', () => {
    const { unmount } = renderHook(() =>
      useActiveWorkoutIntervalLifecycle('emom', true)
    );
    expect(mockStart).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });
});
