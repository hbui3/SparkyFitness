import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TouchableOpacity, Pressable } from 'react-native';
import { useCSSVariable } from 'uniwind';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Icon from './Icon';
import { getAppLocale } from '../localization';
import {
  useOngoingEpisodes,
  useSymptomEntriesDetailed,
  useSymptomFreeDays,
  useSymptomActions,
} from '../hooks/useSymptoms';
import { addDays, getTodayDate } from '../utils/dateUtils';
import type { RootStackParamList, TabParamList } from '../types/navigation';

type SymptomsCardNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface SymptomsCardProps {
  navigation: SymptomsCardNavigation;
  date?: string;
}

export default function SymptomsCard({ navigation, date }: SymptomsCardProps) {
  const { t } = useTranslation();
  const today = getTodayDate();
  const selectedDate = date || today;

  const [accentPrimary] = useCSSVariable(['--color-accent-primary']) as [
    string,
  ];

  const [now] = useState(() => Date.now());

  // Past 7 days ending at selectedDate
  const sevenDaysAgo = useMemo(() => addDays(selectedDate, -6), [selectedDate]);

  const { episodes: ongoingEpisodes } = useOngoingEpisodes();
  const { entries: weekEntries } = useSymptomEntriesDetailed({
    fromDate: sevenDaysAgo,
    toDate: selectedDate,
  });
  const { freeDays: weekFreeDays } = useSymptomFreeDays({
    fromDate: sevenDaysAgo,
    toDate: selectedDate,
  });
  const { markFree, unmarkFree } = useSymptomActions();

  // Selected date entries & status
  const todayEntries = useMemo(
    () => weekEntries.filter((e) => e.entry_date === selectedDate),
    [weekEntries, selectedDate]
  );
  const isTodaySymptomFree = useMemo(
    () => weekFreeDays.some((d) => d.entry_date === selectedDate),
    [weekFreeDays, selectedDate]
  );

  const activeOngoing = ongoingEpisodes.length > 0 ? ongoingEpisodes[0] : null;

  const getOngoingDuration = (startedAt: string | null) => {
    if (!startedAt) return '';
    const diffMs = Math.max(0, now - new Date(startedAt).getTime());
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  };

  // Build the 7-day sparkline pips
  const last7Days = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(selectedDate, -i);
      const isFree = weekFreeDays.some((f) => f.entry_date === d);
      const dayEntries = weekEntries.filter((e) => e.entry_date === d);
      const maxSeverity =
        dayEntries.length > 0
          ? Math.max(
              ...dayEntries.map((e) =>
                typeof e.severity === 'number' ? e.severity : 0
              )
            )
          : null;

      let bgColor = 'bg-raised';
      let textColor = 'text-text-muted';
      if (isFree) {
        bgColor = 'bg-emerald-500/15 border border-emerald-500/30';
      } else if (maxSeverity !== null) {
        if (maxSeverity <= 3) {
          bgColor = 'bg-amber-500/20 border border-amber-500/30';
          textColor = 'text-amber-600 dark:text-amber-400';
        } else if (maxSeverity <= 6) {
          bgColor = 'bg-orange-500/20 border border-orange-500/30';
          textColor = 'text-orange-600 dark:text-orange-400';
        } else {
          bgColor = 'bg-red-500/20 border border-red-500/30';
          textColor = 'text-red-600 dark:text-red-400';
        }
      }

      // Short day initial (e.g. M, T, W)
      const [y, m, dayNum] = d.split('-').map(Number);
      const dateObj = new Date(y, m - 1, dayNum);
      const weekdayInitial = dateObj.toLocaleDateString(getAppLocale(), {
        weekday: 'narrow',
      });

      days.push({
        date: d,
        isFree,
        severity: maxSeverity,
        bgColor,
        textColor,
        dayLabel: weekdayInitial,
      });
    }
    return days;
  }, [selectedDate, weekFreeDays, weekEntries]);

  const freeDaysCount = useMemo(
    () => last7Days.filter((d) => d.isFree).length,
    [last7Days]
  );

  return (
    <Pressable
      className="bg-surface rounded-xl p-4 mb-3 shadow-sm"
      onPress={() => navigation.navigate('SymptomHistory')}
      accessibilityRole="button"
      accessibilityLabel={t('symptoms.title', { defaultValue: 'Symptoms' })}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <Icon name="symptoms" size={18} color={accentPrimary} />
          <Text className="text-md font-bold text-text-secondary ml-2">
            {t('symptoms.title', { defaultValue: 'Symptoms' })}
          </Text>
        </View>

        <View className="flex-row items-center">
          <Text className="text-xs font-semibold text-accent-primary mr-1">
            {t('symptoms.history', { defaultValue: 'History' })}
          </Text>
          <Icon name="chevron-forward" size={14} color={accentPrimary} />
        </View>
      </View>

      {/* Active Ongoing Episode Banner */}
      {activeOngoing && (
        <TouchableOpacity
          onPress={() =>
            navigation.navigate('SymptomLog', {
              entryId: activeOngoing.id,
              date: activeOngoing.entry_date,
              isOngoing: true,
            })
          }
          className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-3 flex-row items-center justify-between"
        >
          <View className="flex-row items-center flex-1 mr-2">
            <View className="w-2.5 h-2.5 rounded-full bg-amber-500 mr-2" />
            <View className="flex-1">
              <Text className="text-xs font-bold text-amber-500 uppercase tracking-wider">
                {t('symptoms.activeEpisode', {
                  defaultValue: 'Active Episode',
                })}
              </Text>
              <Text
                className="text-sm font-semibold text-text-primary"
                numberOfLines={1}
              >
                {activeOngoing.symptom_name_snapshot ||
                  t('symptoms.symptom', { defaultValue: 'Symptom' })}
                {getOngoingDuration(activeOngoing.started_at)
                  ? ` • ${getOngoingDuration(activeOngoing.started_at)}`
                  : ''}
              </Text>
            </View>
          </View>
          <Icon name="chevron-forward" size={14} color="#f59e0b" />
        </TouchableOpacity>
      )}

      {/* Today's Logged State */}
      {todayEntries.length > 0 ? (
        <View className="space-y-1.5 mb-3">
          {todayEntries.slice(0, 3).map((entry) => (
            <TouchableOpacity
              key={entry.id}
              onPress={() =>
                navigation.navigate('SymptomLog', {
                  entryId: entry.id,
                  date: entry.entry_date,
                })
              }
              className="flex-row items-center justify-between p-2.5 rounded-lg bg-raised border border-border"
            >
              <View className="flex-row items-center flex-1 mr-2">
                <Text
                  className="text-sm font-medium text-text-primary mr-2"
                  numberOfLines={1}
                >
                  {entry.symptom_name_snapshot ||
                    t('symptoms.symptom', { defaultValue: 'Symptom' })}
                </Text>
                {entry.severity !== null && (
                  <View className="bg-accent-primary/10 px-2 py-0.5 rounded-md">
                    <Text className="text-[11px] font-semibold text-accent-primary">
                      {entry.severity}/10
                    </Text>
                  </View>
                )}
              </View>
              {entry.triggers && entry.triggers.length > 0 && (
                <Text
                  className="text-xs text-text-muted max-w-[120px]"
                  numberOfLines={1}
                >
                  {entry.triggers[0]}
                </Text>
              )}
            </TouchableOpacity>
          ))}
          {todayEntries.length > 3 && (
            <Text className="text-xs text-text-muted text-right pr-1">
              +{todayEntries.length - 3}{' '}
              {t('common.more', { defaultValue: 'more' })}
            </Text>
          )}
        </View>
      ) : isTodaySymptomFree ? (
        <View className="flex-row items-center justify-between p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 mb-3">
          <View className="flex-row items-center flex-1 mr-2">
            <Icon name="checkmark-circle-filled" size={18} color="#10b981" />
            <Text className="text-sm font-medium text-emerald-600 dark:text-emerald-400 ml-2">
              {t('symptoms.markedSymptomFreeToday', {
                defaultValue: 'Marked symptom-free today',
              })}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => unmarkFree.mutate(selectedDate)}
            className="px-2 py-1"
          >
            <Text className="text-xs font-semibold text-text-muted">
              {t('common.undo', { defaultValue: 'Undo' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="flex-row items-center justify-between py-2 mb-3">
          <Text
            className="text-sm text-text-muted flex-1 mr-2"
            numberOfLines={1}
          >
            {t('symptoms.noSymptomsLoggedToday', {
              defaultValue: 'No symptoms recorded today',
            })}
          </Text>
          <View className="flex-row items-center space-x-1.5">
            <TouchableOpacity
              onPress={() => markFree.mutate(selectedDate)}
              className="px-2.5 py-1.5 rounded-lg bg-raised border border-border"
            >
              <Text className="text-xs font-semibold text-text-secondary">
                {t('symptoms.markFree', { defaultValue: 'Mark Free' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                navigation.navigate('SymptomLog', { date: selectedDate })
              }
              className="px-2.5 py-1.5 rounded-lg bg-accent-primary ml-1.5"
            >
              <Text className="text-xs font-semibold text-white">
                {t('symptoms.logShort', { defaultValue: '+ Log' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 7-Day Sparkline Trend Pips */}
      <View className="pt-2.5 border-t border-border/40">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            {t('symptoms.sparkline7d', { defaultValue: '7-Day Trend' })}
          </Text>
          <Text className="text-[11px] font-medium text-text-muted">
            {freeDaysCount}/7{' '}
            {t('symptoms.freeDaysShort', { defaultValue: 'free days' })}
          </Text>
        </View>
        <View className="flex-row justify-between items-center px-1">
          {last7Days.map((day) => (
            <View key={day.date} className="items-center">
              <View
                className={`w-7 h-7 rounded-full items-center justify-center ${day.bgColor} ${
                  day.date === selectedDate
                    ? 'border-2 border-accent-primary'
                    : ''
                }`}
              >
                {day.isFree ? (
                  <Icon name="checkmark" size={13} color="#10b981" />
                ) : day.severity !== null ? (
                  <Text className={`text-[10px] font-bold ${day.textColor}`}>
                    {day.severity}
                  </Text>
                ) : (
                  <View className="w-1.5 h-1.5 rounded-full bg-text-muted/40" />
                )}
              </View>
              <Text
                className={`text-[10px] mt-1 ${
                  day.date === selectedDate
                    ? 'font-bold text-accent-primary'
                    : 'text-text-muted'
                }`}
              >
                {day.dayLabel}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Pressable>
  );
}
