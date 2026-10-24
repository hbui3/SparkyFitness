import { AppState, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import {
  __resetSoundsForTests,
  isBackgroundRestChimeEnabled,
  isRestTimerSoundEnabled,
  playRestCompleteSound,
  setRestKeepAlive,
  willPlayRestCompleteSound,
} from '../../src/services/sounds';
import {
  __resetAppPreferencesStoreForTests,
  useAppPreferencesStore,
} from '../../src/stores/appPreferencesStore';

const mockCreatePlayer = createAudioPlayer as jest.MockedFunction<
  typeof createAudioPlayer
>;
const mockSetAudioMode = setAudioModeAsync as jest.MockedFunction<
  typeof setAudioModeAsync
>;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

function setAppState(state: string): void {
  Object.defineProperty(AppState, 'currentState', {
    get: () => state,
    configurable: true,
  });
}

describe('sounds service', () => {
  beforeEach(() => {
    __resetAppPreferencesStoreForTests();
    __resetSoundsForTests();
    mockCreatePlayer.mockClear();
    mockSetAudioMode.mockClear();
    setAppState('active');
    setPlatform('ios');
  });

  describe('isRestTimerSoundEnabled', () => {
    it('follows the restTimerSoundEnabled preference', () => {
      expect(isRestTimerSoundEnabled()).toBe(true);
      useAppPreferencesStore.getState().setRestTimerSoundEnabled(false);
      expect(isRestTimerSoundEnabled()).toBe(false);
    });

    it('is independent of the camera-shutter soundsEnabled preference', () => {
      useAppPreferencesStore.getState().setSoundsEnabled(false);
      expect(isRestTimerSoundEnabled()).toBe(true);
    });
  });

  describe('willPlayRestCompleteSound', () => {
    it('is true only while the app is active and the chime is enabled', () => {
      expect(willPlayRestCompleteSound()).toBe(true);
      setAppState('inactive');
      expect(willPlayRestCompleteSound()).toBe(false);
      setAppState('background');
      expect(willPlayRestCompleteSound()).toBe(false);
      setAppState('active');
      useAppPreferencesStore.getState().setRestTimerSoundEnabled(false);
      expect(willPlayRestCompleteSound()).toBe(false);
    });
  });

  describe('playRestCompleteSound', () => {
    it('configures a mix-with-others, silent-switch-respecting audio mode once', async () => {
      playRestCompleteSound();
      await flush();
      playRestCompleteSound();
      await flush();
      expect(mockSetAudioMode).toHaveBeenCalledTimes(1);
      expect(mockSetAudioMode).toHaveBeenCalledWith({
        playsInSilentMode: false,
        interruptionMode: 'mixWithOthers',
      });
    });

    it('creates the player once and replays from the start on later calls', async () => {
      playRestCompleteSound();
      await flush();
      playRestCompleteSound();
      await flush();
      expect(mockCreatePlayer).toHaveBeenCalledTimes(1);
      const player = mockCreatePlayer.mock.results[0].value;
      expect(player.seekTo).toHaveBeenCalledTimes(2);
      expect(player.seekTo).toHaveBeenCalledWith(0);
      expect(player.play).toHaveBeenCalledTimes(2);
    });

    it('does nothing when the preference is off', async () => {
      useAppPreferencesStore.getState().setRestTimerSoundEnabled(false);
      playRestCompleteSound();
      await flush();
      expect(mockCreatePlayer).not.toHaveBeenCalled();
    });

    it('does nothing when the app is not in the foreground', async () => {
      setAppState('background');
      playRestCompleteSound();
      await flush();
      expect(mockCreatePlayer).not.toHaveBeenCalled();
    });

    it('still plays and retries configuration when the audio mode call fails', async () => {
      mockSetAudioMode.mockRejectedValueOnce(
        new Error('impossible audio mode')
      );
      playRestCompleteSound();
      await flush();
      const player = mockCreatePlayer.mock.results[0].value;
      expect(player.play).toHaveBeenCalledTimes(1);
      playRestCompleteSound();
      await flush();
      expect(mockSetAudioMode).toHaveBeenCalledTimes(2);
      expect(player.play).toHaveBeenCalledTimes(2);
    });

    it('swallows playback errors', async () => {
      mockCreatePlayer.mockReturnValueOnce({
        play: jest.fn(),
        pause: jest.fn(),
        seekTo: jest.fn().mockRejectedValue(new Error('boom')),
        remove: jest.fn(),
      } as never);
      expect(() => playRestCompleteSound()).not.toThrow();
      await flush();
    });
  });

  describe('play through silent mode (#2506)', () => {
    const enable = () =>
      useAppPreferencesStore.getState().setRestChimeThroughSilent(true);

    afterEach(() => {
      jest.useRealTimers();
    });

    it('is off by default and needs the chime itself on', () => {
      expect(isBackgroundRestChimeEnabled()).toBe(false);
      enable();
      expect(isBackgroundRestChimeEnabled()).toBe(true);
      useAppPreferencesStore.getState().setRestTimerSoundEnabled(false);
      expect(isBackgroundRestChimeEnabled()).toBe(false);
    });

    it('plays the chime in the background on iOS only', () => {
      enable();
      setAppState('background');
      expect(willPlayRestCompleteSound()).toBe(true);
      setPlatform('android');
      expect(willPlayRestCompleteSound()).toBe(false);
    });

    it('configures a silent-switch-ignoring background audio mode on iOS', async () => {
      enable();
      playRestCompleteSound();
      await flush();
      expect(mockSetAudioMode).toHaveBeenCalledWith({
        playsInSilentMode: true,
        interruptionMode: 'mixWithOthers',
        shouldPlayInBackground: true,
      });
    });

    it('ignores the silent switch without background playback on Android', async () => {
      setPlatform('android');
      enable();
      playRestCompleteSound();
      await flush();
      expect(mockSetAudioMode).toHaveBeenCalledWith({
        playsInSilentMode: true,
        interruptionMode: 'mixWithOthers',
      });
    });

    it('re-applies the audio mode when the preference changes', async () => {
      playRestCompleteSound();
      await flush();
      enable();
      playRestCompleteSound();
      await flush();
      expect(mockSetAudioMode).toHaveBeenCalledTimes(2);
    });

    it('loops a silent keep-alive during a rest and releases it after the chime tail', async () => {
      enable();
      setRestKeepAlive(true);
      await flush();
      const keepAlive = mockCreatePlayer.mock.results[0].value;
      expect(keepAlive.loop).toBe(true);
      expect(keepAlive.play).toHaveBeenCalledTimes(1);

      jest.useFakeTimers();
      setRestKeepAlive(false);
      expect(keepAlive.pause).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2500);
      expect(keepAlive.pause).toHaveBeenCalledTimes(1);
    });

    it('keeps the loop going when the next rest starts within the tail', async () => {
      enable();
      setRestKeepAlive(true);
      await flush();
      const keepAlive = mockCreatePlayer.mock.results[0].value;
      jest.useFakeTimers();
      setRestKeepAlive(false);
      setRestKeepAlive(true);
      jest.advanceTimersByTime(5000);
      expect(keepAlive.pause).not.toHaveBeenCalled();
    });

    it('does nothing when the setting is off or on Android', async () => {
      setRestKeepAlive(true);
      await flush();
      setPlatform('android');
      enable();
      setRestKeepAlive(true);
      await flush();
      expect(mockCreatePlayer).not.toHaveBeenCalled();
      expect(mockSetAudioMode).not.toHaveBeenCalled();
    });
  });
});
