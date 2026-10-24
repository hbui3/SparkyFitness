import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import ZoomableChart from '@/components/ZoomableChart';
import { ChartDataPoint } from '@/types/reports';
import { usePreferences } from '@/contexts/PreferencesContext';
import { formatTimeWithPreference } from '@/utils/timeFormatters';
import { axisLabelValue } from '@/utils/chartUtils';

interface ActivityHeartRateChartProps {
  data: ChartDataPoint[];
  xAxisMode: string;
  getXAxisDataKey: () => string;
  getXAxisLabel: () => string;
  distanceUnit: string;
}

export const ActivityHeartRateChart = ({
  data,
  xAxisMode,
  getXAxisDataKey,
  distanceUnit,
}: ActivityHeartRateChartProps) => {
  const { t } = useTranslation();
  const { timeFormat } = usePreferences();

  return (
    <ZoomableChart title={t('reports.activityReport.heartRateBpm')}>
      {(isMaximized, zoomLevel) => (
        <Card className={`mb-8 ${isMaximized ? 'h-full flex flex-col' : ''}`}>
          <CardHeader>
            <CardTitle className="text-sm">
              {t('reports.activityReport.heartRateBpm')}
            </CardTitle>
          </CardHeader>
          <CardContent
            className={`grow ${isMaximized ? 'min-h-0 h-full' : ''}`}
          >
            <ResponsiveContainer
              width={`${100 * zoomLevel}%`}
              height={isMaximized ? '100%' : 300 * zoomLevel}
              minWidth={0}
              minHeight={0}
              debounce={100}
            >
              <LineChart
                data={data}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey={getXAxisDataKey()}
                  tick={{ fontSize: 10 }}
                  minTickGap={24}
                  tickFormatter={(value) => {
                    if (xAxisMode === 'activityDuration')
                      return `${Number(value).toFixed(0)} ${t('common.min', 'min')}`;
                    if (xAxisMode === 'distance')
                      return `${Number(value).toFixed(1)} ${distanceUnit === 'km' ? 'km' : 'mi'}`;
                    if (xAxisMode === 'timeOfDay')
                      return formatTimeWithPreference(
                        new Date(axisLabelValue(value)),
                        timeFormat
                      );
                    return String(value);
                  }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  width={36}
                  tick={{ fontSize: 10 }}
                  allowDecimals={false}
                  domain={[
                    (min: number) =>
                      Math.max(0, Math.floor(min / 10) * 10 - 10),
                    (max: number) => Math.ceil(max / 10) * 10 + 10,
                  ]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    borderColor: 'hsl(var(--border))',
                  }}
                  labelFormatter={(value) => {
                    if (xAxisMode === 'timeOfDay')
                      return formatTimeWithPreference(
                        new Date(axisLabelValue(value)),
                        timeFormat
                      );
                    if (xAxisMode === 'activityDuration')
                      return `${Number(value).toFixed(0)} ${t('common.min', 'min')}`;
                    if (xAxisMode === 'distance')
                      return `${Number(value).toFixed(2)} ${distanceUnit === 'km' ? 'km' : 'mi'}`;
                    return String(value);
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="heartRate"
                  stroke="#ff7300"
                  name={t('reports.activityReport.heartRateBpm')}
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </ZoomableChart>
  );
};
