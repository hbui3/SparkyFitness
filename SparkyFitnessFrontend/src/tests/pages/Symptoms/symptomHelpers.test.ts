import {
  fromDatetimeLocal,
  toDatetimeLocal,
} from '@/pages/Symptoms/symptomHelpers';
import { makeDefinition, makeEntry, makeOption } from './symptomTestKit';
import {
  buildSymptomChoices,
  formatDuration,
  minutesAgo,
  minutesBetween,
  recentSymptomNames,
  resolveOptionItems,
  resolveTriggerGroups,
  scaleMax,
  severityBand,
  slugifySymptomName,
} from '@workspace/shared';

describe('buildSymptomChoices', () => {
  it('offers the built-in symptoms with no saved definitions', () => {
    const names = buildSymptomChoices([]).map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['headache', 'migraine', 'nausea', 'back_pain'])
    );
  });

  it('keeps the GLP-1 flag and template of the original medication symptoms', () => {
    const nausea = buildSymptomChoices([]).find((c) => c.name === 'nausea');
    expect(nausea).toMatchObject({ isGlp1: true, template: 'gi' });
  });

  it('lets a saved definition win over the built-in of the same name', () => {
    const [migraine] = buildSymptomChoices([
      makeDefinition({
        name: 'migraine',
        display_name: 'My migraines',
        is_pinned: true,
        scale_type: '1-5',
      }),
    ]).filter((c) => c.name === 'migraine');
    expect(migraine).toMatchObject({
      displayName: 'My migraines',
      isPinned: true,
      scaleType: '1-5',
      definitionId: expect.any(String),
    });
  });

  it('hides an archived symptom, built-in or custom', () => {
    const choices = buildSymptomChoices([
      makeDefinition({ name: 'nausea', is_archived: true }),
      makeDefinition({ id: 'x', name: 'my_thing', is_archived: true }),
    ]);
    expect(choices.some((c) => c.name === 'nausea')).toBe(false);
    expect(choices.some((c) => c.name === 'my_thing')).toBe(false);
  });

  it("adds the user's own symptoms", () => {
    const choices = buildSymptomChoices([
      makeDefinition({
        id: 'x',
        name: 'lower_back_pain',
        display_name: 'Lower back pain',
        template: 'pain',
        is_episodic: false,
      }),
    ]);
    expect(choices.find((c) => c.name === 'lower_back_pain')).toMatchObject({
      displayName: 'Lower back pain',
      template: 'pain',
    });
  });

  it('applies per-symptom section overrides on top of the template', () => {
    const choice = buildSymptomChoices([
      makeDefinition({ name: 'migraine', sections: { triggers: false } }),
    ]).find((c) => c.name === 'migraine');
    expect(choice?.sections.triggers).toBe(false);
    expect(choice?.sections.phases).toBe(true);
  });

  it('carries custom field definitions from a built-in and from a saved one', () => {
    const builtIn = buildSymptomChoices([]).find((c) => c.name === 'migraine');
    expect(builtIn?.customFieldDefs.map((d) => d.key)).toContain(
      'migraine_type'
    );
    const saved = buildSymptomChoices([
      makeDefinition({
        name: 'migraine',
        custom_field_defs: [{ key: 'x', label: 'X', type: 'text' }],
      }),
    ]).find((c) => c.name === 'migraine');
    expect(saved?.customFieldDefs.map((d) => d.key)).toEqual(['x']);
  });
});

describe('severity helpers', () => {
  it('knows the top of each scale', () => {
    expect(scaleMax('1-5')).toBe(5);
    expect(scaleMax('1-10')).toBe(10);
    expect(scaleMax('none-severe')).toBe(3);
    expect(scaleMax('text')).toBe(0);
  });

  it('bands a value relative to its own scale', () => {
    expect(severityBand(2, '1-10')).toBe('low');
    expect(severityBand(5, '1-10')).toBe('mid');
    expect(severityBand(8, '1-10')).toBe('high');
    // 4 of 5 is as severe as 8 of 10.
    expect(severityBand(4, '1-5')).toBe('high');
    expect(severityBand(1, '1-5')).toBe('low');
    expect(severityBand(2, 'none-severe')).toBe('mid');
  });

  it('never divides by a scale with no maximum', () => {
    expect(severityBand(5, 'text')).toBe('low');
  });
});

describe('durations', () => {
  it('counts whole minutes and never goes negative', () => {
    expect(minutesBetween('2026-09-29T09:00:00Z', '2026-09-29T11:15:00Z')).toBe(
      135
    );
    expect(minutesBetween('2026-09-29T11:00:00Z', '2026-09-29T09:00:00Z')).toBe(
      0
    );
    expect(minutesBetween('nonsense', '2026-09-29T09:00:00Z')).toBe(0);
  });

  it.each([
    [0, '0 m'],
    [45, '45 m'],
    [60, '1 h'],
    [135, '2 h 15 m'],
    [1440, '1 d'],
    [1620, '1 d 3 h'],
  ])('formats %i minutes as %s', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });

  it('goes back a number of minutes from a given time', () => {
    const now = new Date('2026-09-29T12:00:00Z');
    expect(minutesAgo(90, now).toISOString()).toBe('2026-09-29T10:30:00.000Z');
  });
});

describe('datetime-local conversion', () => {
  it('writes local wall-clock time', () => {
    const local = new Date(2026, 5, 25, 9, 5);
    expect(toDatetimeLocal(local)).toBe('2026-06-25T09:05');
  });

  it('round-trips through an ISO instant', () => {
    const value = '2026-06-25T09:05';
    const iso = fromDatetimeLocal(value);
    expect(iso).not.toBeNull();
    expect(toDatetimeLocal(iso as string)).toBe(value);
  });

  it('returns null for an empty or invalid value', () => {
    expect(fromDatetimeLocal('')).toBeNull();
    expect(fromDatetimeLocal('not a date')).toBeNull();
  });
});

describe('resolveOptionItems', () => {
  it('lists the built-ins for a kind', () => {
    const labels = resolveOptionItems('quality', []).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['Throbbing', 'Sharp']));
  });

  it('drops a built-in the user has hidden', () => {
    const labels = resolveOptionItems('quality', [
      makeOption({ kind: 'quality', name: 'Sharp', is_hidden: true }),
    ]).map((i) => i.label);
    expect(labels).not.toContain('Sharp');
    expect(labels).toContain('Throbbing');
  });

  it("appends the user's own options with their ids", () => {
    const items = resolveOptionItems('quality', [
      makeOption({ id: 'opt-1', kind: 'quality', name: 'Tingling' }),
    ]);
    expect(items.at(-1)).toEqual({
      label: 'Tingling',
      isCustom: true,
      optionId: 'opt-1',
    });
  });

  it('ignores options of another kind', () => {
    const labels = resolveOptionItems('quality', [
      makeOption({ kind: 'trigger', name: 'Red wine' }),
    ]).map((i) => i.label);
    expect(labels).not.toContain('Red wine');
  });

  it('does not repeat a built-in that was re-saved as an option', () => {
    const items = resolveOptionItems('quality', [
      makeOption({ kind: 'quality', name: 'Sharp' }),
    ]);
    expect(items.filter((i) => i.label === 'Sharp')).toHaveLength(1);
  });
});

describe('resolveTriggerGroups', () => {
  it('groups the built-in triggers', () => {
    const groups = resolveTriggerGroups([]);
    expect(groups.map((g) => g.group)).toEqual(
      expect.arrayContaining(['Sleep', 'Food & drink', 'Environment'])
    );
    expect(groups.some((g) => g.group === 'Mine')).toBe(false);
  });

  it("puts the user's own triggers in a group of their own", () => {
    const groups = resolveTriggerGroups([
      makeOption({ id: 'o', kind: 'trigger', name: 'Cold air' }),
    ]);
    expect(groups.at(-1)).toMatchObject({
      group: 'Mine',
      items: [{ label: 'Cold air', isCustom: true, optionId: 'o' }],
    });
  });

  it('drops a hidden built-in and an emptied group', () => {
    const all = resolveTriggerGroups([]);
    const sleep = all.find((g) => g.group === 'Sleep')!;
    const hidden = sleep.items.map((i) =>
      makeOption({ kind: 'trigger', name: i.label, is_hidden: true })
    );
    expect(resolveTriggerGroups(hidden).some((g) => g.group === 'Sleep')).toBe(
      false
    );
  });
});

describe('recentSymptomNames', () => {
  it('orders by most recent and lists each symptom once', () => {
    const names = recentSymptomNames([
      makeEntry({
        symptom_name_snapshot: 'Nausea',
        logged_at: '2026-09-20T09:00:00Z',
      }),
      makeEntry({
        symptom_name_snapshot: 'Back pain',
        logged_at: '2026-09-25T09:00:00Z',
      }),
      makeEntry({
        symptom_name_snapshot: 'Nausea',
        logged_at: '2026-09-28T09:00:00Z',
      }),
    ]);
    expect(names).toEqual(['nausea', 'back_pain']);
  });

  it('uses an episode start time over the time it was logged', () => {
    const names = recentSymptomNames([
      makeEntry({
        symptom_name_snapshot: 'Migraine',
        logged_at: '2026-09-01T09:00:00Z',
        started_at: '2026-09-29T09:00:00Z',
      }),
      makeEntry({
        symptom_name_snapshot: 'Nausea',
        logged_at: '2026-09-28T09:00:00Z',
      }),
    ]);
    expect(names[0]).toBe('migraine');
  });

  it('respects the limit', () => {
    const entries = ['a', 'b', 'c', 'd'].map((n, i) =>
      makeEntry({
        symptom_name_snapshot: n,
        logged_at: `2026-09-0${i + 1}T09:00:00Z`,
      })
    );
    expect(recentSymptomNames(entries, 2)).toHaveLength(2);
  });
});

describe('slugifySymptomName', () => {
  it('lower-cases and joins words with underscores', () => {
    expect(slugifySymptomName('  Lower Back  pain ')).toBe('lower_back_pain');
  });
});
