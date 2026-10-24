import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  compareWindow,
  DEFAULT_COMPARE_SPAN,
  isAskable,
  timingOf,
  todayInZone,
  type CompareQuestion,
  type CompareSpan,
  type CompareSpanMode,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { useCompareQuestion } from '@/hooks/Reports/useCompare';
import { useAuth } from '@/hooks/useAuth';
import { CompareAnswerCard } from './CompareAnswerCard';
import { CompareChecks } from './CompareChecks';
import { CompareDaysTable } from './CompareDaysTable';
import { CompareDotsChart } from './CompareDotsChart';
import { CompareHowSure } from './CompareHowSure';
import { CompareOverTimeChart } from './CompareOverTimeChart';
import { CompareSentence } from './CompareSentence';
import { CompareSpanControl } from './CompareSpanControl';
import { CompareStartState } from './CompareStartState';
import { CompareTimingTable } from './CompareTimingTable';
import type { CustomRange } from './compareCustomRange';
import { loadRecentQuestions, saveRecentQuestion } from './compareRecents';
import { timingRows } from './compareTables';

// Since-habit questions are not offered on the web yet, so anything else is a day question.
const modeOf = (question: Partial<CompareQuestion>): CompareSpanMode =>
  question.choice && timingOf(question.choice).mode === 'week' ? 'week' : 'day';

export const CompareReport = () => {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const { isActingOnBehalf } = useActiveUser();
  // The same id the queries are keyed by; recents are kept per account.
  const userId = useAuth().user?.activeUserId;
  const [question, setQuestion] = useState<Partial<CompareQuestion>>({});
  const [span, setSpan] = useState<CompareSpan>(DEFAULT_COMPARE_SPAN.day);
  const [custom, setCustom] = useState<CustomRange | null>(null);
  const savedKey = useRef<string | null>(null);

  const mode = modeOf(question);
  const today = todayInZone(timezone);

  // A span valid by day (30 days) is not valid by week, so a mode change starts over.
  const applyQuestion = (next: Partial<CompareQuestion>) => {
    if (modeOf(next) !== mode) {
      setSpan(DEFAULT_COMPARE_SPAN[modeOf(next)]);
      setCustom(null);
    }
    setQuestion(next);
  };

  const { answer, timings } = useCompareQuestion(
    question,
    isActingOnBehalf ? null : compareWindow(span, mode, today, custom)
  );

  const askable = isAskable(question) ? question : null;
  const response = answer.data;
  useEffect(() => {
    if (!askable || !response) return;
    const key = `${askable.a}|${askable.b}|${askable.choice}`;
    if (savedKey.current === key) return;
    savedKey.current = key;
    saveRecentQuestion(userId, askable);
  }, [askable, response, userId]);

  if (isActingOnBehalf) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('compareReport.onlyYourOwnData', 'Compare shows only your own data')}
      </p>
    );
  }

  const rows = askable
    ? timingRows(askable, [
        {
          timing: timingOf(askable.choice).timing,
          data: answer.data,
          isLoading: answer.isLoading,
          isError: answer.isError,
        },
        ...timings.map(({ timing, query: result }) => ({
          timing,
          data: result.data,
          isLoading: result.isLoading,
          isError: result.isError,
        })),
      ])
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <CompareSentence question={question} onChange={applyQuestion} />
        {askable && (
          <CompareSpanControl
            mode={mode}
            span={span}
            custom={custom}
            today={today}
            onChange={(nextSpan, nextCustom) => {
              setSpan(nextSpan);
              setCustom(nextCustom);
            }}
          />
        )}
      </div>

      {!askable && (
        <CompareStartState
          recent={loadRecentQuestions(userId)}
          onPick={(picked) => applyQuestion(picked)}
        />
      )}

      {askable && answer.isLoading && (
        <div>{t('compareReport.loading', 'Loading comparison...')}</div>
      )}
      {/* A failed background refresh keeps the answer already on screen. */}
      {askable && answer.isError && !response && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">
            {t('compareReport.loadFailed', "Couldn't load this comparison")}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={answer.isFetching}
            onClick={() => void answer.refetch()}
          >
            {t('compareReport.screen.retry', 'Retry')}
          </Button>
        </div>
      )}

      {askable && response && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <CompareAnswerCard
                response={response}
                question={askable}
                span={span}
              />
              <CompareHowSure response={response} question={askable} />
              <CompareChecks response={response} question={askable} />
            </div>
            <div className="space-y-6">
              <CompareDotsChart response={response} question={askable} />
              <CompareOverTimeChart response={response} question={askable} />
            </div>
          </div>
          <CompareTimingTable
            question={askable}
            rows={rows}
            onPickTiming={(choice) => applyQuestion({ ...askable, choice })}
          />
          <CompareDaysTable response={response} question={askable} />
        </>
      )}
    </div>
  );
};
