import {
  cancelSpeech,
  isSpeechSynthesisSupported,
  pickDefaultSpeechVoice,
  resumeSpeech,
  speakText,
  subscribeToSpeechVoices,
} from '@/utils/speechNarrator';
import {
  installSpeechSynthesisMock,
  removeSpeechSynthesisMock,
  type SpeechSynthesisMock,
} from '@/tests/mocks/speechSynthesisMock';

describe('speechNarrator', () => {
  let synth: SpeechSynthesisMock;

  beforeEach(() => {
    synth = installSpeechSynthesisMock([
      { voiceURI: 'de', name: 'Anna', lang: 'de-DE' },
      { voiceURI: 'us-f', name: 'Samantha Female', lang: 'en-US' },
    ]);
  });

  afterEach(() => removeSpeechSynthesisMock());

  it('speaks en-US at normal rate by default, cancelling first', () => {
    const utterance = speakText('Hello');
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(utterance).toMatchObject({ text: 'Hello', lang: 'en-US', rate: 1 });
  });

  it('takes the voice language when a voice is given', () => {
    const voice = synth.voices[0]!;
    const utterance = speakText('Hallo', { voice, rate: 1.5 });
    expect(utterance).toMatchObject({ voice, lang: 'de-DE', rate: 1.5 });
  });

  it('builds but does not play a muted utterance', () => {
    const utterance = speakText('Quiet', { muted: true });
    expect(utterance).not.toBeNull();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('can queue without cancelling', () => {
    speakText('One', { cancelPrevious: false });
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it('only resumes when paused', () => {
    expect(resumeSpeech()).toBe(false);
    expect(synth.resume).not.toHaveBeenCalled();
  });

  it('reports voices now and on change', () => {
    const onVoices = jest.fn();
    const unsubscribe = subscribeToSpeechVoices(onVoices);
    expect(onVoices).toHaveBeenCalledWith(synth.voices);
    expect(synth.addEventListener).toHaveBeenCalledWith(
      'voiceschanged',
      expect.any(Function)
    );
    unsubscribe();
    expect(synth.removeEventListener).toHaveBeenCalledWith(
      'voiceschanged',
      expect.any(Function)
    );
  });

  it('keeps the modal default of a female en-US voice', () => {
    expect(pickDefaultSpeechVoice(synth.voices)?.voiceURI).toBe('us-f');
  });

  it('is a no-op without speechSynthesis', () => {
    removeSpeechSynthesisMock();
    expect(isSpeechSynthesisSupported()).toBe(false);
    expect(speakText('Nothing')).toBeNull();
    expect(() => cancelSpeech()).not.toThrow();
  });
});
