import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type {
  CoachMealPlanningCategory,
  CoachMealPlanningUnit,
  CoachPantryItemResponse,
  CreateCoachPantryItemRequest,
  PatchCoachPantryItemRequest,
  PreferredRetailProduct,
  RetailProductRef,
} from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  useArchiveCoachPantryItem,
  useCreateCoachPantryItem,
  usePatchCoachPantryItem,
} from '@/hooks/Settings/useMealPlanning';
import {
  formatPlanningQuantity,
  MEAL_PLANNING_CATEGORIES,
  MEAL_PLANNING_UNITS,
  planningCategoryLabel,
  planningUnitLabel,
  retailerLabel,
} from './mealPlanningUi';
import RetailProductNote from './RetailProductNote';

interface PantryViewProps {
  pantry: CoachPantryItemResponse[];
}

interface PantryFormState {
  name: string;
  quantity: string;
  minimumQuantity: string;
  unit: CoachMealPlanningUnit;
  category: CoachMealPlanningCategory;
  expiresOn: string;
  productKey: string;
}

const EMPTY_FORM: PantryFormState = {
  name: '',
  quantity: '0',
  minimumQuantity: '0',
  unit: 'piece',
  category: 'other',
  expiresOn: '',
  productKey: 'none',
};

function productKey(product: RetailProductRef): string {
  return `${product.retailer}:${product.retailerProductId}`;
}

function preferredProductForKey(
  options: RetailProductRef[],
  key: string
): PreferredRetailProduct | null {
  if (key === 'none') return null;
  const product = options.find((option) => productKey(option) === key);
  return product
    ? {
        retailer: product.retailer,
        retailerProductId: product.retailerProductId,
      }
    : null;
}

function currentPreferredProductKey(item: CoachPantryItemResponse): string {
  if (!item.preferredRetailer || !item.preferredRetailerProductId)
    return 'none';
  return `${item.preferredRetailer}:${item.preferredRetailerProductId}`;
}

export default function PantryView({ pantry }: PantryViewProps) {
  const { t } = useTranslation();
  const createItem = useCreateCoachPantryItem();
  const patchItem = usePatchCoachPantryItem();
  const archiveItem = useArchiveCoachPantryItem();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] =
    useState<CoachPantryItemResponse | null>(null);
  const [archivingItem, setArchivingItem] =
    useState<CoachPantryItemResponse | null>(null);
  const [form, setForm] = useState<PantryFormState>(EMPTY_FORM);
  const filteredPantry = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return pantry;
    return pantry.filter(
      (item) =>
        item.name.toLocaleLowerCase().includes(term) ||
        item.ingredientKey.toLocaleLowerCase().includes(term) ||
        planningCategoryLabel(t, item.category)
          .toLocaleLowerCase()
          .includes(term)
    );
  }, [pantry, search, t]);
  const groupedItems = useMemo(
    () =>
      MEAL_PLANNING_CATEGORIES.map((category) => ({
        category,
        items: filteredPantry.filter((item) => item.category === category),
      })).filter((group) => group.items.length > 0),
    [filteredPantry]
  );
  const selectedFormProduct = editingItem
    ? (editingItem.productOptions.find(
        (product) => productKey(product) === form.productKey
      ) ?? null)
    : null;

  const openAddDialog = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (item: CoachPantryItemResponse) => {
    setEditingItem(item);
    setForm({
      name: item.name,
      quantity: String(item.quantity),
      minimumQuantity: String(item.minimumQuantity),
      unit: item.unit,
      category: item.category,
      expiresOn: item.expiresOn ?? '',
      productKey: currentPreferredProductKey(item),
    });
    setDialogOpen(true);
  };

  const submitItem = (event: FormEvent) => {
    event.preventDefault();
    const quantity = Number(form.quantity);
    const minimumQuantity = Number(form.minimumQuantity);
    if (
      !form.name.trim() ||
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      !Number.isFinite(minimumQuantity) ||
      minimumQuantity < 0
    ) {
      return;
    }
    if (editingItem) {
      const originalProductKey = currentPreferredProductKey(editingItem);
      const productChanged = form.productKey !== originalProductKey;
      const request: PatchCoachPantryItemRequest = {
        name: form.name.trim(),
        quantity,
        minimumQuantity,
        category: form.category,
        expiresOn: form.expiresOn || null,
        ...(productChanged
          ? {
              preferredProduct: preferredProductForKey(
                editingItem.productOptions,
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
    const request: CreateCoachPantryItemRequest = {
      name: form.name.trim(),
      quantity,
      minimumQuantity,
      unit: form.unit,
      category: form.category,
      expiresOn: form.expiresOn || null,
      preferredProduct: null,
    };
    createItem.mutate(request, { onSuccess: () => setDialogOpen(false) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold">
            {t('settings.mealPlanning.pantry.title', 'Pantry')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.mealPlanning.pantry.description',
              'Keep available amounts and preferred products up to date so the coach plans realistically.'
            )}
          </p>
        </div>
        <Button type="button" onClick={openAddDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {t('settings.mealPlanning.pantry.add', 'Add pantry item')}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="meal-planning-pantry-search">
          {t('settings.mealPlanning.pantry.search', 'Search pantry items')}
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="meal-planning-pantry-search"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t(
              'settings.mealPlanning.pantry.search',
              'Search pantry items'
            )}
          />
        </div>
      </div>

      {filteredPantry.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {search
            ? t(
                'settings.mealPlanning.pantry.noSearchResults',
                'No pantry items match your search.'
              )
            : t(
                'settings.mealPlanning.pantry.empty',
                'Your pantry is empty. Add what you already have at home.'
              )}
        </div>
      ) : (
        <div className="space-y-5">
          {groupedItems.map((group) => (
            <section key={group.category} className="space-y-2">
              <h4 className="text-sm font-semibold">
                {planningCategoryLabel(t, group.category)}
              </h4>
              <div className="grid gap-3 lg:grid-cols-2">
                {group.items.map((item) => {
                  const preferredProduct = item.productOptions.find(
                    (product) =>
                      product.retailer === item.preferredRetailer &&
                      product.retailerProductId ===
                        item.preferredRetailerProductId
                  );
                  const archiveBlocked =
                    item.isActive &&
                    (item.quantity > 0 || item.reservedQuantity > 0);
                  const archiveBlockedDescriptionId = `pantry-archive-blocked-${item.id}`;
                  return (
                    <article
                      key={item.id}
                      className={`space-y-3 rounded-lg border p-3 ${!item.isActive ? 'bg-muted/30 text-muted-foreground' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h5 className="font-medium">{item.name}</h5>
                            {item.shortageQuantity > 0 && (
                              <Badge variant="destructive">
                                <TriangleAlert className="mr-1 h-3 w-3" />
                                {t(
                                  'settings.mealPlanning.pantry.low',
                                  'Low stock'
                                )}
                              </Badge>
                            )}
                            {!item.isActive && (
                              <Badge variant="outline">
                                {t(
                                  'settings.mealPlanning.pantry.archived',
                                  'Archived'
                                )}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-lg font-semibold tabular-nums">
                            {formatPlanningQuantity(item.availableQuantity)}{' '}
                            {planningUnitLabel(t, item.unit)}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {t(
                                'settings.mealPlanning.pantry.available',
                                'available'
                              )}
                            </span>
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={t(
                              'settings.mealPlanning.pantry.editItem',
                              'Edit {{name}}',
                              { name: item.name }
                            )}
                            onClick={() => openEditDialog(item)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={t(
                              'settings.mealPlanning.pantry.archiveItem',
                              'Archive {{name}}',
                              { name: item.name }
                            )}
                            aria-describedby={
                              archiveBlocked
                                ? archiveBlockedDescriptionId
                                : undefined
                            }
                            disabled={!item.isActive || archiveBlocked}
                            onClick={() => setArchivingItem(item)}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/30 p-2 text-xs">
                        <div>
                          <span className="block text-muted-foreground">
                            {t('settings.mealPlanning.pantry.total', 'Total')}
                          </span>
                          {formatPlanningQuantity(item.quantity)}{' '}
                          {planningUnitLabel(t, item.unit)}
                        </div>
                        <div>
                          <span className="block text-muted-foreground">
                            {t(
                              'settings.mealPlanning.pantry.minimum',
                              'Target stock'
                            )}
                          </span>
                          {formatPlanningQuantity(item.minimumQuantity)}{' '}
                          {planningUnitLabel(t, item.unit)}
                        </div>
                        <div>
                          <span className="block text-muted-foreground">
                            {t(
                              'settings.mealPlanning.pantry.reserved',
                              'Reserved'
                            )}
                          </span>
                          {formatPlanningQuantity(item.reservedQuantity)}{' '}
                          {planningUnitLabel(t, item.unit)}
                        </div>
                        <div>
                          <span className="block text-muted-foreground">
                            {t(
                              'settings.mealPlanning.pantry.expires',
                              'Expires'
                            )}
                          </span>
                          {item.expiresOn ??
                            t(
                              'settings.mealPlanning.pantry.noExpiry',
                              'Not set'
                            )}
                        </div>
                      </div>

                      {archiveBlocked && (
                        <p
                          id={archiveBlockedDescriptionId}
                          className="flex items-start gap-1.5 text-xs text-muted-foreground"
                        >
                          <TriangleAlert
                            aria-hidden="true"
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                          />
                          {t(
                            'settings.mealPlanning.pantry.archiveBlocked',
                            'Set total stock to 0 and make sure nothing is reserved for planned meals before archiving.'
                          )}
                        </p>
                      )}

                      {preferredProduct && (
                        <div className="space-y-2">
                          <Button asChild size="sm" variant="outline">
                            <a
                              href={preferredProduct.directUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t(
                                'settings.mealPlanning.pantry.preferredProductLink',
                                '{{retailer}}: {{product}}',
                                {
                                  retailer: retailerLabel(
                                    t,
                                    preferredProduct.retailer
                                  ),
                                  product: preferredProduct.name,
                                }
                              )}
                              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                            </a>
                          </Button>
                          {preferredProduct.note && (
                            <RetailProductNote note={preferredProduct.note} />
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingItem
                ? t(
                    'settings.mealPlanning.pantry.editTitle',
                    'Edit pantry item'
                  )
                : t('settings.mealPlanning.pantry.addTitle', 'Add pantry item')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'settings.mealPlanning.pantry.formDescription',
                'Use the package unit you normally buy so planning and shopping stay consistent.'
              )}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitItem}>
            <div className="space-y-2">
              <Label htmlFor="pantry-item-name">
                {t('settings.mealPlanning.fields.name', 'Name')}
              </Label>
              <Input
                id="pantry-item-name"
                value={form.name}
                maxLength={200}
                required
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="pantry-item-quantity">
                  {t('settings.mealPlanning.fields.quantity', 'Amount at home')}
                </Label>
                <Input
                  id="pantry-item-quantity"
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={form.quantity}
                  onChange={(event) =>
                    setForm({ ...form, quantity: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pantry-item-minimum">
                  {t(
                    'settings.mealPlanning.fields.minimumQuantity',
                    'Target stock'
                  )}
                </Label>
                <Input
                  id="pantry-item-minimum"
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={form.minimumQuantity}
                  onChange={(event) =>
                    setForm({ ...form, minimumQuantity: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pantry-item-unit">
                  {t('settings.mealPlanning.fields.unit', 'Unit')}
                </Label>
                <Select
                  value={form.unit}
                  disabled={editingItem !== null}
                  onValueChange={(unit: CoachMealPlanningUnit) =>
                    setForm({ ...form, unit })
                  }
                >
                  <SelectTrigger id="pantry-item-unit">
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pantry-item-category">
                  {t(
                    'settings.mealPlanning.fields.category',
                    'Grocery section'
                  )}
                </Label>
                <Select
                  value={form.category}
                  onValueChange={(category: CoachMealPlanningCategory) =>
                    setForm({ ...form, category })
                  }
                >
                  <SelectTrigger id="pantry-item-category">
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
                <Label htmlFor="pantry-item-expiry">
                  {t('settings.mealPlanning.fields.expiresOn', 'Expiry date')}
                </Label>
                <Input
                  id="pantry-item-expiry"
                  type="date"
                  value={form.expiresOn}
                  onChange={(event) =>
                    setForm({ ...form, expiresOn: event.target.value })
                  }
                />
              </div>
            </div>
            {editingItem &&
              (editingItem.productOptions.length > 0 ||
                currentPreferredProductKey(editingItem) !== 'none') && (
                <div className="space-y-2">
                  <Label htmlFor="pantry-item-product">
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
                    <SelectTrigger id="pantry-item-product">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        {t(
                          'settings.mealPlanning.fields.noPreference',
                          'No preference'
                        )}
                      </SelectItem>
                      {currentPreferredProductKey(editingItem) !== 'none' &&
                        !editingItem.productOptions.some(
                          (product) =>
                            productKey(product) ===
                            currentPreferredProductKey(editingItem)
                        ) && (
                          <SelectItem
                            value={currentPreferredProductKey(editingItem)}
                          >
                            {t(
                              'settings.mealPlanning.fields.currentPreference',
                              'Current preference: {{retailer}} · {{productId}}',
                              {
                                retailer: editingItem.preferredRetailer
                                  ? retailerLabel(
                                      t,
                                      editingItem.preferredRetailer
                                    )
                                  : '',
                                productId:
                                  editingItem.preferredRetailerProductId ?? '',
                              }
                            )}
                          </SelectItem>
                        )}
                      {editingItem.productOptions.map((product) => (
                        <SelectItem
                          key={productKey(product)}
                          value={productKey(product)}
                        >
                          {retailerLabel(t, product.retailer)} · {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedFormProduct?.note && (
                    <RetailProductNote note={selectedFormProduct.note} />
                  )}
                </div>
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
        open={archivingItem !== null}
        onOpenChange={(open) => !open && setArchivingItem(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                'settings.mealPlanning.pantry.archiveTitle',
                'Archive pantry item?'
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'settings.mealPlanning.pantry.archiveDescription',
                'Only empty, unreserved items can be archived. Past pantry changes remain in your history.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('common.cancel', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveItem.isPending}
              onClick={() => {
                if (!archivingItem) return;
                archiveItem.mutate(archivingItem.id, {
                  onSuccess: () => setArchivingItem(null),
                });
              }}
            >
              {t('settings.mealPlanning.pantry.archive', 'Archive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
