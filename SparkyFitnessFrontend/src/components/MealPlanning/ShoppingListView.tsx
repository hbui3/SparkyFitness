import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExternalLink,
  ListPlus,
  LockKeyhole,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type {
  CoachMealPlanningCategory,
  CoachMealPlanningUnit,
  CoachShoppingListItemResponse,
  CoachShoppingListResponse,
  CreateCoachShoppingItemRequest,
  PatchCoachShoppingItemRequest,
  RetailProductRef,
} from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useConfirmCoachShoppingPurchase,
  useCreateCoachShoppingItem,
  usePatchCoachShoppingItem,
  useRecalculateCoachShoppingList,
  useRemoveCoachShoppingItem,
} from '@/hooks/Settings/useMealPlanning';
import { generateClientId } from '@/utils/generateClientId';
import RetailProductNote from './RetailProductNote';
import {
  formatPlanningQuantity,
  MEAL_PLANNING_CATEGORIES,
  MEAL_PLANNING_UNITS,
  planningCategoryLabel,
  planningUnitLabel,
  retailerLabel,
} from './mealPlanningUi';

interface ShoppingListViewProps {
  shoppingList: CoachShoppingListResponse | null;
}

interface ShoppingItemFormState {
  name: string;
  requiredQuantity: string;
  unit: CoachMealPlanningUnit;
  category: CoachMealPlanningCategory;
  notes: string;
  quantityLocked: boolean;
  productKey: string;
}

const EMPTY_FORM: ShoppingItemFormState = {
  name: '',
  requiredQuantity: '1',
  unit: 'piece',
  category: 'other',
  notes: '',
  quantityLocked: false,
  productKey: 'none',
};

const EMPTY_SHOPPING_ITEMS: CoachShoppingListItemResponse[] = [];

function productKey(product: RetailProductRef): string {
  return `${product.retailer}:${product.retailerProductId}`;
}

function selectedProductForKey(
  options: RetailProductRef[],
  key: string
): RetailProductRef | null {
  if (key === 'none') return null;
  return options.find((option) => productKey(option) === key) ?? null;
}

function currentProductKey(item: CoachShoppingListItemResponse): string {
  return item.selectedProduct?.packageUnit === item.unit
    ? productKey(item.selectedProduct)
    : 'none';
}

function compatibleProductOptions(
  item: CoachShoppingListItemResponse
): RetailProductRef[] {
  return [
    ...(item.selectedProduct ? [item.selectedProduct] : []),
    ...item.productOptions,
  ]
    .filter((product) => product.packageUnit === item.unit)
    .filter(
      (product, index, options) =>
        options.findIndex(
          (candidate) => productKey(candidate) === productKey(product)
        ) === index
    );
}

function suggestedProduct(
  item: CoachShoppingListItemResponse
): RetailProductRef | null {
  return compatibleProductOptions(item)[0] ?? null;
}

function suggestedPurchaseQuantity(
  item: CoachShoppingListItemResponse
): number {
  const product = suggestedProduct(item);
  if (!product || product.packageUnit !== item.unit) {
    return item.remainingQuantity;
  }
  return (
    Math.ceil(item.remainingQuantity / product.packageQuantity) *
    product.packageQuantity
  );
}

function ProductLinks({ item }: { item: CoachShoppingListItemResponse }) {
  const { t, i18n } = useTranslation();
  const products = compatibleProductOptions(item);
  if (products.length === 0) return null;
  const product = suggestedProduct(item);
  const packageCount = product
    ? Math.ceil(item.remainingQuantity / product.packageQuantity)
    : 0;
  const totalQuantity = product ? packageCount * product.packageQuantity : 0;
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const numberFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  });
  return (
    <div className="space-y-2">
      {product && (
        <p className="text-xs text-muted-foreground">
          {t(
            'settings.mealPlanning.shopping.packageCalculation',
            '{{packages}} × {{packageQuantity}} {{unit}} = {{totalQuantity}} {{unit}}',
            {
              packages: packageCount,
              packageQuantity: numberFormatter.format(product.packageQuantity),
              totalQuantity: numberFormatter.format(totalQuantity),
              unit: planningUnitLabel(t, product.packageUnit),
            }
          )}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {products.map((productOption) => (
          <div key={productKey(productOption)} className="space-y-2">
            <Button asChild size="sm" variant="outline">
              <a
                href={productOption.directUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t(
                  'settings.mealPlanning.shopping.openProduct',
                  '{{retailer}}: {{product}}',
                  {
                    retailer: retailerLabel(t, productOption.retailer),
                    product: productOption.name,
                  }
                )}
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
            {productOption.note && (
              <RetailProductNote note={productOption.note} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ShoppingListView({
  shoppingList,
}: ShoppingListViewProps) {
  const { t } = useTranslation();
  const createItem = useCreateCoachShoppingItem();
  const patchItem = usePatchCoachShoppingItem();
  const removeItem = useRemoveCoachShoppingItem();
  const confirmPurchase = useConfirmCoachShoppingPurchase();
  const recalculateList = useRecalculateCoachShoppingList();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] =
    useState<CoachShoppingListItemResponse | null>(null);
  const [form, setForm] = useState<ShoppingItemFormState>(EMPTY_FORM);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [purchaseQuantities, setPurchaseQuantities] = useState<
    Record<string, string>
  >({});
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [removingItem, setRemovingItem] =
    useState<CoachShoppingListItemResponse | null>(null);
  const items = shoppingList?.items ?? EMPTY_SHOPPING_ITEMS;
  const neededItems = useMemo(
    () =>
      items.filter(
        (item) => item.status === 'needed' && item.remainingQuantity > 0
      ),
    [items]
  );
  const groupedItems = useMemo(
    () =>
      MEAL_PLANNING_CATEGORIES.map((category) => ({
        category,
        items: items.filter((item) => item.category === category),
      })).filter((group) => group.items.length > 0),
    [items]
  );
  const purchases = useMemo(
    () =>
      neededItems
        .filter((item) => selectedIds.has(item.id))
        .map((item) => ({
          itemId: item.id,
          quantity: Number(
            purchaseQuantities[item.id] ??
              String(suggestedPurchaseQuantity(item))
          ),
        }))
        .filter(
          (purchase) =>
            Number.isFinite(purchase.quantity) && purchase.quantity > 0
        ),
    [neededItems, purchaseQuantities, selectedIds]
  );
  const selectedCount = selectedIds.size;
  const purchaseSelectionValid =
    selectedCount > 0 && purchases.length === selectedCount;

  const clearPurchaseSelection = (itemId: string) => {
    setSelectedIds((current) => {
      if (!current.has(itemId)) return current;
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });
    setPurchaseQuantities((current) => {
      if (!(itemId in current)) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  };

  const openAddDialog = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (item: CoachShoppingListItemResponse) => {
    setEditingItem(item);
    setForm({
      name: item.name,
      requiredQuantity: String(item.requiredQuantity),
      unit: item.unit,
      category: item.category,
      notes: item.notes ?? '',
      quantityLocked: item.quantityLocked,
      productKey: currentProductKey(item),
    });
    setDialogOpen(true);
  };

  const submitItem = (event: FormEvent) => {
    event.preventDefault();
    const requiredQuantity = Number(form.requiredQuantity);
    if (
      !form.name.trim() ||
      !Number.isFinite(requiredQuantity) ||
      requiredQuantity <= 0
    ) {
      return;
    }
    if (editingItem) {
      const originalProductKey = currentProductKey(editingItem);
      const productChanged = form.productKey !== originalProductKey;
      const request: PatchCoachShoppingItemRequest = {
        name: form.name.trim(),
        requiredQuantity,
        category: form.category,
        quantityLocked: form.quantityLocked,
        notes: form.notes.trim() || null,
        ...(productChanged
          ? {
              selectedProduct: selectedProductForKey(
                compatibleProductOptions(editingItem),
                form.productKey
              ),
            }
          : {}),
      };
      patchItem.mutate(
        { itemId: editingItem.id, request },
        { onSuccess: () => setDialogOpen(false) }
      );
      return;
    }
    const request: CreateCoachShoppingItemRequest = {
      name: form.name.trim(),
      requiredQuantity,
      unit: form.unit,
      category: form.category,
      notes: form.notes.trim() || null,
      selectedProduct: null,
    };
    createItem.mutate(request, { onSuccess: () => setDialogOpen(false) });
  };

  const toggleSelected = (
    item: CoachShoppingListItemResponse,
    checked: boolean
  ) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
    if (checked && purchaseQuantities[item.id] === undefined) {
      setPurchaseQuantities((current) => ({
        ...current,
        [item.id]: String(suggestedPurchaseQuantity(item)),
      }));
    }
  };

  const confirmSelectedPurchase = () => {
    if (!purchaseSelectionValid) return;
    confirmPurchase.mutate(
      {
        operationId: generateClientId(),
        purchases: purchases.map(({ itemId, quantity }) => ({
          itemId,
          quantity,
        })),
      },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setPurchaseQuantities({});
          setPurchaseDialogOpen(false);
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold">
            {shoppingList?.title ??
              t('settings.mealPlanning.shopping.title', 'Shopping list')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {shoppingList?.coverageStart && shoppingList.coverageEnd
              ? t(
                  'settings.mealPlanning.shopping.coverage',
                  'For {{start}} to {{end}}',
                  {
                    start: shoppingList.coverageStart,
                    end: shoppingList.coverageEnd,
                  }
                )
              : t(
                  'settings.mealPlanning.shopping.description',
                  'Edit what you need and add confirmed purchases directly to your pantry.'
                )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => recalculateList.mutate()}
            disabled={recalculateList.isPending}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${recalculateList.isPending ? 'animate-spin' : ''}`}
            />
            {t(
              'settings.mealPlanning.shopping.recalculate',
              'Recalculate list'
            )}
          </Button>
          <Button type="button" variant="outline" onClick={openAddDialog}>
            <ListPlus className="mr-2 h-4 w-4" />
            {t('settings.mealPlanning.shopping.add', 'Add item')}
          </Button>
          <Button
            type="button"
            disabled={!purchaseSelectionValid || confirmPurchase.isPending}
            onClick={() => setPurchaseDialogOpen(true)}
          >
            {t(
              'settings.mealPlanning.shopping.confirmSelected',
              'Confirm purchase ({{count}})',
              { count: selectedCount }
            )}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t(
            'settings.mealPlanning.shopping.empty',
            'Nothing to buy right now. Generate a plan or add an item manually.'
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {groupedItems.map((group) => (
            <section key={group.category} className="space-y-2">
              <h4 className="text-sm font-semibold">
                {planningCategoryLabel(t, group.category)}
              </h4>
              {group.items.map((item) => {
                const selectable =
                  item.status === 'needed' && item.remainingQuantity > 0;
                const quantityValue =
                  purchaseQuantities[item.id] ??
                  String(suggestedPurchaseQuantity(item));
                const quantityNumber = Number(quantityValue);
                const quantityInvalid =
                  selectedIds.has(item.id) &&
                  (!Number.isFinite(quantityNumber) || quantityNumber <= 0);
                return (
                  <article
                    key={item.id}
                    className={`rounded-lg border p-3 ${item.status !== 'needed' ? 'bg-muted/30 text-muted-foreground' : ''}`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <Checkbox
                          aria-label={t(
                            'settings.mealPlanning.shopping.selectItem',
                            'Select {{name}} for purchase',
                            { name: item.name }
                          )}
                          checked={selectedIds.has(item.id)}
                          disabled={!selectable}
                          onCheckedChange={(checked) =>
                            toggleSelected(item, checked === true)
                          }
                        />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{item.name}</p>
                            {item.isManual && (
                              <Badge variant="secondary">
                                {t(
                                  'settings.mealPlanning.shopping.manual',
                                  'Added by you'
                                )}
                              </Badge>
                            )}
                            {item.quantityLocked && (
                              <Badge variant="outline">
                                <LockKeyhole className="mr-1 h-3 w-3" />
                                {t(
                                  'settings.mealPlanning.shopping.locked',
                                  'Amount fixed'
                                )}
                              </Badge>
                            )}
                            {item.status !== 'needed' && (
                              <Badge variant="outline">
                                {item.status === 'purchased'
                                  ? t(
                                      'settings.mealPlanning.shopping.purchased',
                                      'Purchased'
                                    )
                                  : t(
                                      'settings.mealPlanning.shopping.skipped',
                                      'Removed'
                                    )}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {t(
                              'settings.mealPlanning.shopping.amountProgress',
                              '{{purchased}} of {{required}} {{unit}} purchased',
                              {
                                purchased: formatPlanningQuantity(
                                  item.purchasedQuantity
                                ),
                                required: formatPlanningQuantity(
                                  item.requiredQuantity
                                ),
                                unit: planningUnitLabel(t, item.unit),
                              }
                            )}
                          </p>
                          {item.notes && (
                            <p className="text-sm">{item.notes}</p>
                          )}
                          <ProductLinks item={item} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-end gap-2 md:justify-end">
                        {selectable && selectedIds.has(item.id) && (
                          <div className="space-y-1">
                            <Label
                              htmlFor={`purchase-${item.id}`}
                              className="text-xs"
                            >
                              {t(
                                'settings.mealPlanning.shopping.boughtNow',
                                'Bought now'
                              )}
                            </Label>
                            <div className="flex items-center gap-2">
                              <Input
                                id={`purchase-${item.id}`}
                                type="number"
                                min="0.001"
                                step="any"
                                className="w-28"
                                value={quantityValue}
                                aria-invalid={quantityInvalid}
                                aria-label={t(
                                  'settings.mealPlanning.shopping.boughtNowFor',
                                  'Bought now for {{name}}',
                                  { name: item.name }
                                )}
                                onChange={(event) =>
                                  setPurchaseQuantities((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />
                              <span className="text-sm text-muted-foreground">
                                {planningUnitLabel(t, item.unit)}
                              </span>
                            </div>
                          </div>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t(
                            'settings.mealPlanning.shopping.editItem',
                            'Edit {{name}}',
                            { name: item.name }
                          )}
                          disabled={item.status !== 'needed'}
                          onClick={() => openEditDialog(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t(
                            'settings.mealPlanning.shopping.removeItem',
                            'Remove {{name}}',
                            { name: item.name }
                          )}
                          disabled={item.status !== 'needed'}
                          onClick={() => setRemovingItem(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingItem
                ? t('settings.mealPlanning.shopping.editTitle', 'Edit item')
                : t(
                    'settings.mealPlanning.shopping.addTitle',
                    'Add shopping item'
                  )}
            </DialogTitle>
            <DialogDescription>
              {t(
                'settings.mealPlanning.shopping.formDescription',
                'Set the amount you need. You can confirm a smaller amount after shopping.'
              )}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitItem}>
            <div className="space-y-2">
              <Label htmlFor="shopping-item-name">
                {t('settings.mealPlanning.fields.name', 'Name')}
              </Label>
              <Input
                id="shopping-item-name"
                value={form.name}
                maxLength={200}
                required
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="shopping-item-quantity">
                  {t(
                    'settings.mealPlanning.fields.requiredQuantity',
                    'Needed amount'
                  )}
                </Label>
                <Input
                  id="shopping-item-quantity"
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  value={form.requiredQuantity}
                  onChange={(event) =>
                    setForm({ ...form, requiredQuantity: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shopping-item-unit">
                  {t('settings.mealPlanning.fields.unit', 'Unit')}
                </Label>
                <Select
                  value={form.unit}
                  disabled={editingItem !== null}
                  onValueChange={(unit: CoachMealPlanningUnit) =>
                    setForm({ ...form, unit })
                  }
                >
                  <SelectTrigger id="shopping-item-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEAL_PLANNING_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {planningUnitLabel(t, unit)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="shopping-item-category">
                {t('settings.mealPlanning.fields.category', 'Grocery section')}
              </Label>
              <Select
                value={form.category}
                onValueChange={(category: CoachMealPlanningCategory) =>
                  setForm({ ...form, category })
                }
              >
                <SelectTrigger id="shopping-item-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEAL_PLANNING_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {planningCategoryLabel(t, category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="shopping-item-notes">
                {t('settings.mealPlanning.fields.notes', 'Notes')}
              </Label>
              <Textarea
                id="shopping-item-notes"
                rows={2}
                maxLength={1000}
                value={form.notes}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </div>
            {editingItem &&
              compatibleProductOptions(editingItem).length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="shopping-item-product">
                    {t(
                      'settings.mealPlanning.fields.productPreference',
                      'Preferred product'
                    )}
                  </Label>
                  <Select
                    value={form.productKey}
                    onValueChange={(value) =>
                      setForm({ ...form, productKey: value })
                    }
                  >
                    <SelectTrigger id="shopping-item-product">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        {t(
                          'settings.mealPlanning.fields.noPreference',
                          'No preference'
                        )}
                      </SelectItem>
                      {compatibleProductOptions(editingItem).map((product) => (
                        <SelectItem
                          key={productKey(product)}
                          value={productKey(product)}
                        >
                          {retailerLabel(t, product.retailer)} · {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedProductForKey(
                    compatibleProductOptions(editingItem),
                    form.productKey
                  )?.note && (
                    <RetailProductNote
                      note={
                        selectedProductForKey(
                          compatibleProductOptions(editingItem),
                          form.productKey
                        )?.note ?? ''
                      }
                    />
                  )}
                </div>
              )}
            {editingItem && (
              <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <Checkbox
                  checked={form.quantityLocked}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, quantityLocked: checked === true })
                  }
                />
                <span>
                  <span className="font-medium">
                    {t(
                      'settings.mealPlanning.shopping.lockQuantity',
                      'Keep this amount fixed'
                    )}
                  </span>
                  <span className="block text-muted-foreground">
                    {t(
                      'settings.mealPlanning.shopping.lockQuantityDescription',
                      'Future plan updates will not recalculate it.'
                    )}
                  </span>
                </span>
              </label>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                type="submit"
                disabled={createItem.isPending || patchItem.isPending}
              >
                {t('common.save', 'Save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={purchaseDialogOpen}
        onOpenChange={setPurchaseDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                'settings.mealPlanning.shopping.purchaseConfirmTitle',
                'Add these purchases to your pantry?'
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">
                {t(
                  'settings.mealPlanning.shopping.purchaseConfirmDescription',
                  'Only the amounts shown below are confirmed. Any remainder stays on the shopping list.'
                )}
              </span>
              <ul className="mt-3 space-y-1 text-foreground">
                {purchases.map((purchase) => {
                  const item = items.find(
                    (candidate) => candidate.id === purchase.itemId
                  );
                  if (!item) return null;
                  return (
                    <li key={purchase.itemId}>
                      {item.name}: {formatPlanningQuantity(purchase.quantity)}{' '}
                      {planningUnitLabel(t, item.unit)}
                    </li>
                  );
                })}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('common.cancel', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!purchaseSelectionValid || confirmPurchase.isPending}
              onClick={confirmSelectedPurchase}
            >
              {t(
                'settings.mealPlanning.shopping.confirmPurchase',
                'Confirm purchase'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removingItem !== null}
        onOpenChange={(open) => !open && setRemovingItem(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.mealPlanning.shopping.removeTitle', 'Remove item?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'settings.mealPlanning.shopping.removeDescription',
                'This removes the item from the current shopping list.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('common.cancel', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!removingItem) return;
                removeItem.mutate(removingItem.id, {
                  onSuccess: () => {
                    clearPurchaseSelection(removingItem.id);
                    setRemovingItem(null);
                  },
                });
              }}
            >
              {t('settings.mealPlanning.shopping.remove', 'Remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
