import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  CoachMealPlanningDashboardResponse,
  CoachPantryItemResponse,
  CoachShoppingListItemResponse,
} from '@workspace/shared';
import MealPlanningSettings from '@/pages/Settings/MealPlanningSettings';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useApplyCoachMealPlanAction,
  useArchiveCoachPantryItem,
  useCoachMealPlanningDashboard,
  useConfirmCoachShoppingPurchase,
  useCreateCoachPantryItem,
  useCreateCoachShoppingItem,
  useGenerateCoachMealPlan,
  usePatchCoachPantryItem,
  usePatchCoachShoppingItem,
  useRemoveCoachShoppingItem,
  useReplaceCoachMealPlanEntry,
} from '@/hooks/Settings/useMealPlanning';

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: jest.fn(),
}));
jest.mock('@/hooks/Settings/useMealPlanning', () => ({
  useApplyCoachMealPlanAction: jest.fn(),
  useArchiveCoachPantryItem: jest.fn(),
  useCoachMealPlanningDashboard: jest.fn(),
  useConfirmCoachShoppingPurchase: jest.fn(),
  useCreateCoachPantryItem: jest.fn(),
  useCreateCoachShoppingItem: jest.fn(),
  useGenerateCoachMealPlan: jest.fn(),
  usePatchCoachPantryItem: jest.fn(),
  usePatchCoachShoppingItem: jest.fn(),
  useRemoveCoachShoppingItem: jest.fn(),
  useReplaceCoachMealPlanEntry: jest.fn(),
}));
jest.mock('@/utils/generateClientId', () => ({
  generateClientId: () => '33333333-3333-4333-8333-333333333333',
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      interpolation?: Record<string, unknown>
    ) => {
      const fallback =
        typeof fallbackOrOptions === 'string'
          ? fallbackOrOptions
          : typeof fallbackOrOptions?.['defaultValue'] === 'string'
            ? fallbackOrOptions['defaultValue']
            : key;
      const values =
        typeof fallbackOrOptions === 'object'
          ? fallbackOrOptions
          : (interpolation ?? {});
      return fallback.replace(/{{(\w+)}}/g, (_match, name: string) =>
        String(values[name] ?? `{{${name}}}`)
      );
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

const PANTRY_ID = '11111111-1111-4111-8111-111111111111';
const SHOPPING_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
const PLAN_ID = '55555555-5555-4555-8555-555555555555';
const INGREDIENT_ID = '66666666-6666-4666-8666-666666666666';
const TIMESTAMP = '2026-09-01T08:00:00.000Z';

const lentilProduct = {
  retailer: 'coop' as const,
  retailerProductId: 'lentils-500',
  gtin: '7610000000001',
  name: 'Coop red lentils',
  packageQuantity: 500,
  packageUnit: 'g' as const,
  directUrl: 'https://www.coop.ch/en/food/pantry/lentils/p/123456',
  verifiedAt: TIMESTAMP,
  note: 'Allergy information: may contain sesame.',
};

const riceProduct = {
  retailer: 'coop' as const,
  retailerProductId: 'rice-1',
  gtin: '7610000000002',
  name: 'Coop basmati rice',
  packageQuantity: 1000,
  packageUnit: 'g' as const,
  directUrl: 'https://www.coop.ch/en/food/pantry/rice/p/654321',
  verifiedAt: TIMESTAMP,
  note: null,
};

const smallerLentilProduct = {
  ...lentilProduct,
  retailer: 'migros' as const,
  retailerProductId: 'lentils-300',
  name: 'Migros red lentils',
  packageQuantity: 300,
  directUrl: 'https://www.migros.ch/en/product/lentils-300',
};

const incompatibleLentilProduct = {
  ...lentilProduct,
  retailerProductId: 'lentils-piece-pack',
  name: 'Coop lentil portion cups',
  packageQuantity: 4,
  packageUnit: 'piece' as const,
  directUrl: 'https://www.coop.ch/en/food/pantry/lentils/p/portion-cups',
};

const legacyLentilProduct = {
  ...lentilProduct,
  retailer: 'migros' as const,
  retailerProductId: 'legacy-lentils',
  name: 'Legacy lentil product',
  directUrl: 'https://www.migros.ch/en/product/legacy-lentils',
  note: 'Allergy information: contains celery.',
};

const dashboard: CoachMealPlanningDashboardResponse = {
  startDate: '2026-09-01',
  days: 5,
  pantry: [
    {
      id: PANTRY_ID,
      ingredientKey: 'basmati-rice',
      name: 'Basmati rice',
      quantity: 800,
      minimumQuantity: 500,
      reservedQuantity: 200,
      availableQuantity: 600,
      shortageQuantity: 0,
      unit: 'g',
      category: 'pantry',
      preferredRetailer: 'coop',
      preferredRetailerProductId: 'rice-1',
      expiresOn: '2027-01-10',
      isActive: true,
      productOptions: [riceProduct],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  ],
  shoppingList: {
    id: '77777777-7777-4777-8777-777777777777',
    title: 'Groceries for this plan',
    coverageStart: '2026-09-01',
    coverageEnd: '2026-09-05',
    status: 'open',
    items: [
      {
        id: SHOPPING_ID,
        ingredientKey: 'red-lentils',
        name: 'Red lentils',
        requiredQuantity: 1000,
        purchasedQuantity: 300,
        remainingQuantity: 700,
        unit: 'g',
        category: 'pantry',
        status: 'needed',
        isManual: false,
        quantityLocked: false,
        notes: 'Dry lentils',
        sourceEntryIds: [ENTRY_ID],
        selectedProduct: lentilProduct,
        productOptions: [lentilProduct],
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ],
    completedAt: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  planEntries: [
    {
      id: ENTRY_ID,
      mealPlanId: PLAN_ID,
      date: '2026-09-01',
      slot: 'dinner',
      status: 'planned',
      recipe: {
        recipeKey: 'lentil-bowl',
        name: 'Red lentil bowl',
        description: 'A quick vegetable lentil bowl.',
        prepMinutes: 20,
        instructions: ['Simmer the lentils.', 'Add the vegetables.'],
      },
      servings: 2,
      caloriesKcal: 550,
      proteinG: 32,
      carbsG: 74,
      fatG: 14,
      safetyStatus: 'validated',
      replacementForId: null,
      notes: null,
      ingredients: [
        {
          id: INGREDIENT_ID,
          pantryItemId: null,
          ingredientKey: 'red-lentils',
          name: 'red lentils',
          quantity: 180,
          unit: 'g',
          category: 'pantry',
          shoppingRequired: true,
        },
      ],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  ],
  mealCatalog: [
    {
      recipe: {
        recipeKey: 'chickpea-bowl',
        name: 'Chickpea bowl',
        description: 'A quick chickpea alternative.',
        prepMinutes: 15,
        instructions: ['Mix and serve.'],
      },
      slots: ['lunch', 'dinner'],
      servings: 2,
      caloriesKcal: 520,
      proteinG: 26,
      carbsG: 70,
      fatG: 13,
      ingredients: [
        {
          ingredientKey: 'chickpeas',
          name: 'chickpeas',
          quantity: 400,
          unit: 'g',
          category: 'pantry',
        },
      ],
    },
  ],
  warnings: [],
  lastUpdatedAt: TIMESTAMP,
};

function dashboardWithShoppingItem(
  patch: Partial<CoachShoppingListItemResponse>
): CoachMealPlanningDashboardResponse {
  const shoppingList = dashboard.shoppingList;
  const item = shoppingList?.items[0];
  if (!shoppingList || !item) throw new Error('Expected shopping fixture');
  return {
    ...dashboard,
    shoppingList: {
      ...shoppingList,
      items: [{ ...item, ...patch }],
    },
  };
}

function dashboardWithPantryItem(
  patch: Partial<CoachPantryItemResponse>
): CoachMealPlanningDashboardResponse {
  const item = dashboard.pantry[0];
  if (!item) throw new Error('Expected pantry fixture');
  return {
    ...dashboard,
    pantry: [{ ...item, ...patch }],
  };
}

function mockDashboard(value: CoachMealPlanningDashboardResponse): void {
  jest.mocked(useCoachMealPlanningDashboard).mockReturnValue({
    data: value,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useCoachMealPlanningDashboard>);
}

const generateMutate = jest.fn();
const actionMutate = jest.fn();
const replaceMutate = jest.fn();
const createShoppingMutate = jest.fn();
const patchShoppingMutate = jest.fn();
const removeShoppingMutate = jest.fn();
const purchaseMutate = jest.fn();
const createPantryMutate = jest.fn();
const patchPantryMutate = jest.fn();
const archivePantryMutate = jest.fn();

describe('MealPlanningSettings', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(usePreferences).mockReturnValue({
      timezone: 'Europe/Zurich',
    } as unknown as ReturnType<typeof usePreferences>);
    mockDashboard(dashboard);
    jest.mocked(useGenerateCoachMealPlan).mockReturnValue({
      mutate: generateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateCoachMealPlan>);
    jest.mocked(useApplyCoachMealPlanAction).mockReturnValue({
      mutate: actionMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useApplyCoachMealPlanAction>);
    jest.mocked(useReplaceCoachMealPlanEntry).mockReturnValue({
      mutate: replaceMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useReplaceCoachMealPlanEntry>);
    jest.mocked(useCreateCoachShoppingItem).mockReturnValue({
      mutate: createShoppingMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateCoachShoppingItem>);
    jest.mocked(usePatchCoachShoppingItem).mockReturnValue({
      mutate: patchShoppingMutate,
      isPending: false,
    } as unknown as ReturnType<typeof usePatchCoachShoppingItem>);
    jest.mocked(useRemoveCoachShoppingItem).mockReturnValue({
      mutate: removeShoppingMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useRemoveCoachShoppingItem>);
    jest.mocked(useConfirmCoachShoppingPurchase).mockReturnValue({
      mutate: purchaseMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useConfirmCoachShoppingPurchase>);
    jest.mocked(useCreateCoachPantryItem).mockReturnValue({
      mutate: createPantryMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateCoachPantryItem>);
    jest.mocked(usePatchCoachPantryItem).mockReturnValue({
      mutate: patchPantryMutate,
      isPending: false,
    } as unknown as ReturnType<typeof usePatchCoachPantryItem>);
    jest.mocked(useArchiveCoachPantryItem).mockReturnValue({
      mutate: archivePantryMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useArchiveCoachPantryItem>);
  });

  it('shows concrete meals, macros, ingredients, and owner actions', () => {
    render(<MealPlanningSettings />);

    expect(screen.getByText('Red lentil bowl')).toBeInTheDocument();
    expect(screen.getByText('550 kcal')).toBeInTheDocument();
    expect(screen.getByText('180 g red lentils')).toBeInTheDocument();

    const preparedAction = screen.getByRole('button', {
      name: /Mark Red lentil bowl on .* as prepared/,
    });
    expect(
      screen.getByRole('button', {
        name: /Mark Red lentil bowl on .* as eating out/,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Skip Red lentil bowl on /,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Replace Red lentil bowl on /,
      })
    ).toBeInTheDocument();

    fireEvent.click(preparedAction);

    expect(actionMutate).toHaveBeenCalledWith({
      entryId: ENTRY_ID,
      request: {
        operationId: '33333333-3333-4333-8333-333333333333',
        action: 'prepared',
      },
    });
  });

  it('uses package totals as the editable default for partial purchase confirmation', () => {
    render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Shopping' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByText('2 × 500 g = 1,000 g')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Coop: Coop red lentils/ })
    ).toHaveAttribute('href', lentilProduct.directUrl);
    expect(
      screen.getByText('Allergy information: may contain sesame.')
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select Red lentils for purchase',
      })
    );
    const boughtNow = screen.getByLabelText('Bought now for Red lentils');
    expect(boughtNow).toHaveValue(1000);
    fireEvent.change(boughtNow, { target: { value: '500' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm purchase (1)' })
    );

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Red lentils: 500 g')).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm purchase' })
    );

    expect(purchaseMutate).toHaveBeenCalledWith(
      {
        operationId: '33333333-3333-4333-8333-333333333333',
        purchases: [{ itemId: SHOPPING_ID, quantity: 500 }],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('only suggests and offers products whose package unit matches the item', () => {
    mockDashboard(
      dashboardWithShoppingItem({
        selectedProduct: incompatibleLentilProduct,
        productOptions: [incompatibleLentilProduct, lentilProduct],
      })
    );
    render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Shopping' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByText('2 × 500 g = 1,000 g')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Coop lentil portion cups/ })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Red lentils' }));
    fireEvent.pointerDown(screen.getByLabelText('Preferred product'), {
      button: 0,
      ctrlKey: false,
      pointerId: 1,
    });

    expect(
      screen.queryByRole('option', { name: /Coop lentil portion cups/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Coop red lentils/ })
    ).toBeInTheDocument();
  });

  it('clears selected quantities immediately after removing an item', () => {
    render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Shopping' }), {
      button: 0,
      ctrlKey: false,
    });

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select Red lentils for purchase',
      })
    );
    fireEvent.change(screen.getByLabelText('Bought now for Red lentils'), {
      target: { value: '400' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Red lentils' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    const callbacks = removeShoppingMutate.mock.calls[0]?.[1] as
      { onSuccess: () => void } | undefined;
    expect(callbacks).toBeDefined();
    act(() => callbacks?.onSuccess());

    expect(
      screen.getByRole('checkbox', {
        name: 'Select Red lentils for purchase',
      })
    ).not.toBeChecked();
    expect(
      screen.queryByLabelText('Bought now for Red lentils')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirm purchase (0)' })
    ).toBeDisabled();
  });

  it('reconciles selected quantities when needed items change', async () => {
    const { rerender } = render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Shopping' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select Red lentils for purchase',
      })
    );
    fireEvent.change(screen.getByLabelText('Bought now for Red lentils'), {
      target: { value: '400' },
    });

    mockDashboard(
      dashboardWithShoppingItem({ status: 'skipped', remainingQuantity: 0 })
    );
    rerender(<MealPlanningSettings />);

    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', {
          name: 'Select Red lentils for purchase',
        })
      ).not.toBeChecked()
    );

    mockDashboard(dashboard);
    rerender(<MealPlanningSettings />);
    const restoredCheckbox = await screen.findByRole('checkbox', {
      name: 'Select Red lentils for purchase',
    });
    expect(restoredCheckbox).toBeEnabled();
    fireEvent.click(restoredCheckbox);
    expect(screen.getByLabelText('Bought now for Red lentils')).toHaveValue(
      1000
    );
  });

  it('resets a pending purchase quantity when the selected product changes', async () => {
    const { rerender } = render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Shopping' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select Red lentils for purchase',
      })
    );
    fireEvent.change(screen.getByLabelText('Bought now for Red lentils'), {
      target: { value: '800' },
    });

    mockDashboard(
      dashboardWithShoppingItem({
        selectedProduct: smallerLentilProduct,
        productOptions: [smallerLentilProduct],
      })
    );
    rerender(<MealPlanningSettings />);

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Select Red lentils for purchase',
    });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(screen.getByLabelText('Bought now for Red lentils')).toHaveValue(
      900
    );
  });

  it('exposes the planning period controls as a named group', () => {
    render(<MealPlanningSettings />);

    expect(
      screen.getByRole('group', { name: 'Planning period' })
    ).toBeInTheDocument();
  });

  it('preserves a selected product snapshot that is no longer in current options', () => {
    mockDashboard(
      dashboardWithShoppingItem({
        selectedProduct: legacyLentilProduct,
        productOptions: [lentilProduct],
      })
    );
    render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Shopping' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(
      screen.getByText('Allergy information: contains celery.')
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Red lentils' }));
    expect(
      screen.getAllByText('Allergy information: contains celery.')
    ).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Updated note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(patchShoppingMutate).toHaveBeenCalledWith(
      {
        itemId: SHOPPING_ID,
        request: {
          name: 'Red lentils',
          requiredQuantity: 1000,
          category: 'pantry',
          quantityLocked: false,
          notes: 'Updated note',
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('filters pantry stock and saves target, expiry, and product preference edits', () => {
    render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Pantry' }), {
      button: 0,
      ctrlKey: false,
    });

    const search = screen.getByLabelText('Search pantry items');
    fireEvent.change(search, { target: { value: 'oats' } });
    expect(
      screen.getByText('No pantry items match your search.')
    ).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'rice' } });
    expect(screen.getByText('Basmati rice')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Coop: Coop basmati rice/ })
    ).toHaveAttribute('href', riceProduct.directUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Basmati rice' }));
    fireEvent.change(screen.getByLabelText('Amount at home'), {
      target: { value: '900' },
    });
    fireEvent.change(screen.getByLabelText('Target stock'), {
      target: { value: '600' },
    });
    fireEvent.change(screen.getByLabelText('Expiry date'), {
      target: { value: '2027-02-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(patchPantryMutate).toHaveBeenCalledWith(
      {
        itemId: PANTRY_ID,
        request: {
          name: 'Basmati rice',
          quantity: 900,
          minimumQuantity: 600,
          category: 'pantry',
          expiresOn: '2027-02-01',
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('explains and disables archiving while stock or reservations remain', () => {
    render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Pantry' }), {
      button: 0,
      ctrlKey: false,
    });

    const archiveButton = screen.getByRole('button', {
      name: 'Archive Basmati rice',
    });
    expect(archiveButton).toBeDisabled();
    const descriptionId = archiveButton.getAttribute('aria-describedby');
    expect(descriptionId).not.toBeNull();
    expect(document.getElementById(descriptionId ?? '')).toHaveTextContent(
      'Set total stock to 0 and make sure nothing is reserved for planned meals before archiving.'
    );
  });

  it('allows an empty, unreserved pantry item to be archived', () => {
    mockDashboard(
      dashboardWithPantryItem({
        quantity: 0,
        reservedQuantity: 0,
        availableQuantity: 0,
      })
    );
    render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Pantry' }), {
      button: 0,
      ctrlKey: false,
    });

    const archiveButton = screen.getByRole('button', {
      name: 'Archive Basmati rice',
    });
    expect(archiveButton).toBeEnabled();
    expect(archiveButton).not.toHaveAttribute('aria-describedby');
    fireEvent.click(archiveButton);
    expect(
      screen.getByRole('alertdialog', { name: 'Archive pantry item?' })
    ).toBeInTheDocument();
  });

  it('preserves an unavailable pantry product preference on unrelated edits', () => {
    mockDashboard(
      dashboardWithPantryItem({
        preferredRetailer: 'migros',
        preferredRetailerProductId: 'legacy-rice',
        productOptions: [],
      })
    );
    render(<MealPlanningSettings />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Pantry' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Basmati rice' }));

    expect(
      screen.getAllByText('Current preference: Migros · legacy-rice')
    ).not.toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Amount at home'), {
      target: { value: '850' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(patchPantryMutate).toHaveBeenCalledWith(
      {
        itemId: PANTRY_ID,
        request: {
          name: 'Basmati rice',
          quantity: 850,
          minimumQuantity: 500,
          category: 'pantry',
          expiresOn: '2027-01-10',
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });
});
