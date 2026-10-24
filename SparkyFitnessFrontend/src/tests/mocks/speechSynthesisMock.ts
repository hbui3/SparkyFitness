/**
 * A controllable `window.speechSynthesis` for jsdom, which has none. Install
 * it in `beforeEach` and remove it in `afterEach`.
 */
export interface SpeechSynthesisMock {
  spoken: SpeechSynthesisUtterance[];
  speak: jest.Mock;
  cancel: jest.Mock;
  pause: jest.Mock;
  resume: jest.Mock;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  voices: SpeechSynthesisVoice[];
}

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

export function installSpeechSynthesisMock(
  voices: Partial<SpeechSynthesisVoice>[] = []
): SpeechSynthesisMock {
  const mock: SpeechSynthesisMock = {
    spoken: [],
    speak: jest.fn(),
    cancel: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    voices: voices as SpeechSynthesisVoice[],
  };
  mock.speak.mockImplementation((u: SpeechSynthesisUtterance) =>
    mock.spoken.push(u)
  );
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak: mock.speak,
      cancel: mock.cancel,
      pause: mock.pause,
      resume: mock.resume,
      addEventListener: mock.addEventListener,
      removeEventListener: mock.removeEventListener,
      paused: false,
      getVoices: () => mock.voices,
      onvoiceschanged: null,
    },
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: FakeUtterance,
  });
  return mock;
}

export function removeSpeechSynthesisMock(): void {
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  delete (window as { SpeechSynthesisUtterance?: unknown })
    .SpeechSynthesisUtterance;
}
