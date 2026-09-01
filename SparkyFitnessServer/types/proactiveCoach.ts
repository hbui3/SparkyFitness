export const proactiveCoachTopics = [
  'recovery',
  'training',
  'nutrition',
  'hydration',
  'progress',
  'consistency',
] as const;

export type ProactiveCoachTopic = (typeof proactiveCoachTopics)[number];

export type ProactiveCoachTone = 'push' | 'celebrate' | 'protect';

export interface ProactiveCoachOpportunity {
  topic: ProactiveCoachTopic;
  score: number;
  tone: ProactiveCoachTone;
  summaryDe: string;
  summaryEn: string;
  actionDe: string;
  actionEn: string;
  stateSignature: string;
  messageDe?: string;
  messageEn?: string;
}

export interface RecentProactiveCoachMessage {
  content: string;
  topic: ProactiveCoachTopic | null;
  stateSignature: string | null;
  createdAt: string;
}

export function isProactiveCoachTopic(
  value: unknown
): value is ProactiveCoachTopic {
  return (
    typeof value === 'string' &&
    (proactiveCoachTopics as readonly string[]).includes(value)
  );
}
