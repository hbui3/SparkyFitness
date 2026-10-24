import React, { useId } from 'react';
import { View, Text } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Circle,
  Line,
  Text as SvgText,
  G,
} from 'react-native-svg';
import Icon from './Icon';

interface FastingTimerRingProps {
  progress: number; // 0-1
  hhmmss: string;
  stageName: string;
  stageColor: string;
  subtitle: string;
  size?: number;
  strokeWidth?: number;
  trackColor?: string;
}

const milestoneHours = [0, 16, 24, 72];

export const FastingTimerRing: React.FC<FastingTimerRingProps> = ({
  progress,
  hhmmss,
  stageName,
  stageColor,
  subtitle,
  size = 250,
  strokeWidth = 14,
  trackColor = '#E2E8F0',
}) => {
  const uid = useId();
  const gradientId = `fastRingGrad-${uid}`;
  const radius = (size - strokeWidth) / 2 - 16;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const dash = clampedProgress * circumference;

  // Knob position (starts at -90 deg / 12 o'clock)
  const angleRad = clampedProgress * 2 * Math.PI - Math.PI / 2;
  const knobX = center + radius * Math.cos(angleRad);
  const knobY = center + radius * Math.sin(angleRad);

  // Milestone angle on 72h scale
  const angleForHour = (hour: number) =>
    ((hour / 72) * 360 - 90) * (Math.PI / 180);

  return (
    <View
      className="items-center justify-center relative"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#60A5FA" />
            <Stop offset="35%" stopColor="#F97316" />
            <Stop offset="70%" stopColor="#EF4444" />
            <Stop offset="100%" stopColor="#A855F7" />
          </LinearGradient>
        </Defs>

        {/* Background track */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />

        {/* Milestone ticks & labels */}
        {milestoneHours.map((h) => {
          const rad = angleForHour(h);
          const innerX = center + (radius - 8) * Math.cos(rad);
          const innerY = center + (radius - 8) * Math.sin(rad);
          const outerX = center + (radius + 8) * Math.cos(rad);
          const outerY = center + (radius + 8) * Math.sin(rad);
          const labelX = center + (radius + 18) * Math.cos(rad);
          const labelY = center + (radius + 18) * Math.sin(rad) + 3;

          return (
            <G key={`milestone-${h}`}>
              <Line
                x1={innerX}
                y1={innerY}
                x2={outerX}
                y2={outerY}
                stroke="#94A3B8"
                strokeWidth={1.5}
                strokeLinecap="round"
                opacity={0.6}
              />
              {h < 72 && (
                <SvgText
                  x={labelX}
                  y={labelY}
                  fontSize={9}
                  fontWeight="600"
                  fill="#94A3B8"
                  textAnchor="middle"
                >
                  {h === 0 ? '0h' : `${h}h`}
                </SvgText>
              )}
            </G>
          );
        })}

        {/* Gradient progress arc */}
        {dash > 0 && (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${Math.max(1, circumference - dash)}`}
            strokeDashoffset={0}
            fill="none"
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}

        {/* Glowing knob indicator at arc end */}
        {dash > 0 && (
          <G>
            <Circle
              cx={knobX}
              cy={knobY}
              r={strokeWidth * 0.9}
              fill={stageColor}
              opacity={0.25}
            />
            <Circle
              cx={knobX}
              cy={knobY}
              r={strokeWidth * 0.45}
              fill="#FFFFFF"
              stroke={stageColor}
              strokeWidth={2.5}
            />
          </G>
        )}
      </Svg>

      {/* Centered content overlay */}
      <View className="absolute items-center justify-center px-4">
        {/* Colorful stage pill badge */}
        <View
          className="flex-row items-center px-3.5 py-1 rounded-full mb-1 shadow-sm"
          style={{ backgroundColor: stageColor }}
        >
          <Icon
            name="flame"
            size={13}
            color="#FFFFFF"
            style={{ marginRight: 4 }}
          />
          <Text className="text-xs font-bold text-white uppercase tracking-wider">
            {stageName}
          </Text>
        </View>

        {/* Large tabular timer */}
        <Text
          className="text-3xl font-extrabold text-text-primary tracking-tight"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {hhmmss}
        </Text>

        {/* Subtitle (Goal reached / remaining) */}
        {subtitle ? (
          <Text className="text-xs text-text-muted mt-1 text-center font-medium">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
};
