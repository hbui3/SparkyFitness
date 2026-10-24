import { describe, expect, it } from 'vitest';
import {
  extractTextPayloads,
  extractFitResources,
  detectCorosToolError,
  isCorosNoDataText,
  parseSportRecords,
} from '../integrations/coros/corosMcpText.js';

const MOCK_SPORT_RECORDS_RESULT = {
  content: [
    {
      type: 'text',
      text: 'Sport Records — 2024-12-01 to 2024-12-31 (1 records)\n========================\n\n1. Indoor Run — 2024-12-21\n   Location: Indoor Run\n   Time Window: startTimestamp=1734814685 | endTimestamp=1734816535\n   Duration: 30:16 | Distance: 3.74 km\n   Average Pace: 8:05 /km | Avg HR: 134 bpm | Calories: 300 kcal\n   LabelId: 480644884506640590 | SportType: 101',
    },
  ],
  isError: false,
};

const MOCK_FIT_FILE_RESULT = {
  content: [
    {
      type: 'text',
      text: 'Returned raw FIT file(s).',
    },
    {
      type: 'resource',
      resource: {
        uri: 'coros://activity-fit-files/480644884506640590.fit',
        mimeType: 'application/octet-stream',
        _meta: {
          labelId: '480644884506640590',
          sportType: 101,
          fileName: '480644884506640590.fit',
          fileType: 4,
        },
        blob: Buffer.from('mock-fit-data').toString('base64'),
      },
      annotations: {
        audience: ['assistant'],
        priority: 1,
      },
    },
  ],
  isError: false,
};

describe('corosMcpText parser', () => {
  it('parses report markdown and json tool responses', () => {
    const payloads = extractTextPayloads(MOCK_SPORT_RECORDS_RESULT);
    expect(payloads).toBeDefined();
    expect(payloads.length).toBeGreaterThan(0);
  });

  it('detects no data and tool errors', () => {
    expect(isCorosNoDataText('No data found for this period.')).toBe(true);
    expect(isCorosNoDataText('null')).toBe(true);
    expect(isCorosNoDataText('Some real data')).toBe(false);

    expect(detectCorosToolError('Error: token expired')).not.toBeNull();
    expect(detectCorosToolError('Success response')).toBeNull();
  });

  it('extracts sport records from list response', () => {
    const payloads = extractTextPayloads(MOCK_SPORT_RECORDS_RESULT);
    expect(payloads.length).toBeGreaterThan(0);
    const reportText = payloads[0].kind === 'report' ? payloads[0].text : '';
    const { records } = parseSportRecords(reportText);
    expect(records.length).toBe(1);
    expect(records[0].labelId).toBe('480644884506640590');
    expect(records[0].sportType).toBe(101);
  });

  it('correctly parses meters distance and multi-hour durations with odd line breaks', () => {
    const rawReport = `Sport Records — 2025-11-01 to 2025-11-30 (2 records)
========================

1. Strength — 2025-11-10
   Location: Gym
   Time Window: startTimestamp=1762770000 | endTimestamp=1762774500
   Duration: 1:15:00
   Distance: 218 m
   Avg HR: 120 bpm | Calories: 450 kcal
   LabelId: 480644884506640999
   SportType: 402

2. Outdoor Run — 2025-11-12
   Time Window: startTimestamp=1762940000 | endTimestamp=1762943600
   Duration: 45:10 | Distance: 6.25 km
   LabelId: 480644884506640888 | SportType: 100`;

    const { records, returnedCount } = parseSportRecords(rawReport);
    expect(returnedCount).toBe(2);
    expect(records.length).toBe(2);

    expect(records[0].labelId).toBe('480644884506640999');
    expect(records[0].sportType).toBe(402);
    expect(records[0].durationSeconds).toBe(4500);
    expect(records[0].distanceMeters).toBe(218);

    expect(records[1].labelId).toBe('480644884506640888');
    expect(records[1].sportType).toBe(100);
    expect(records[1].durationSeconds).toBe(2710);
    expect(records[1].distanceMeters).toBe(6250);
  });

  it('detects tool call anomaly text', () => {
    expect(
      detectCorosToolError('Tool call anomalies: query limit exceeded')
    ).not.toBeNull();
    expect(
      detectCorosToolError('Rate limit exceeded: 50 requests per day')
    ).not.toBeNull();
  });

  it('extracts FIT file resources from embedded data', () => {
    const resources = extractFitResources(MOCK_FIT_FILE_RESULT);
    expect(resources.length).toBeGreaterThan(0);
    expect(resources[0].data).toBeInstanceOf(Buffer);
    expect(resources[0].data.length).toBeGreaterThan(0);
  });
});
