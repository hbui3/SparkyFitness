import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  validate: vi.fn(),
  getBackupSettings: vi.fn(),
  log: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: { schedule: mocks.schedule, validate: mocks.validate },
}));
vi.mock('../models/backupSettingsRepository.js', () => ({
  default: { getBackupSettings: mocks.getBackupSettings },
}));
vi.mock('../services/backupService.js', () => ({
  performBackup: vi.fn(),
  applyRetentionPolicy: vi.fn(),
}));
vi.mock('../config/logging.js', () => ({ log: mocks.log }));

import { rescheduleBackups } from '../services/backupScheduler.js';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SPARKY_FITNESS_DISABLE_SCHEDULED_JOBS', 'false');
  mocks.validate.mockReturnValue(true);
  mocks.schedule.mockReturnValue({ stop: vi.fn(), destroy: vi.fn() });
  mocks.getBackupSettings.mockResolvedValue({
    backup_enabled: true,
    backup_time: '02:00',
    backup_days: [],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('rescheduleBackups', () => {
  it('applies a new schedule immediately on an instance that runs jobs', async () => {
    await rescheduleBackups();
    expect(mocks.schedule).toHaveBeenCalledOnce();
  });

  it('leaves the schedule to the jobs instance when jobs are disabled here', async () => {
    vi.stubEnv('SPARKY_FITNESS_DISABLE_SCHEDULED_JOBS', 'true');
    await rescheduleBackups();
    expect(mocks.getBackupSettings).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('applies them within 5 minutes')
    );
  });
});
