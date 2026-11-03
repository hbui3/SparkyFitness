import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export default function TrainingTimelineError({
  onRetry,
}: {
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm"
    >
      <p>
        {t(
          'trainingTimeline.failedToLoad',
          'Failed to load the training timeline.'
        )}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        {t('trainingTimeline.retry', 'Try again')}
      </Button>
    </div>
  );
}
