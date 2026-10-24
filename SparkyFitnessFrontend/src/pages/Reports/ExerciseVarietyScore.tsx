import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface ExerciseVarietyScoreProps {
  varietyData: {
    [muscleGroup: string]: number;
  } | null;
}

const ExerciseVarietyScore = ({ varietyData }: ExerciseVarietyScoreProps) => {
  const { t } = useTranslation();

  if (!varietyData || Object.keys(varietyData).length === 0) {
    return null;
  }

  const chartData = Object.entries(varietyData)
    .map(([muscle, count]) => ({ muscle, count }))
    .sort((a, b) => b.count - a.count);
  const height = Math.min(420, Math.max(180, chartData.length * 32));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('reports.exerciseVarietyScore', 'Exercise Variety Score')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="w-full" style={{ height }}>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={0}
            debounce={100}
          >
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="muscle"
                width={88}
                interval={0}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value) => [
                  Number(value) || 0,
                  t('reports.uniqueExercises', 'Unique Exercises'),
                ]}
                contentStyle={{ backgroundColor: 'hsl(var(--background))' }}
              />
              <Bar
                dataKey="count"
                fill="#ff7300"
                name={t('reports.uniqueExercises', 'Unique Exercises')}
                isAnimationActive={false}
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

export default ExerciseVarietyScore;
