import { useTranslation } from 'react-i18next';
import type { SymptomScaleType } from '@workspace/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { SEVERITY_BAND_CLASS } from './symptomHelpers';
import { scaleMax, severityBand } from '@workspace/shared';

interface SeverityControlProps {
  scale: SymptomScaleType;
  value: number | null;
  onChange: (value: number | null) => void;
  id?: string;
}

const NONE_SEVERE = [
  { value: 1, key: 'mild', fallback: 'Mild' },
  { value: 2, key: 'moderate', fallback: 'Moderate' },
  { value: 3, key: 'severe', fallback: 'Severe' },
];

/** The severity input for a symptom's scale: slider, three levels, or a count. */
export default function SeverityControl({
  scale,
  value,
  onChange,
  id = 'symptom-severity',
}: SeverityControlProps) {
  const { t } = useTranslation();

  if (scale === 'text') return null;

  const label = t('symptoms.severity.label', 'Severity');

  if (scale === 'count') {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>
          {t('symptoms.severity.count', 'How many times')}
        </Label>
        <Input
          id={id}
          type="number"
          min={0}
          max={scaleMax(scale)}
          inputMode="numeric"
          className="w-28"
          value={value ?? ''}
          onChange={(e) =>
            onChange(e.target.value === '' ? null : Number(e.target.value))
          }
        />
      </div>
    );
  }

  if (scale === 'none-severe') {
    return (
      <div className="flex flex-col gap-2">
        <Label>{label}</Label>
        <div
          className="inline-flex w-full rounded-lg bg-muted p-0.5"
          role="group"
          aria-label={label}
        >
          {NONE_SEVERE.map((level) => (
            <button
              key={level.value}
              type="button"
              aria-pressed={value === level.value}
              onClick={() => onChange(level.value)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                value === level.value
                  ? 'bg-background font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(`symptoms.severity.${level.key}`, level.fallback)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const max = scaleMax(scale);
  const current = value ?? Math.ceil(max / 2);
  const band = severityBand(current, scale);
  const word =
    band === 'low'
      ? t('symptoms.severity.mild', 'Mild')
      : band === 'mid'
        ? t('symptoms.severity.moderate', 'Moderate')
        : t('symptoms.severity.severe', 'Severe');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <Label id={`${id}-label`}>{label}</Label>
        <span className="flex items-center gap-2">
          <span className="text-2xl font-bold tabular-nums leading-none">
            {current}
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              SEVERITY_BAND_CLASS[band]
            )}
          >
            {word}
          </span>
        </span>
      </div>
      <Slider
        aria-labelledby={`${id}-label`}
        value={[current]}
        onValueChange={([v]) => onChange(v ?? current)}
        min={1}
        max={max}
        step={1}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{t('symptoms.severity.low', '1 mild')}</span>
        <span>{t('symptoms.severity.high', '{{max}} worst', { max })}</span>
      </div>
    </div>
  );
}
