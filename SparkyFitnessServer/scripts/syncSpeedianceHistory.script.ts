import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { endPool, getSystemClient } from '../db/poolManager.js';
import { log } from '../config/logging.js';
import { loadSecrets } from '../utils/secretLoader.js';
import { syncSpeedianceData } from '../integrations/speediance/speedianceService.js';

interface SpeedianceProviderRow {
  id: string;
  user_id: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadActiveProviders(): Promise<SpeedianceProviderRow[]> {
  const client = await getSystemClient();
  try {
    const result = await client.query(
      `SELECT id, user_id
       FROM external_data_providers
       WHERE provider_type = 'speediance' AND is_active = TRUE
       ORDER BY created_at ASC`
    );
    return result.rows as SpeedianceProviderRow[];
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  loadSecrets();
  const dryRun = process.argv.includes('--dry-run');
  const providers = await loadActiveProviders();

  log(
    'info',
    `[syncSpeedianceHistory] Found ${providers.length} active Speediance provider(s)${dryRun ? ' (dry run)' : ''}.`
  );
  if (dryRun) return;

  let importedWorkouts = 0;
  let importedExercises = 0;
  let skippedWorkouts = 0;
  for (const provider of providers) {
    const result = await syncSpeedianceData(
      provider.user_id,
      provider.user_id,
      {
        providerId: provider.id,
        fullSync: true,
      }
    );
    importedWorkouts += result.importedWorkouts;
    importedExercises += result.importedExercises;
    skippedWorkouts += result.skippedWorkouts;
  }

  log(
    'info',
    `[syncSpeedianceHistory] Complete: ${importedWorkouts} workouts, ${importedExercises} exercises, ${skippedWorkouts} skipped.`
  );
}

run()
  .catch((error: unknown) => {
    log('error', '[syncSpeedianceHistory] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await endPool();
  });
