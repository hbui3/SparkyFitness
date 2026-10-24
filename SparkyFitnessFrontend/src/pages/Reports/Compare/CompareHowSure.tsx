import { useTranslation } from 'react-i18next';
import type { CompareQuestion, CompareResponse } from '@workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { howSureLines } from './compareCopy';

interface CompareHowSureProps {
  response: CompareResponse;
  question: CompareQuestion;
}

export const CompareHowSure = ({ response, question }: CompareHowSureProps) => {
  const { t } = useTranslation();
  const lines = howSureLines(response.result, question, t);
  if (lines.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {t('compareReport.howSure.title', 'How sure is this?')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3">
          {lines.map((line) => (
            <div key={line.label}>
              <dt className="text-xs text-muted-foreground">{line.label}</dt>
              <dd className="text-sm font-medium">{line.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
};
