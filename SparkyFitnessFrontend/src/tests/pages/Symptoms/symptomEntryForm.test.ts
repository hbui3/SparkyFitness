import {
  buildEntryBody,
  buildSymptomChoices,
  draftsFromEntry,
  draftsToInputs,
  reliefDraft,
  type SymptomChoice,
  type SymptomFormState,
} from '@workspace/shared';
import { makeDefinition, makeEntry } from './symptomTestKit';

const choiceNamed = (
  name: string,
  definitions: ReturnType<typeof makeDefinition>[] = []
): SymptomChoice =>
  buildSymptomChoices(definitions).find(
    (c) => c.name === name
  ) as SymptomChoice;

const blank = (over: Partial<SymptomFormState> = {}): SymptomFormState => ({
  mode: 'quick',
  startedAt: '2026-09-29T09:00:00.000Z',
  ongoing: true,
  endedAt: '2026-09-29T11:00:00.000Z',
  severity: null,
  locations: [],
  phases: {},
  qualities: [],
  associated: [],
  triggers: [],
  impact: null,
  bristol: null,
  medicationId: null,
  notes: '',
  customFields: {},
  treatments: [],
  ...over,
});

const NOW = new Date('2026-09-29T14:30:00.000Z');

const build = (
  state: SymptomFormState,
  choice: SymptomChoice,
  over: Partial<Parameters<typeof buildEntryBody>[0]> = {}
) =>
  buildEntryBody({
    state,
    choice,
    symptomId: 'def-1',
    selectedDate: '2026-09-29',
    today: '2026-09-29',
    isEdit: false,
    now: NOW,
    ...over,
  });

describe('buildEntryBody: timing', () => {
  it('logs a quick entry for today at the current time', () => {
    const body = build(blank(), choiceNamed('nausea'));
    expect(body.entry_date).toBe('2026-09-29');
    expect(body.logged_at).toBe(NOW.toISOString());
    expect(body).not.toHaveProperty('started_at');
    expect(body).not.toHaveProperty('ended_at');
  });

  it('logs a quick entry for another day at midday', () => {
    const body = build(blank(), choiceNamed('nausea'), {
      selectedDate: '2026-09-20',
    });
    expect(body.entry_date).toBe('2026-09-20');
    expect(body.logged_at).toBe(new Date('2026-09-20T12:00:00').toISOString());
  });

  it('sends an ongoing episode with its start and no end, and lets the server pick the day', () => {
    const body = build(blank({ mode: 'episode' }), choiceNamed('migraine'));
    expect(body.started_at).toBe('2026-09-29T09:00:00.000Z');
    expect(body.ended_at).toBeNull();
    expect(body).not.toHaveProperty('entry_date');
    expect(body).not.toHaveProperty('logged_at');
  });

  it('sends the end of an episode that is over', () => {
    const body = build(
      blank({ mode: 'episode', ongoing: false }),
      choiceNamed('migraine')
    );
    expect(body.ended_at).toBe('2026-09-29T11:00:00.000Z');
  });

  it('clears an episode’s times when an edit turns it into a quick log', () => {
    const body = build(blank(), choiceNamed('migraine'), { isEdit: true });
    expect(body.started_at).toBeNull();
    expect(body.ended_at).toBeNull();
  });

  it('does not send times of its own when creating a quick log', () => {
    const body = build(blank(), choiceNamed('migraine'), { isEdit: false });
    expect(body).not.toHaveProperty('started_at');
  });
});

describe('buildEntryBody: severity', () => {
  it('sends the middle of a 1 to 10 scale when it was never touched', () => {
    expect(build(blank(), choiceNamed('nausea'))).toMatchObject({
      severity: 5,
      severity_label: 'Moderate',
    });
  });

  it('sends what was chosen, labelled relative to the scale', () => {
    expect(build(blank({ severity: 9 }), choiceNamed('nausea'))).toMatchObject({
      severity: 9,
      severity_label: 'Severe',
    });
    expect(build(blank({ severity: 2 }), choiceNamed('nausea'))).toMatchObject({
      severity: 2,
      severity_label: 'Mild',
    });
  });

  it('reads a 1 to 5 scale against its own top', () => {
    const choice = choiceNamed('migraine', [
      makeDefinition({ name: 'migraine', scale_type: '1-5' }),
    ]);
    expect(build(blank({ severity: 4 }), choice)).toMatchObject({
      severity: 4,
      severity_label: 'Severe',
    });
    expect(build(blank(), choice).severity).toBe(3);
  });

  it('sends no severity for a notes-only symptom', () => {
    const choice = choiceNamed('migraine', [
      makeDefinition({ name: 'migraine', scale_type: 'text' }),
    ]);
    expect(build(blank({ severity: 7 }), choice)).toMatchObject({
      severity: null,
      severity_label: null,
    });
  });

  it('leaves a count blank unless one was entered', () => {
    const choice = choiceNamed('migraine', [
      makeDefinition({ name: 'migraine', scale_type: 'count' }),
    ]);
    expect(build(blank(), choice).severity).toBeNull();
    expect(build(blank({ severity: 3 }), choice).severity).toBe(3);
  });
});

describe('buildEntryBody: details', () => {
  it('carries the picked details through', () => {
    const body = build(
      blank({
        locations: ['Behind left eye'],
        qualities: ['Throbbing'],
        associated: ['Nausea'],
        triggers: ['Poor sleep'],
        impact: 'moderate',
        medicationId: 'med-1',
        customFields: { migraine_type: 'With aura' },
      }),
      choiceNamed('migraine')
    );
    expect(body).toMatchObject({
      symptom_id: 'def-1',
      symptom_name_snapshot: 'Migraine',
      body_locations: ['Behind left eye'],
      qualities: ['Throbbing'],
      associated_symptoms: ['Nausea'],
      triggers: ['Poor sleep'],
      impact: 'moderate',
      medication_id: 'med-1',
      custom_fields: { migraine_type: 'With aura' },
    });
  });

  it('drops phases with nothing picked', () => {
    const body = build(
      blank({ phases: { prodrome: [], aura: ['Visual'], postdrome: [] } }),
      choiceNamed('migraine')
    );
    expect(body.phases).toEqual({ aura: ['Visual'] });
  });

  it('trims notes and sends none when they are blank', () => {
    expect(
      build(blank({ notes: '  after coffee ' }), choiceNamed('nausea'))
        .context_text
    ).toBe('after coffee');
    expect(
      build(blank({ notes: '   ' }), choiceNamed('nausea')).context_text
    ).toBeNull();
  });

  it('sends the Bristol type only for symptoms that ask for it', () => {
    expect(
      build(blank({ bristol: 4 }), choiceNamed('diarrhea')).bristol_type
    ).toBe(4);
    expect(
      build(blank({ bristol: 4 }), choiceNamed('headache')).bristol_type
    ).toBeNull();
  });

  it('sends the treatments as inputs', () => {
    const body = build(
      blank({
        treatments: [
          { ...reliefDraft('Dark, quiet room', NOW), effectiveness: 'partial' },
        ],
      }),
      choiceNamed('migraine')
    );
    expect(body.treatments).toEqual([
      {
        kind: 'relief',
        medication_id: null,
        name_snapshot: 'Dark, quiet room',
        dose_snapshot: null,
        taken_at: NOW.toISOString(),
        effectiveness: 'partial',
      },
    ]);
  });

  it('has no symptom id before the symptom is saved', () => {
    expect(
      build(blank(), choiceNamed('nausea'), { symptomId: null }).symptom_id
    ).toBeNull();
  });
});

describe('treatment drafts', () => {
  it('round-trips a saved treatment through a draft', () => {
    const entry = makeEntry({
      treatments: [
        {
          id: 't-1',
          user_id: 'u',
          symptom_entry_id: 'e',
          kind: 'medication',
          medication_id: 'med-1',
          medication_entry_id: null,
          name_snapshot: 'Sumatriptan',
          dose_snapshot: '50 mg',
          taken_at: '2026-09-29T09:50:00.000Z',
          effectiveness: 'full',
          notes: null,
          created_at: '2026-09-29T09:50:00.000Z',
        },
      ],
    });
    const drafts = draftsFromEntry(entry);
    expect(drafts[0]).toMatchObject({
      key: 't-1',
      name: 'Sumatriptan',
      medicationId: 'med-1',
      effectiveness: 'full',
    });
    expect(draftsToInputs(drafts)).toEqual([
      {
        kind: 'medication',
        medication_id: 'med-1',
        name_snapshot: 'Sumatriptan',
        dose_snapshot: '50 mg',
        taken_at: '2026-09-29T09:50:00.000Z',
        effectiveness: 'full',
      },
    ]);
  });

  it('starts a relief method unrated, stamped with the time it was added', () => {
    expect(reliefDraft('Rest', NOW)).toMatchObject({
      kind: 'relief',
      name: 'Rest',
      takenAt: NOW.toISOString(),
      effectiveness: null,
    });
  });
});
