import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import {
  addDays,
  todayInZone,
  type SharedSymptomEntry,
  type SymptomEntryResponse,
  buildSymptomChoices,
  recentSymptomNames,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useCustomSymptoms,
  useMarkSymptomFreeMutation,
  useOngoingEpisodes,
  useSymptomEntries,
  useSymptomFreeDays,
  useUnmarkSymptomFreeMutation,
} from '@/hooks/useSymptoms';
import type { MedicationDetail, MedicationEntry } from '@/types/medications';
import SymptomHistoryCalendar from '@/pages/Medications/SymptomHistoryCalendar';
import EpisodeDetailDialog from './EpisodeDetailDialog';
import ManageSymptomsDialog from './ManageSymptomsDialog';
import OngoingEpisodeCard from './OngoingEpisodeCard';
import SymptomCalendar from './SymptomCalendar';
import SymptomHistoryList from './SymptomHistoryList';
import SymptomLogForm from './SymptomLogForm';

interface SymptomsHubProps {
  selectedDate: string;
  onDateChange: (day: string) => void;
  meds: MedicationDetail[];
  /**
   * 'checkin' shows the plain symptom calendar; 'medications' shows the dose
   * overlay calendar and needs `recentMedicationEntries`.
   */
  variant?: 'checkin' | 'medications';
  recentMedicationEntries?: MedicationEntry[];
}

/**
 * The symptom tracker: the log form, what is happening now, recent history and
 * a calendar. Used on the Check-in page, and on the Medications page where the
 * same data is shown next to doses.
 */
export default function SymptomsHub({
  selectedDate,
  onDateChange,
  meds,
  variant = 'checkin',
  recentMedicationEntries = [],
}: SymptomsHubProps) {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const today = todayInZone(timezone);

  const { data: definitions = [], isLoading: isDefinitionsLoading } =
    useCustomSymptoms();
  const { data: ongoing = [] } = useOngoingEpisodes();
  const { data: entries = [], isLoading } = useSymptomEntries({
    fromDate: addDays(selectedDate, -30),
    toDate: selectedDate,
  });
  const { data: freeToday = [] } = useSymptomFreeDays({
    fromDate: selectedDate,
    toDate: selectedDate,
  });
  const markFree = useMarkSymptomFreeMutation();
  const unmarkFree = useUnmarkSymptomFreeMutation();

  const [manageOpen, setManageOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SymptomEntryResponse | null>(null);
  const [formSymptom, setFormSymptom] = useState<string | undefined>();
  const [formKey, setFormKey] = useState(0);

  const choices = useMemo(
    () => buildSymptomChoices(definitions),
    [definitions]
  );
  const quickChips = useMemo(() => {
    const pinned = choices.filter((c) => c.isPinned).map((c) => c.name);
    const recent = recentSymptomNames(entries);
    return [...new Set([...pinned, ...recent])]
      .slice(0, 6)
      .map((name) => choices.find((c) => c.name === name))
      .filter((c): c is NonNullable<typeof c> => c != null);
  }, [choices, entries]);

  const detailEntry =
    [...ongoing, ...entries].find((e) => e.id === openId) ?? null;
  const markedFree = freeToday.length > 0;

  // The medication calendar predates episodes and needs a numeric severity.
  const medicationLogs: SharedSymptomEntry[] = useMemo(
    () =>
      entries
        .filter((e) => e.severity != null)
        .map((e) => ({ ...e, severity: e.severity as number })),
    [entries]
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t('symptoms.hub.title', 'Symptoms')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              'symptoms.hub.subtitle',
              'Track symptoms and episodes, and see what tends to come with them.'
            )}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setManageOpen(true)}
        >
          <Settings2 className="mr-1.5 h-4 w-4" />
          {t('symptoms.hub.manage', 'Manage')}
        </Button>
      </div>

      <OngoingEpisodeCard
        episodes={ongoing}
        meds={meds}
        onOpen={(entry) => setOpenId(entry.id)}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {t('symptoms.hub.anyToday', 'Any symptoms on {{date}}?', {
                  date:
                    selectedDate === today
                      ? t('symptoms.hub.today', 'today')
                      : selectedDate,
                })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {markedFree ? (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-green-500/10 p-3 text-sm">
                  <span>
                    {t(
                      'symptoms.hub.markedFree',
                      'Marked as a symptom-free day.'
                    )}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={unmarkFree.isPending}
                    onClick={() => unmarkFree.mutate(selectedDate)}
                  >
                    {t('symptoms.hub.undo', 'Undo')}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="self-start"
                  disabled={markFree.isPending}
                  onClick={() => markFree.mutate(selectedDate)}
                >
                  {t('symptoms.hub.noneToday', 'No symptoms')}
                </Button>
              )}
              {quickChips.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('symptoms.hub.logAgain', 'Log again')}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {quickChips.map((c) => (
                      <Button
                        key={c.name}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-full px-3 text-xs"
                        onClick={() => {
                          setFormSymptom(c.name);
                          setFormKey((k) => k + 1);
                        }}
                      >
                        {c.displayName}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <SymptomLogForm
            key={`${selectedDate}-${formKey}`}
            selectedDate={selectedDate}
            today={today}
            meds={meds}
            initialSymptomName={formSymptom}
          />
        </div>

        <div className="flex flex-col gap-6">
          {variant === 'medications' ? (
            <SymptomHistoryCalendar
              selectedDate={selectedDate}
              symptomLogs={medicationLogs}
              recentEntries={recentMedicationEntries}
              onDateChange={onDateChange}
            />
          ) : (
            <SymptomCalendar
              selectedDate={selectedDate}
              onDateChange={onDateChange}
            />
          )}
          <SymptomHistoryList
            entries={entries}
            loading={isLoading}
            onOpen={(entry) => setOpenId(entry.id)}
          />
        </div>
      </div>

      <EpisodeDetailDialog
        entry={detailEntry}
        meds={meds}
        onClose={() => setOpenId(null)}
        onEdit={(entry) => {
          setOpenId(null);
          setEditing(entry);
        }}
      />

      <Dialog
        open={editing != null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('symptoms.detail.editTitle', 'Edit symptom log')}
            </DialogTitle>
          </DialogHeader>
          {editing && !isDefinitionsLoading && (
            <SymptomLogForm
              key={editing.id}
              variant="plain"
              selectedDate={editing.entry_date}
              today={today}
              meds={meds}
              editing={editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <ManageSymptomsDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}
