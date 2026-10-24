import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { SymptomEntryResponse } from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/utils';
import { SEVERITY_BAND_CLASS } from './symptomHelpers';
import {
  formatDuration,
  minutesBetween,
  severityBand,
} from '@workspace/shared';

interface SymptomHistoryListProps {
  entries: SymptomEntryResponse[];
  loading: boolean;
  onOpen: (entry: SymptomEntryResponse) => void;
}

/** Recent entries and episodes, newest first. Selecting one opens its detail. */
export default function SymptomHistoryList({
  entries,
  loading,
  onOpen,
}: SymptomHistoryListProps) {
  const { t } = useTranslation();
  const { formatDateInUserTimezone, formatTime } = usePreferences();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {t('symptoms.history.title', 'Recent symptoms')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && (
          <p className="text-sm text-muted-foreground">
            {t('symptoms.history.loading', 'Loading…')}
          </p>
        )}
        {!loading && entries.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t(
              'symptoms.history.empty',
              'Nothing logged in the past 30 days. Use the form to log a symptom.'
            )}
          </p>
        )}
        {entries.map((entry) => {
          const at = entry.started_at ?? entry.logged_at;
          const band =
            entry.severity != null
              ? severityBand(entry.severity, '1-10')
              : null;
          const isEpisode = entry.started_at != null;
          const details = [
            ...entry.body_locations,
            ...entry.triggers.slice(0, 2),
          ].join(' · ');
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onOpen(entry)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold capitalize">
                    {entry.symptom_name_snapshot.replace(/_/g, ' ')}
                  </span>
                  {band && entry.severity != null && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'border-none text-[10px] font-semibold',
                        SEVERITY_BAND_CLASS[band]
                      )}
                    >
                      {entry.severity}
                    </Badge>
                  )}
                  {isEpisode && (
                    <Badge variant="outline" className="text-[10px]">
                      {entry.ended_at
                        ? formatDuration(minutesBetween(at, entry.ended_at))
                        : t('symptoms.episode.ongoing', 'ongoing')}
                    </Badge>
                  )}
                  {entry.source === 'cycle' && (
                    <Badge variant="outline" className="text-[10px]">
                      {t('symptoms.history.cycle', 'Cycle')}
                    </Badge>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {formatDateInUserTimezone(at, 'PP')} · {formatTime(at)}
                  {details && ` · ${details}`}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
