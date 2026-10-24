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

interface TrainingVolumeByMuscleGroupChartProps {
  data: { muscle: string; volume: number }[];
  weightUnit: string;
}

export const TrainingVolumeByMuscleGroupChart = ({
  data,
  weightUnit,
}: TrainingVolumeByMuscleGroupChartProps) => {
  const { t } = useTranslation();
  const chartData = [...data].sort((a, b) => b.volume - a.volume);
  const height = Math.min(420, Math.max(180, chartData.length * 32));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t(
            'exerciseReportsDashboard.trainingVolumeByMuscleGroup',
            'Training Volume by Muscle Group'
          )}
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
                tick={{ fontSize: 11 }}
                tickFormatter={(value: number) => String(Math.round(value))}
              />
              <YAxis
                type="category"
                dataKey="muscle"
                width={88}
                interval={0}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value: unknown) => [
                  `${Math.round(Number(value) || 0)} ${weightUnit}`,
                  t('exerciseReportsDashboard.volumeCurrent', 'Volume'),
                ]}
                contentStyle={{ backgroundColor: 'hsl(var(--background))' }}
              />
              <Bar
                dataKey="volume"
                fill="#ff7300"
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
