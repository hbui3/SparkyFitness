/**
 * Whether this instance leaves scheduled jobs to another instance.
 *
 * Jobs start in only two places: scheduleBackgroundJobs() at startup and
 * rescheduleBackups() when an admin changes the backup schedule. With jobs
 * disabled here, a backup schedule change reaches the jobs instance through
 * its 5-minute settings re-check in backupScheduler.ts.
 */
export function scheduledJobsDisabled(): boolean {
  return process.env.SPARKY_FITNESS_DISABLE_SCHEDULED_JOBS === 'true';
}
