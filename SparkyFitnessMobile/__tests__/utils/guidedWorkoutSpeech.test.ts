import { createInstance, type TFunction } from 'i18next';
import en from '../../src/localization/locales/en/translation.json';
import { renderGuidedCue } from '../../src/utils/guidedWorkoutSpeech';

describe('renderGuidedCue', () => {
  let t: TFunction;

  beforeAll(async () => {
    const instance = createInstance();
    await instance.init({
      lng: 'en',
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
    t = instance.t;
  });

  it('announces get ready with the first exercise', () => {
    expect(
      renderGuidedCue({ type: 'getReady', exerciseName: 'Push-up' }, t)
    ).toBe('Get ready. Starting Push-up.');
  });

  it('pluralizes rep and second targets from the catalog', () => {
    const setStart = (target: Parameters<typeof renderGuidedCue>[0]) =>
      renderGuidedCue(target, t);
    expect(
      setStart({
        type: 'setStart',
        exerciseName: 'Push-up',
        target: { kind: 'reps', reps: 12 },
        setNumber: 1,
        totalSets: 3,
      })
    ).toBe('Push-up. 12 reps.');
    expect(
      setStart({
        type: 'setStart',
        exerciseName: 'Push-up',
        target: { kind: 'reps', reps: 1 },
        setNumber: 1,
        totalSets: 3,
      })
    ).toBe('Push-up. 1 rep.');
    expect(
      setStart({
        type: 'setStart',
        exerciseName: 'Plank',
        target: { kind: 'time', seconds: 45 },
        setNumber: 1,
        totalSets: 1,
      })
    ).toBe('Plank. 45 seconds.');
    expect(
      setStart({
        type: 'setStart',
        exerciseName: 'Walk',
        target: { kind: 'open' },
        setNumber: 1,
        totalSets: 1,
      })
    ).toBe('Walk.');
  });

  it('speaks instruction lines verbatim', () => {
    expect(
      renderGuidedCue({ type: 'instruction', text: 'Keep your core firm.' }, t)
    ).toBe('Keep your core firm.');
  });

  it('renders rest, next up, halfway and completion', () => {
    expect(renderGuidedCue({ type: 'rest', seconds: 90 }, t)).toBe(
      'Rest. 90 seconds.'
    );
    expect(renderGuidedCue({ type: 'intervalRest' }, t)).toBe('Rest.');
    expect(renderGuidedCue({ type: 'nextUp', exerciseName: 'Squat' }, t)).toBe(
      'Next: Squat.'
    );
    expect(renderGuidedCue({ type: 'halfway' }, t)).toBe('Halfway.');
    expect(renderGuidedCue({ type: 'workoutComplete' }, t)).toBe(
      'Workout complete.'
    );
  });
});
