import { fileURLToPath } from 'node:url';
import { igpsportRegionSchema, todayInZone } from '@workspace/shared';
import dotenv from 'dotenv';
import { transformFitActivity } from '../integrations/garminfit/fitActivityTransform.js';
import { decodeFitBuffer } from '../integrations/garminfit/fitDecoder.js';
import { IGPSportApiClient } from '../integrations/igpsport/igpsportApiClient.js';
import {
  extractGarminGpsPoints,
  extractGarminHrZones,
  extractGarminLaps,
  extractGarminTelemetryFields,
} from '../services/garmin/garminTelemetryExtractors.js';

dotenv.config({
  path: fileURLToPath(new URL('../.env.igpsport.local', import.meta.url)),
});

const username = process.env.IGPSPORT_TEST_USERNAME?.trim();
const password = process.env.IGPSPORT_TEST_PASSWORD;
const region = igpsportRegionSchema.parse(
  process.env.IGPSPORT_TEST_REGION || 'Global'
);
const timezone = process.env.IGPSPORT_TEST_TIMEZONE || 'Europe/Berlin';

if (!username || !password) {
  throw new Error(
    'Set IGPSPORT_TEST_USERNAME and IGPSPORT_TEST_PASSWORD for the local smoke test.'
  );
}

const client = new IGPSportApiClient({ region, timezone });
await client.login(username, password);

const page = await client.getActivitiesPage(
  '2010-01-01',
  todayInZone(timezone),
  1
);
console.log(
  `iGPSPORT login succeeded (${region}); ${page.totalRows} activities reported across ${page.totalPages} pages.`
);

const firstActivity = page.activities[0];
if (!firstActivity) {
  console.log('No activity is available for a FIT download smoke test.');
} else {
  const downloadUrl = await client.getActivityDownloadUrl(firstActivity.rideId);
  const fitBuffer = await client.downloadFitFile(downloadUrl);
  const decoded = decodeFitBuffer(fitBuffer);
  if (!decoded.isFit || !decoded.messages) {
    throw new Error(
      'The downloaded iGPSPORT activity is not a readable FIT file.'
    );
  }

  const transformed = transformFitActivity(decoded.messages, fitBuffer);
  if (!transformed.ok) {
    throw new Error(
      `SparkyFitness could not transform the downloaded FIT file: ${transformed.reason}`
    );
  }
  const detailRecord = transformed.detailData as unknown as Record<
    string,
    unknown
  >;
  const populatedTelemetryFields = Object.values(
    extractGarminTelemetryFields(detailRecord)
  ).filter((value) => value !== null && value !== undefined).length;

  console.log(
    `FIT download succeeded (${fitBuffer.length} bytes, integrity ${decoded.integrityOk ? 'valid' : 'warning'}).`
  );
  console.log(
    `SparkyFitness transform succeeded (${extractGarminLaps(detailRecord).length} laps, ${extractGarminGpsPoints(detailRecord).length} GPS points, ${extractGarminHrZones(detailRecord).length} heart-rate zones, ${populatedTelemetryFields} telemetry fields).`
  );
}
