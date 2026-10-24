import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Icon from './Icon';
import WorkoutCompleteConfetti from './WorkoutCompleteConfetti';

interface WorkoutCompleteHeroProps {
  sessionName: string;
  hasRecords: boolean;
  allSetsLogged: boolean;
  totalSetCount: number;
  completedSetCount: number;
  finishedTimeText: string;
}

function HeroCheck() {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(reducedMotion ? 1 : 0.4);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 14, stiffness: 220 });
  }, [scale]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      className="w-16 h-16 rounded-full bg-accent-primary items-center justify-center"
      style={animatedStyle}
    >
      <Icon name="checkmark" size={32} color="#ffffff" />
    </Animated.View>
  );
}

export default function WorkoutCompleteHero({
  sessionName,
  hasRecords,
  allSetsLogged,
  totalSetCount,
  completedSetCount,
  finishedTimeText,
}: WorkoutCompleteHeroProps) {
  const { t } = useTranslation();

  return (
    <View className="items-center px-6 pt-7 pb-5">
      {hasRecords && <WorkoutCompleteConfetti />}
      <HeroCheck />
      <Text className="text-2xl font-bold text-text-primary mt-3">
        {t('workoutComplete.title', { defaultValue: 'Workout Complete' })}
      </Text>
      <Text className="text-[15px] font-semibold text-text-secondary mt-1">
        {sessionName}
      </Text>
      <Text className="text-sm font-medium text-text-muted mt-1">
        {allSetsLogged
          ? t('workoutComplete.labels.allSets', {
              defaultValue: '{{count}} sets',
              count: totalSetCount,
            })
          : t('workoutComplete.labels.partialSets', {
              defaultValue: '{{completed}} of {{total}} sets',
              completed: completedSetCount,
              total: totalSetCount,
            })}
      </Text>
      <Text className="text-sm font-medium text-text-muted">
        {t('workoutComplete.labels.todayAt', {
          defaultValue: ' · Today at ',
        })}
        {finishedTimeText}
      </Text>
    </View>
  );
}
