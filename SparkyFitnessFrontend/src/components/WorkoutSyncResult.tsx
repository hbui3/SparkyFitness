import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  workoutSyncSummary,
  type WorkoutSyncResponse,
} from '@/utils/workoutSyncSummary';

export default function WorkoutSyncResult({
  result,
  onRetry,
  isPending,
}: {
  result: WorkoutSyncResponse;
  onRetry: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const counts = workoutSyncSummary(result);
  return (
    <div role="status" className="rounded-md border p-3 text-sm">
      <p>
        {t(
          'integrations.workoutSyncCounts',
          '{{imported}} imported, {{updated}} updated, {{failed}} failed.',
          counts
        )}
      </p>
      <p className="text-muted-foreground">
        {result.startDate} – {result.endDate}
      </p>
      {counts.failed > 0 && (
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={onRetry}
        >
          {t('integrations.retryWorkoutSync', 'Retry this period')}
        </Button>
      )}
    </div>
  );
}
