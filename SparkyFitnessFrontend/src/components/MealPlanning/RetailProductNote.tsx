import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';

interface RetailProductNoteProps {
  note: string;
}

export default function RetailProductNote({ note }: RetailProductNoteProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <span className="font-semibold">
          {t('settings.mealPlanning.fields.productNote', 'Product note')}:
        </span>{' '}
        {note}
      </p>
    </div>
  );
}
