import { log } from '../../config/logging.js';

export type CorosToolPayload =
  { kind: 'report'; text: string } | { kind: 'json'; data: unknown };

export interface CorosFitResource {
  labelId: string;
  sportType: number;
  fileName: string;
  data: Buffer;
}

export interface CorosToolCallResult {
  content?: Array<{
    type: string;
    text?: string;
    resource?: {
      uri?: string;
      mimeType?: string;
      _meta?: {
        labelId?: string | number;
        sportType?: number;
        fileName?: string;
        fileType?: number;
      };
      blob?: string;
    };
  }>;
  isError?: boolean;
}

export interface CorosSportRecord {
  labelId: string;
  sportType: number;
  name: string;
  date: string; // YYYY-MM-DD
  startTimestamp?: number;
  endTimestamp?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  avgHeartRate?: number;
  calories?: number;
  location?: string;
}

export const COROS_ERROR_PHRASES = [
  'Tool call anomalies detected',
  'High risk of session context pollution',
  'Resolution Strategy:',
  'exceeds the LLM capability boundary',
  'token expired',
  'error:',
  'invalid_grant',
] as const;

export const COROS_NO_DATA_PATTERNS = [
  /^No (?:sport records|data|devices|training load assessment data|.*?) found/i,
  /not available yet/i,
  /^Recovery: -1%/i,
  /^null$/i,
] as const;

/**
 * Extracts and decodes text items from a tool call result.
 * Handles encodings A (JSON string), B (plain text), and C (JSON object/array).
 */
export function extractTextPayloads(
  result: CorosToolCallResult
): CorosToolPayload[] {
  const payloads: CorosToolPayload[] = [];
  if (!result || !Array.isArray(result.content)) {
    return payloads;
  }

  for (const item of result.content) {
    if (item.type === 'text' && typeof item.text === 'string') {
      try {
        const parsed = JSON.parse(item.text);
        if (typeof parsed === 'string') {
          payloads.push({ kind: 'report', text: parsed });
        } else if (typeof parsed === 'object' && parsed !== null) {
          payloads.push({ kind: 'json', data: parsed });
        } else {
          payloads.push({ kind: 'report', text: item.text });
        }
      } catch {
        payloads.push({ kind: 'report', text: item.text });
      }
    }
  }

  return payloads;
}

/**
 * Extracts binary FIT resources from a tool call result.
 */
export function extractFitResources(
  result: CorosToolCallResult
): CorosFitResource[] {
  const resources: CorosFitResource[] = [];
  if (!result || !Array.isArray(result.content)) {
    return resources;
  }

  for (const item of result.content) {
    if (item.type === 'resource' && item.resource?.blob) {
      const meta = item.resource._meta || {};
      const labelId = String(meta.labelId ?? '').trim();
      const sportType = Number(meta.sportType ?? 0);
      const fileName = String(meta.fileName ?? `${labelId}.fit`).trim();
      try {
        const data = Buffer.from(item.resource.blob, 'base64');
        if (data.length > 0) {
          resources.push({
            labelId,
            sportType,
            fileName,
            data,
          });
        }
      } catch (err) {
        log(
          'warn',
          `Failed to decode base64 FIT blob for labelId ${labelId}: ${err}`
        );
      }
    }
  }

  return resources;
}

/**
 * Detects whether a COROS tool response text signals a server or anomaly error.
 */
export function detectCorosToolError(
  text: string,
  isError = false
): string | null {
  if (isError) {
    return 'COROS tool returned isError=true';
  }
  const lower = text.toLowerCase();
  for (const phrase of COROS_ERROR_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      return `COROS tool error detected: ${phrase}`;
    }
  }
  if (
    /tool call anomalies|rate limit exceeded|quota exceeded|limit exceeded/i.test(
      text
    )
  ) {
    return 'COROS tool error detected';
  }
  return null;
}

/**
 * Detects whether a COROS tool response text represents an empty / no-data response.
 */
export function isCorosNoDataText(text: string): boolean {
  const trimmed = text.trim();
  for (const pattern of COROS_NO_DATA_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  return false;
}

function parseDurationSeconds(durationStr: string): number | undefined {
  const parts = durationStr.split(':').map((p) => Number(p.trim()));
  if (parts.some((p) => isNaN(p) || p < 0)) return undefined;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}

/**
 * Parses querySportRecords human-readable report text into structured records.
 */
export function parseSportRecords(report: string): {
  records: CorosSportRecord[];
  returnedCount: number | null;
} {
  const records: CorosSportRecord[] = [];
  if (!report || typeof report !== 'string') {
    return { records, returnedCount: null };
  }

  // Header returned count check, e.g. "Sport Records — 2023-01-01 to 2026-09-27 (3 records)"
  const headerCountMatch = report.match(/\((\d+)\s+records?\)/i);
  const returnedCount = headerCountMatch
    ? parseInt(headerCountMatch[1], 10)
    : null;

  if (isCorosNoDataText(report)) {
    return { records, returnedCount: 0 };
  }

  // Split on numbered list items (e.g. "\n\n1. " or at start of string "1. ")
  const blocks = report.split(/(?:^|\n+)(?=\d+\.\s+)/m);

  for (const block of blocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;

    // Must start with "1. Name — YYYY-MM-DD" (em-dash U+2014, en-dash U+2013, or hyphen)
    const headerMatch = trimmedBlock.match(
      /^\d+\.\s+(.+?)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})/m
    );
    if (!headerMatch) {
      continue;
    }

    const name = headerMatch[1].trim();
    const date = headerMatch[2].trim();

    const labelIdMatch = trimmedBlock.match(/LabelId:\s*(\d+)/i);
    const sportTypeMatch = trimmedBlock.match(/SportType:\s*(\d+)/i);

    if (!labelIdMatch || !sportTypeMatch) {
      log(
        'warn',
        `Skipping malformed COROS sport record block without LabelId or SportType:\n${trimmedBlock}`
      );
      continue;
    }

    const labelId = labelIdMatch[1];
    const sportType = parseInt(sportTypeMatch[1], 10);

    const record: CorosSportRecord = {
      labelId,
      sportType,
      name,
      date,
    };

    // Optional fields
    const startTsMatch = trimmedBlock.match(/startTimestamp=(\d+)/i);
    if (startTsMatch) {
      record.startTimestamp = parseInt(startTsMatch[1], 10);
    }

    const endTsMatch = trimmedBlock.match(/endTimestamp=(\d+)/i);
    if (endTsMatch) {
      record.endTimestamp = parseInt(endTsMatch[1], 10);
    }

    const durationMatch = trimmedBlock.match(/Duration:\s*([\d:]+)/i);
    if (durationMatch) {
      const durSec = parseDurationSeconds(durationMatch[1]);
      if (durSec !== undefined) {
        record.durationSeconds = durSec;
      }
    }

    const distanceMatch = trimmedBlock.match(
      /Distance:\s*([\d.]+)\s*(km|m)\b/i
    );
    if (distanceMatch) {
      const val = parseFloat(distanceMatch[1]);
      const unit = distanceMatch[2].toLowerCase();
      if (!isNaN(val)) {
        record.distanceMeters =
          unit === 'km' ? Math.round(val * 1000) : Math.round(val);
      }
    }

    const hrMatch = trimmedBlock.match(/Avg HR:\s*(\d+)/i);
    if (hrMatch) {
      record.avgHeartRate = parseInt(hrMatch[1], 10);
    }

    const caloriesMatch = trimmedBlock.match(/Calories:\s*(\d+)/i);
    if (caloriesMatch) {
      record.calories = parseInt(caloriesMatch[1], 10);
    }

    const locationMatch = trimmedBlock.match(
      /Location:\s*(.+?)(?=\n\s*(?:Start Coordinates|Time Window|Duration|Average|Avg HR|Calories|LabelId)|\n*$|$)/is
    );
    if (locationMatch) {
      record.location = locationMatch[1].trim();
    }

    records.push(record);
  }

  return { records, returnedCount };
}
