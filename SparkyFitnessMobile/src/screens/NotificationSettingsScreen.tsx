import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import Toast from 'react-native-toast-message';

import Icon from '../components/Icon';
import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import NotificationPermissionBanner, {
  type NotificationPermissionBannerHandle,
} from '../components/NotificationPermissionBanner';
import SegmentedControl from '../components/SegmentedControl';
import TimeSheet, { type TimeSheetRef } from '../components/TimeSheet';
import Switch from '../components/ui/Switch';
import {
  maybePromptForExactAlarmPermission,
  requestNotificationPermission,
  setNotificationsEnabled,
  setRestTimerNotificationsEnabled,
} from '../services/notifications';
import {
  MEDICATION_REMINDER_SNOOZE_OPTIONS,
  WATER_REMINDER_INTERVAL_OPTIONS,
  useAppPreferencesStore,
  type MedicationReminderSnoozeMinutes,
  type WaterReminderIntervalHours,
} from '../stores/appPreferencesStore';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { usePreferences } from '../hooks/usePreferences';
import { markCheckinReminderOfferShown } from '../services/checkinReminderOffer';
import { MAX_CHECKIN_REMINDERS } from '../utils/checkinReminderTimes';
import { formatTimeLabel } from '../utils/entryTimeDisplay';
import { isValidReminderWindow } from '../utils/hydrationReminder';
import type { RootStackScreenProps } from '../types/navigation';

type IntervalKey = `${WaterReminderIntervalHours}`;
type SnoozeMinutesKey = `${MedicationReminderSnoozeMinutes}`;

type NotificationSettingsScreenProps =
  RootStackScreenProps<'NotificationSettings'>;

const NotificationSettingsScreen: React.FC<
  NotificationSettingsScreenProps
> = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const notificationsEnabled = useAppPreferencesStore(
    (s) => s.notificationsEnabled
  );
  const restTimerNotificationsEnabled = useAppPreferencesStore(
    (s) => s.restTimerNotificationsEnabled
  );
  const fastingGoalNotificationsEnabled = useAppPreferencesStore(
    (s) => s.fastingGoalNotificationsEnabled
  );
  const setFastingGoalNotificationsEnabled = useAppPreferencesStore(
    (s) => s.setFastingGoalNotificationsEnabled
  );
  const medicationRemindersEnabled = useAppPreferencesStore(
    (s) => s.medicationRemindersEnabled
  );
  const setMedicationRemindersEnabled = useAppPreferencesStore(
    (s) => s.setMedicationRemindersEnabled
  );
  const medicationReminderRepeats = useAppPreferencesStore(
    (s) => s.medicationReminderRepeats
  );
  const setMedicationReminderRepeats = useAppPreferencesStore(
    (s) => s.setMedicationReminderRepeats
  );
  const medicationReminderHideNames = useAppPreferencesStore(
    (s) => s.medicationReminderHideNames
  );
  const setMedicationReminderHideNames = useAppPreferencesStore(
    (s) => s.setMedicationReminderHideNames
  );
  const medicationReminderConsolidate = useAppPreferencesStore(
    (s) => s.medicationReminderConsolidate
  );
  const setMedicationReminderConsolidate = useAppPreferencesStore(
    (s) => s.setMedicationReminderConsolidate
  );
  const medicationReminderSnoozeMinutes = useAppPreferencesStore(
    (s) => s.medicationReminderSnoozeMinutes
  );
  const setMedicationReminderSnoozeMinutes = useAppPreferencesStore(
    (s) => s.setMedicationReminderSnoozeMinutes
  );
  const waterReminderEnabled = useAppPreferencesStore(
    (s) => s.waterReminderEnabled
  );
  const setWaterReminderEnabled = useAppPreferencesStore(
    (s) => s.setWaterReminderEnabled
  );
  const waterReminderIntervalHours = useAppPreferencesStore(
    (s) => s.waterReminderIntervalHours
  );
  const setWaterReminderIntervalHours = useAppPreferencesStore(
    (s) => s.setWaterReminderIntervalHours
  );
  const waterReminderWindowStart = useAppPreferencesStore(
    (s) => s.waterReminderWindowStart
  );
  const waterReminderWindowEnd = useAppPreferencesStore(
    (s) => s.waterReminderWindowEnd
  );
  const setWaterReminderWindow = useAppPreferencesStore(
    (s) => s.setWaterReminderWindow
  );
  const checkinRemindersEnabled = useAppPreferencesStore(
    (s) => s.checkinRemindersEnabled
  );
  const setCheckinRemindersEnabled = useAppPreferencesStore(
    (s) => s.setCheckinRemindersEnabled
  );
  const checkinReminderTimes = useAppPreferencesStore(
    (s) => s.checkinReminderTimes
  );
  const setCheckinReminderTimes = useAppPreferencesStore(
    (s) => s.setCheckinReminderTimes
  );
  const { preferences } = usePreferences();
  const checkinTimeSheetRef = useRef<TimeSheetRef>(null);
  // `nonce` makes reopening the same row a fresh request; the sheet reads its
  // value at present() time, so presenting waits for the render that applies it.
  const [editingCheckin, setEditingCheckin] = useState<{
    index: number;
    nonce: number;
  } | null>(null);
  const startTimeSheetRef = useRef<TimeSheetRef>(null);
  const endTimeSheetRef = useRef<TimeSheetRef>(null);
  const [secondaryColor] = useCSSVariable(['--color-text-secondary']) as [
    string,
  ];
  const usesNativeHeader = useNativeIOSHeadersActive();
  const bannerRef = useRef<NotificationPermissionBannerHandle>(null);

  const handleNotificationsToggle = useCallback(async (value: boolean) => {
    if (!value) {
      await setNotificationsEnabled(false);
      return;
    }
    // Ask first: switching on without permission would let reminders be
    // rescheduled (and cancelled) before the grant arrives, and a denial
    // would leave the toggle showing on. The banner explains a denial.
    const status = await requestNotificationPermission();
    bannerRef.current?.refresh();
    if (status === 'granted') await setNotificationsEnabled(true);
  }, []);

  const handleMedicationRemindersToggle = useCallback(
    async (value: boolean) => {
      if (!value) {
        setMedicationRemindersEnabled(false);
        return;
      }
      const status = await requestNotificationPermission();
      bannerRef.current?.refresh();
      // Without OS permission the toggle would show "on" while reminders
      // silently never fire; leave it off until permission is granted. The
      // permission banner above explains and links to system settings.
      if (status === 'granted') {
        setMedicationRemindersEnabled(true);
        // Scheduled reminders ring late on Android without the exact-alarm
        // special access; nudge once when the user opts in.
        await maybePromptForExactAlarmPermission();
      }
    },
    [setMedicationRemindersEnabled]
  );

  const handleWaterRemindersToggle = useCallback(
    async (value: boolean) => {
      if (!value) {
        setWaterReminderEnabled(false);
        return;
      }
      const status = await requestNotificationPermission();
      bannerRef.current?.refresh();
      // Same rule as medication reminders: never show "on" while the OS would
      // silently drop every reminder.
      if (status === 'granted') setWaterReminderEnabled(true);
    },
    [setWaterReminderEnabled]
  );

  const handleCheckinRemindersToggle = useCallback(
    async (value: boolean) => {
      // Whoever uses this toggle has made their choice; skip the one-time offer.
      void markCheckinReminderOfferShown();
      if (!value) {
        setCheckinRemindersEnabled(false);
        return;
      }
      const status = await requestNotificationPermission();
      bannerRef.current?.refresh();
      // Same rule as the other reminders: never show "on" while the OS would
      // silently drop every reminder.
      if (status === 'granted') setCheckinRemindersEnabled(true);
    },
    [setCheckinRemindersEnabled]
  );

  useEffect(() => {
    if (editingCheckin) checkinTimeSheetRef.current?.present();
  }, [editingCheckin]);

  const openCheckinTimeSheet = useCallback((index: number) => {
    setEditingCheckin((prev) => ({ index, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const handleCheckinTimeSelect = useCallback(
    (time: string) => {
      if (!editingCheckin) return;
      const next = [...checkinReminderTimes];
      next[editingCheckin.index] = time;
      setCheckinReminderTimes(next);
    },
    [editingCheckin, checkinReminderTimes, setCheckinReminderTimes]
  );

  const handleRemoveCheckinTime = useCallback(
    (index: number) => {
      setCheckinReminderTimes(
        checkinReminderTimes.filter((_, i) => i !== index)
      );
    },
    [checkinReminderTimes, setCheckinReminderTimes]
  );

  const handleAddCheckinTime = useCallback(() => {
    // Start at noon and take the first free hour after it (wrapping).
    let newTime = '12:00';
    for (let offset = 0; offset < 24; offset++) {
      const candidate = `${String((12 + offset) % 24).padStart(2, '0')}:00`;
      if (!checkinReminderTimes.includes(candidate)) {
        newTime = candidate;
        break;
      }
    }
    const next = [...checkinReminderTimes, newTime].sort();
    setCheckinReminderTimes(next);
    openCheckinTimeSheet(next.indexOf(newTime));
  }, [checkinReminderTimes, setCheckinReminderTimes, openCheckinTimeSheet]);

  const intervalSegments = useMemo(
    () =>
      WATER_REMINDER_INTERVAL_OPTIONS.map((hours) => ({
        key: String(hours) as IntervalKey,
        label: t('notificationSettings.waterReminderIntervalOption', {
          defaultValue: '{{hours}}h',
          hours,
        }),
      })),
    [t]
  );

  const handleIntervalSelect = useCallback(
    (key: IntervalKey) => {
      setWaterReminderIntervalHours(Number(key) as WaterReminderIntervalHours);
    },
    [setWaterReminderIntervalHours]
  );

  const showInvalidWindowToast = useCallback(() => {
    Toast.show({
      type: 'error',
      text1: t('notificationSettings.waterReminderInvalidWindow', {
        defaultValue: 'End time must be after start time.',
      }),
    });
  }, [t]);

  const handleStartTimeSelect = useCallback(
    (time: string) => {
      if (!isValidReminderWindow(time, waterReminderWindowEnd)) {
        showInvalidWindowToast();
        return;
      }
      setWaterReminderWindow(time, waterReminderWindowEnd);
    },
    [waterReminderWindowEnd, setWaterReminderWindow, showInvalidWindowToast]
  );

  const handleEndTimeSelect = useCallback(
    (time: string) => {
      if (!isValidReminderWindow(waterReminderWindowStart, time)) {
        showInvalidWindowToast();
        return;
      }
      setWaterReminderWindow(waterReminderWindowStart, time);
    },
    [waterReminderWindowStart, setWaterReminderWindow, showInvalidWindowToast]
  );

  const startTimeLabel =
    formatTimeLabel(waterReminderWindowStart, preferences?.time_format) ??
    waterReminderWindowStart;
  const endTimeLabel =
    formatTimeLabel(waterReminderWindowEnd, preferences?.time_format) ??
    waterReminderWindowEnd;

  const snoozeSegments = useMemo(
    () =>
      MEDICATION_REMINDER_SNOOZE_OPTIONS.map((minutes) => ({
        key: String(minutes) as SnoozeMinutesKey,
        label: t('notificationSettings.snoozeMinutesOption', {
          defaultValue: '{{minutes}}m',
          minutes,
        }),
      })),
    [t]
  );

  const header = useScreenHeader({
    title: t('notificationSettings.title', { defaultValue: 'Notifications' }),
    left: { kind: 'back' },
  });

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={
          usesNativeHeader ? 'automatic' : 'never'
        }
      >
        <SettingsRow
          title={t('notificationSettings.allow', {
            defaultValue: 'Allow Notifications',
          })}
          subtitle={t('notificationSettings.allowSubtitle', {
            defaultValue: 'Master switch for all alerts from SparkyFitness.',
          })}
          subtitleNumberOfLines={0}
          rightAccessory={
            <Switch
              accessibilityLabel={t('notificationSettings.allow', {
                defaultValue: 'Allow Notifications',
              })}
              value={notificationsEnabled}
              onValueChange={handleNotificationsToggle}
            />
          }
        />

        <NotificationPermissionBanner ref={bannerRef} />

        {notificationsEnabled && (
          <SettingsRowGroup
            title={t('notificationSettings.alerts', { defaultValue: 'Alerts' })}
          >
            <SettingsRow
              title={t('notificationSettings.restTimer', {
                defaultValue: 'Rest Timer',
              })}
              subtitle={t('notificationSettings.restTimerSubtitle', {
                defaultValue:
                  'Alert when a rest period ends, even in the background.',
              })}
              subtitleNumberOfLines={0}
              rightAccessory={
                <Switch
                  accessibilityLabel={t('notificationSettings.restTimer', {
                    defaultValue: 'Rest Timer',
                  })}
                  value={restTimerNotificationsEnabled}
                  onValueChange={(value) =>
                    void setRestTimerNotificationsEnabled(value)
                  }
                />
              }
            />
            <SettingsRow
              title={t('notificationSettings.fastingGoals', {
                defaultValue: 'Fasting Goals',
              })}
              subtitle={t('notificationSettings.fastingGoalsSubtitle', {
                defaultValue: 'Alert when you reach your fasting goal.',
              })}
              subtitleNumberOfLines={0}
              rightAccessory={
                <Switch
                  accessibilityLabel={t('notificationSettings.fastingGoals', {
                    defaultValue: 'Fasting Goals',
                  })}
                  value={fastingGoalNotificationsEnabled}
                  onValueChange={setFastingGoalNotificationsEnabled}
                />
              }
            />
          </SettingsRowGroup>
        )}

        {notificationsEnabled && (
          <SettingsRowGroup
            title={t('notificationSettings.medications', {
              defaultValue: 'Medications',
            })}
          >
            <SettingsRow
              title={t('notificationSettings.medicationReminders', {
                defaultValue: 'Medication Reminders',
              })}
              subtitle={t('notificationSettings.medicationRemindersSubtitle', {
                defaultValue: 'Reminders for scheduled medications.',
              })}
              subtitleNumberOfLines={0}
              rightAccessory={
                <Switch
                  accessibilityLabel={t(
                    'notificationSettings.medicationReminders',
                    { defaultValue: 'Medication Reminders' }
                  )}
                  value={medicationRemindersEnabled}
                  onValueChange={handleMedicationRemindersToggle}
                />
              }
            />
            {medicationRemindersEnabled && (
              <SettingsRow
                title={t('notificationSettings.repeatReminders', {
                  defaultValue: 'Repeat Reminders',
                })}
                subtitle={t('notificationSettings.repeatRemindersSubtitle', {
                  defaultValue:
                    'Repeat each reminder every 10 minutes, up to 3 times, until the dose is logged.',
                })}
                subtitleNumberOfLines={0}
                rightAccessory={
                  <Switch
                    accessibilityLabel={t(
                      'notificationSettings.repeatReminders',
                      { defaultValue: 'Repeat Reminders' }
                    )}
                    value={medicationReminderRepeats}
                    onValueChange={setMedicationReminderRepeats}
                  />
                }
              />
            )}
            {medicationRemindersEnabled && (
              <SettingsRow
                title={t('notificationSettings.hideMedicationNames', {
                  defaultValue: 'Hide Medication Names',
                })}
                subtitle={t(
                  'notificationSettings.hideMedicationNamesSubtitle',
                  {
                    defaultValue:
                      'Show a generic reminder instead of the medication name and dose.',
                  }
                )}
                subtitleNumberOfLines={0}
                rightAccessory={
                  <Switch
                    accessibilityLabel={t(
                      'notificationSettings.hideMedicationNames',
                      { defaultValue: 'Hide Medication Names' }
                    )}
                    value={medicationReminderHideNames}
                    onValueChange={setMedicationReminderHideNames}
                  />
                }
              />
            )}
            {medicationRemindersEnabled && (
              <SettingsRow
                title={t('notificationSettings.consolidateReminders', {
                  defaultValue: 'Consolidate Reminders',
                })}
                subtitle={t(
                  'notificationSettings.consolidateRemindersSubtitle',
                  {
                    defaultValue:
                      'Group medications scheduled for the same time into a single notification.',
                  }
                )}
                subtitleNumberOfLines={0}
                rightAccessory={
                  <Switch
                    accessibilityLabel={t(
                      'notificationSettings.consolidateReminders',
                      { defaultValue: 'Consolidate Reminders' }
                    )}
                    value={medicationReminderConsolidate}
                    onValueChange={setMedicationReminderConsolidate}
                  />
                }
              />
            )}
            {medicationRemindersEnabled && (
              <SettingsRow
                title={t('notificationSettings.medicationSnoozeInterval', {
                  defaultValue: 'Remind In',
                })}
                subtitle={
                  <View className="mt-2">
                    <SegmentedControl
                      segments={snoozeSegments}
                      activeKey={
                        String(
                          medicationReminderSnoozeMinutes
                        ) as SnoozeMinutesKey
                      }
                      onSelect={(key) =>
                        setMedicationReminderSnoozeMinutes(
                          Number(key) as MedicationReminderSnoozeMinutes
                        )
                      }
                    />
                  </View>
                }
              />
            )}
          </SettingsRowGroup>
        )}

        {notificationsEnabled && (
          <SettingsRowGroup
            title={t('notificationSettings.hydration', {
              defaultValue: 'Hydration',
            })}
          >
            <SettingsRow
              title={t('notificationSettings.waterReminders', {
                defaultValue: 'Water Reminders',
              })}
              subtitle={t('notificationSettings.waterRemindersSubtitle', {
                defaultValue:
                  "Remind you to drink when you haven't logged water in a while.",
              })}
              subtitleNumberOfLines={0}
              rightAccessory={
                <Switch
                  accessibilityLabel={t('notificationSettings.waterReminders', {
                    defaultValue: 'Water Reminders',
                  })}
                  value={waterReminderEnabled}
                  onValueChange={handleWaterRemindersToggle}
                />
              }
            />
            {waterReminderEnabled && (
              <SettingsRow
                title={t('notificationSettings.waterReminderInterval', {
                  defaultValue: 'Remind After',
                })}
                subtitle={
                  <View className="mt-2">
                    <SegmentedControl
                      segments={intervalSegments}
                      activeKey={
                        String(waterReminderIntervalHours) as IntervalKey
                      }
                      onSelect={handleIntervalSelect}
                    />
                  </View>
                }
              />
            )}
            {waterReminderEnabled && (
              <SettingsRow
                title={t('notificationSettings.waterReminderStart', {
                  defaultValue: 'Start Time',
                })}
                onPress={() => startTimeSheetRef.current?.present()}
                accessibilityLabel={t(
                  'notificationSettings.waterReminderStartAccessibility',
                  { defaultValue: 'Start time, {{time}}', time: startTimeLabel }
                )}
                rightAccessory={
                  <Text className="text-sm text-text-secondary">
                    {startTimeLabel}
                  </Text>
                }
              />
            )}
            {waterReminderEnabled && (
              <SettingsRow
                title={t('notificationSettings.waterReminderEnd', {
                  defaultValue: 'End Time',
                })}
                onPress={() => endTimeSheetRef.current?.present()}
                accessibilityLabel={t(
                  'notificationSettings.waterReminderEndAccessibility',
                  { defaultValue: 'End time, {{time}}', time: endTimeLabel }
                )}
                rightAccessory={
                  <Text className="text-sm text-text-secondary">
                    {endTimeLabel}
                  </Text>
                }
              />
            )}
          </SettingsRowGroup>
        )}

        {notificationsEnabled && (
          <SettingsRowGroup
            title={t('notificationSettings.moodCheckins', {
              defaultValue: 'Mood check-ins',
            })}
          >
            <SettingsRow
              title={t('notificationSettings.moodCheckinReminders', {
                defaultValue: 'Check-in reminders',
              })}
              subtitle={t('notificationSettings.moodCheckinRemindersSubtitle', {
                defaultValue: 'A daily nudge to log how you feel',
              })}
              subtitleNumberOfLines={0}
              rightAccessory={
                <Switch
                  accessibilityLabel={t(
                    'notificationSettings.moodCheckinReminders',
                    { defaultValue: 'Check-in reminders' }
                  )}
                  value={checkinRemindersEnabled}
                  onValueChange={handleCheckinRemindersToggle}
                />
              }
            />
            {checkinRemindersEnabled &&
              checkinReminderTimes.map((time, index) => {
                const timeLabel = formatTimeLabel(
                  time,
                  preferences?.time_format
                );
                const removeLabel = t(
                  'notificationSettings.moodCheckinRemoveReminder',
                  {
                    defaultValue: 'Remove reminder {{number}}',
                    number: index + 1,
                  }
                );
                const canRemove = checkinReminderTimes.length > 1;
                return (
                  <SettingsRow
                    key={time}
                    title={t('notificationSettings.moodCheckinReminderTime', {
                      defaultValue: 'Reminder {{number}}',
                      number: index + 1,
                    })}
                    accessibilityLabel={t(
                      'notificationSettings.moodCheckinReminderTimeAccessibility',
                      {
                        defaultValue: 'Reminder {{number}}, {{time}}',
                        number: index + 1,
                        time: timeLabel,
                      }
                    )}
                    // The visible remove button sits inside the row's
                    // accessible Pressable, which screen readers can't reach.
                    accessibilityActions={
                      canRemove
                        ? [{ name: 'remove', label: removeLabel }]
                        : undefined
                    }
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === 'remove') {
                        handleRemoveCheckinTime(index);
                      }
                    }}
                    onPress={() => openCheckinTimeSheet(index)}
                    rightAccessory={
                      <View className="flex-row items-center">
                        <Text className="text-sm text-text-secondary">
                          {timeLabel}
                        </Text>
                        {canRemove && (
                          <Pressable
                            onPress={() => handleRemoveCheckinTime(index)}
                            accessibilityRole="button"
                            accessibilityLabel={removeLabel}
                            hitSlop={14}
                            className="ml-3"
                          >
                            <Icon
                              name="close"
                              size={18}
                              color={secondaryColor}
                            />
                          </Pressable>
                        )}
                      </View>
                    }
                  />
                );
              })}
            {checkinRemindersEnabled &&
              checkinReminderTimes.length < MAX_CHECKIN_REMINDERS && (
                <SettingsRow
                  icon="add"
                  title={t('notificationSettings.moodCheckinAddReminder', {
                    defaultValue: 'Add reminder',
                  })}
                  onPress={handleAddCheckinTime}
                  rightAccessory={null}
                />
              )}
          </SettingsRowGroup>
        )}
      </ScrollView>

      <TimeSheet
        ref={checkinTimeSheetRef}
        value={
          editingCheckin
            ? (checkinReminderTimes[editingCheckin.index] ?? '')
            : ''
        }
        onSelectTime={handleCheckinTimeSelect}
        commitOn="done"
      />
      <TimeSheet
        ref={startTimeSheetRef}
        value={waterReminderWindowStart}
        onSelectTime={handleStartTimeSelect}
        commitOn="done"
      />
      <TimeSheet
        ref={endTimeSheetRef}
        value={waterReminderWindowEnd}
        onSelectTime={handleEndTimeSelect}
        commitOn="done"
      />
    </View>
  );
};

export default NotificationSettingsScreen;
