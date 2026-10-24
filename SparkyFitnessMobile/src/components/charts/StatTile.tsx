import React from 'react';
import { Text, View } from 'react-native';

/** A headline stat's label and its already-formatted display value. */
export interface StatLabel {
  title: string;
  value: string;
}

/**
 * One headline tile above a Health Trends chart -- a small caps label over a large value.
 * Shared by every trend whose card leads with a window summary (Sleep's two time tiles,
 * Calories' average), so the styling stays in one place.
 */
export const StatTile: React.FC<{ label: StatLabel; testID: string }> = ({
  label,
  testID,
}) => (
  <View className="flex-1" testID={testID}>
    <Text className="text-text-muted text-xs uppercase">{label.title}</Text>
    <Text className="text-text-primary text-xl font-semibold">
      {label.value}
    </Text>
  </View>
);
