import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';
import { SUPERSET_PALETTE_VARS } from '../utils/workoutSession';

const CONFETTI_COLOR_VARS = [...SUPERSET_PALETTE_VARS, '--color-pr'];

/**
 * Fixed scatter (percent positions within the hero) instead of randomness:
 * deterministic renders keep the react-compiler happy and the burst identical
 * across mounts. Colors index into CONFETTI_COLOR_VARS.
 */
const CONFETTI_PIECES: {
  leftPct: number;
  topPct: number;
  width: number;
  height: number;
  colorIndex: number;
  rotateDeg?: number;
  round?: boolean;
  delayMs: number;
}[] = [
  {
    leftPct: 14,
    topPct: 18,
    width: 7,
    height: 11,
    colorIndex: 2,
    rotateDeg: -24,
    delayMs: 0,
  },
  {
    leftPct: 26,
    topPct: 56,
    width: 6,
    height: 6,
    colorIndex: 1,
    round: true,
    delayMs: 120,
  },
  {
    leftPct: 8,
    topPct: 44,
    width: 9,
    height: 5,
    colorIndex: 5,
    rotateDeg: 40,
    delayMs: 60,
  },
  {
    leftPct: 78,
    topPct: 14,
    width: 7,
    height: 11,
    colorIndex: 4,
    rotateDeg: 28,
    delayMs: 40,
  },
  {
    leftPct: 90,
    topPct: 42,
    width: 6,
    height: 6,
    colorIndex: 0,
    round: true,
    delayMs: 160,
  },
  {
    leftPct: 70,
    topPct: 58,
    width: 9,
    height: 5,
    colorIndex: 8,
    rotateDeg: -36,
    delayMs: 90,
  },
  {
    leftPct: 37,
    topPct: 10,
    width: 5,
    height: 9,
    colorIndex: 3,
    rotateDeg: 12,
    delayMs: 140,
  },
  {
    leftPct: 60,
    topPct: 6,
    width: 6,
    height: 6,
    colorIndex: 2,
    round: true,
    delayMs: 20,
  },
  {
    leftPct: 48,
    topPct: 52,
    width: 7,
    height: 10,
    colorIndex: 8,
    rotateDeg: 52,
    delayMs: 180,
  },
  {
    leftPct: 84,
    topPct: 62,
    width: 5,
    height: 9,
    colorIndex: 3,
    rotateDeg: -14,
    delayMs: 110,
  },
  {
    leftPct: 20,
    topPct: 8,
    width: 6,
    height: 6,
    colorIndex: 6,
    round: true,
    delayMs: 200,
  },
  {
    leftPct: 55,
    topPct: 30,
    width: 8,
    height: 5,
    colorIndex: 0,
    rotateDeg: 20,
    delayMs: 70,
  },
];

function ConfettiPiece({
  piece,
  color,
}: {
  piece: (typeof CONFETTI_PIECES)[number];
  color: string;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      piece.delayMs,
      withTiming(1, { duration: 1100 })
    );
    return () => cancelAnimation(progress);
  }, [piece.delayMs, progress]);

  const rotateDeg = piece.rotateDeg ?? 0;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.12, 0.7, 1], [0, 0.85, 0.75, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-16, 36]) },
      { rotate: `${rotateDeg + progress.value * 30}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: `${piece.leftPct}%`,
          top: `${piece.topPct}%`,
          width: piece.width,
          height: piece.height,
          borderRadius: piece.round ? piece.width / 2 : 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

export default function WorkoutCompleteConfetti() {
  const reducedMotion = useReducedMotion();
  const palette = useCSSVariable(CONFETTI_COLOR_VARS) as string[];
  if (reducedMotion) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {CONFETTI_PIECES.map((piece, index) => (
        <ConfettiPiece
          key={index}
          piece={piece}
          color={String(palette[piece.colorIndex])}
        />
      ))}
    </View>
  );
}
