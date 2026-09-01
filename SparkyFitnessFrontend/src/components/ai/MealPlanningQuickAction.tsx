import { useTranslation } from 'react-i18next';
import { ThreadPrimitive } from '@assistant-ui/react';
import { Utensils } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MealPlanningQuickAction() {
  const { t } = useTranslation();
  const label = t(
    'chat.mealPlanningQuickAction.label',
    'Plan next meal & shopping'
  );
  const prompt = t(
    'chat.mealPlanningQuickAction.prompt',
    'Decide my next meal based on my remaining goals and food preferences. Give exact portions, brief preparation steps, and one shopping list grouped by grocery section for two servings. Ask at most one question, and only if it is essential; otherwise make sensible assumptions. Reply in my language.'
  );

  return (
    <div data-slot="meal-planning-quick-action" className="flex justify-start">
      <ThreadPrimitive.Suggestion prompt={prompt} send clearComposer asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-full px-3 text-xs"
          aria-label={label}
        >
          <Utensils className="mr-1.5 size-3.5" aria-hidden="true" />
          {label}
        </Button>
      </ThreadPrimitive.Suggestion>
    </div>
  );
}
