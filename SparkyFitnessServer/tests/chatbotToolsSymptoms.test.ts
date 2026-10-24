import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildSymptomTools } from '../ai/tools/symptomTools.js';
import symptomService from '../services/symptomService.js';
import { toolOpts } from './helpers/toolExecutionOptions.js';

vi.mock('../services/symptomService', () => ({
  default: {
    listDefinitions: vi.fn(),
    createDefinition: vi.fn(),
    updateDefinition: vi.fn(),
    deleteDefinition: vi.fn(),
    listEntries: vi.fn(),
    listOngoing: vi.fn(),
    createEntry: vi.fn(),
    addSeverity: vi.fn(),
    endEpisode: vi.fn(),
    markSymptomFree: vi.fn(),
    listOptions: vi.fn(),
    createOption: vi.fn(),
  },
}));

describe('sparky_manage_symptoms tool', () => {
  const userId = 'user-123';
  const tz = 'America/New_York';
  const tools = buildSymptomTools(userId, tz);
  const tool = tools.sparky_manage_symptoms;
  const opts = toolOpts;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists symptom definitions', async () => {
    vi.mocked(symptomService.listDefinitions).mockResolvedValueOnce([
      {
        id: 'def-1',
        user_id: userId,
        name: 'Migraine',
        display_name: null,
        category: 'head',
        template: 'headache',
        scale_type: '1-10',
        unit: null,
        is_glp1_flagged: false,
        sections: {},
        custom_field_defs: [],
        is_episodic: true,
        color: null,
        icon: null,
        is_pinned: true,
        sort_order: 0,
        is_archived: false,
        created_at: '2026-09-29T12:00:00.000Z',
        updated_at: '2026-09-29T12:00:00.000Z',
      },
    ]);

    const result = await tool.execute({ action: 'list_definitions' }, opts);
    expect(result).toContain('Migraine');
    expect(result).toContain('head');
  });

  it('creates a definition', async () => {
    vi.mocked(symptomService.createDefinition).mockResolvedValueOnce({
      id: 'def-2',
      user_id: userId,
      name: 'Lower Back Pain',
      display_name: null,
      category: 'pain',
      template: 'pain',
      scale_type: '1-10',
      unit: null,
      is_glp1_flagged: false,
      sections: {},
      custom_field_defs: [],
      is_episodic: false,
      color: null,
      icon: null,
      is_pinned: false,
      sort_order: 0,
      is_archived: false,
      created_at: '2026-09-29T12:00:00.000Z',
      updated_at: '2026-09-29T12:00:00.000Z',
    });

    const result = await tool.execute(
      {
        action: 'create_definition',
        name: 'Lower Back Pain',
        category: 'pain',
        template: 'pain',
        scale_type: '1-10',
      },
      opts
    );
    expect(result).toContain('Created symptom definition "Lower Back Pain"');
  });

  it('logs a quick symptom entry', async () => {
    vi.mocked(symptomService.createEntry).mockResolvedValueOnce({
      id: 'entry-1',
      user_id: userId,
      medication_id: null,
      symptom_id: null,
      symptom_name_snapshot: 'Headache',
      severity: 6,
      severity_label: '6',
      entry_date: '2026-10-01',
      logged_at: '2026-10-01T14:00:00.000Z',
      started_at: null,
      ended_at: null,
      body_location: 'Forehead',
      body_locations: ['Forehead'],
      qualities: ['throbbing'],
      associated_symptoms: ['nausea'],
      triggers: ['poor sleep'],
      phases: {},
      impact: 'mild',
      peak_severity: 6,
      severity_timeline: [],
      context_text: 'Felt it around noon',
      bristol_type: null,
      source: 'manual',
      custom_fields: {},
      created_at: '2026-10-01T14:00:00.000Z',
      updated_at: '2026-10-01T14:00:00.000Z',
      treatments: [],
      photo_ids: [],
    });

    const result = await tool.execute(
      {
        action: 'log_entry',
        symptom_name: 'Headache',
        severity: 6,
        body_locations: ['Forehead'],
        qualities: ['throbbing'],
      },
      opts
    );
    expect(result).toContain('Logged Headache for 2026-10-01');
    expect(result).toContain('Severity: 6');
  });

  it('starts and ends an ongoing episode', async () => {
    vi.mocked(symptomService.createEntry).mockResolvedValueOnce({
      id: 'entry-ep-1',
      user_id: userId,
      medication_id: null,
      symptom_id: null,
      symptom_name_snapshot: 'Migraine',
      severity: 7,
      severity_label: '7',
      entry_date: '2026-10-01',
      logged_at: '2026-10-01T15:00:00.000Z',
      started_at: '2026-10-01T15:00:00.000Z',
      ended_at: null,
      body_location: null,
      body_locations: ['behind left eye'],
      qualities: ['throbbing'],
      associated_symptoms: ['aura'],
      triggers: [],
      phases: {},
      impact: 'severe',
      peak_severity: 7,
      severity_timeline: [{ at: '2026-10-01T15:00:00.000Z', severity: 7 }],
      context_text: null,
      bristol_type: null,
      source: 'manual',
      custom_fields: {},
      created_at: '2026-10-01T15:00:00.000Z',
      updated_at: '2026-10-01T15:00:00.000Z',
      treatments: [],
      photo_ids: [],
    });

    const startResult = await tool.execute(
      {
        action: 'start_episode',
        symptom_name: 'Migraine',
        severity: 7,
        started_at: '2026-10-01T15:00:00.000Z',
      },
      opts
    );
    expect(startResult).toContain('Started ongoing episode for Migraine');

    vi.mocked(symptomService.endEpisode).mockResolvedValueOnce({
      id: 'entry-ep-1',
      user_id: userId,
      medication_id: null,
      symptom_id: null,
      symptom_name_snapshot: 'Migraine',
      severity: 7,
      severity_label: '7',
      entry_date: '2026-10-01',
      logged_at: '2026-10-01T15:00:00.000Z',
      started_at: '2026-10-01T15:00:00.000Z',
      ended_at: '2026-10-01T18:00:00.000Z',
      body_location: null,
      body_locations: ['behind left eye'],
      qualities: ['throbbing'],
      associated_symptoms: ['aura'],
      triggers: [],
      phases: {},
      impact: 'severe',
      peak_severity: 7,
      severity_timeline: [{ at: '2026-10-01T15:00:00.000Z', severity: 7 }],
      context_text: null,
      bristol_type: null,
      source: 'manual',
      custom_fields: {},
      created_at: '2026-10-01T15:00:00.000Z',
      updated_at: '2026-10-01T18:00:00.000Z',
      treatments: [],
      photo_ids: [],
    });

    const endResult = await tool.execute(
      {
        action: 'end_episode',
        id: '11111111-1111-1111-1111-111111111111',
      },
      opts
    );
    expect(endResult).toContain('Ended episode for Migraine');
  });

  it('marks a day symptom-free', async () => {
    vi.mocked(symptomService.markSymptomFree).mockResolvedValueOnce({
      id: 'free-1',
      entry_date: '2026-10-01',
    });

    const result = await tool.execute(
      {
        action: 'mark_symptom_free',
        entry_date: '2026-10-01',
      },
      opts
    );
    expect(result).toContain('Marked 2026-10-01 as a symptom-free day');
  });
});
