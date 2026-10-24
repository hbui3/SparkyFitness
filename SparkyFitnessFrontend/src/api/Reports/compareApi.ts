import { apiCall } from '@/api/api';
import {
  compareResponseSchema,
  isAskable,
  timingOf,
  type CompareQuery,
  type CompareQuestion,
  type CompareResponse,
} from '@workspace/shared';

/**
 * Whether two tracked things go together, over a window of days or weeks.
 * `quiet` leaves a failure to the caller, with no toast.
 */
export const getCompare = async (
  query: CompareQuery,
  { quiet = false }: { quiet?: boolean } = {}
): Promise<CompareResponse> => {
  const response = await apiCall('/v2/reports/compare', {
    method: 'GET',
    params: {
      a: query.a,
      b: query.b,
      mode: query.mode,
      timing: query.timing,
      start: query.start,
      end: query.end,
    },
    ...(quiet ? { suppressErrorToast: true } : {}),
  });
  return compareResponseSchema.parse(response);
};

/** The request for a picked question, or null when it is not askable here (incomplete, or since mode). */
export const compareQueryFor = (
  question: Partial<CompareQuestion>,
  window: { startDate: string; endDate: string }
): CompareQuery | null => {
  if (!isAskable(question)) return null;
  const { mode, timing } = timingOf(question.choice);
  if (mode === 'since') return null;
  return {
    a: question.a,
    b: question.b,
    mode,
    timing,
    start: window.startDate,
    end: window.endDate,
  };
};
