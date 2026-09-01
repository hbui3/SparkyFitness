export const SWISS_RETAIL_INGREDIENT_KEYS = {
  magerquark: 'magerquark',
  rice: 'reis',
  broccoli: 'brokkoli',
  oats: 'haferflocken',
  eggs: 'eier',
  chickenBreast: 'hahnchenbrust',
  naturalTofu: 'naturtofu',
  mixedVegetables: 'gemusemischung',
} as const;

export type SwissRetailIngredientKey =
  (typeof SWISS_RETAIL_INGREDIENT_KEYS)[keyof typeof SWISS_RETAIL_INGREDIENT_KEYS];

export type SwissRetailer = 'coop' | 'migros';
export type SwissRetailPackageUnit = 'g' | 'piece';

export interface SwissRetailProductReference {
  readonly retailer: SwissRetailer;
  readonly retailerProductId: string;
  readonly gtin: null;
  readonly name: string;
  readonly packageQuantity: number;
  readonly packageUnit: SwissRetailPackageUnit;
  readonly directUrl: string;
  readonly verifiedAt: string;
  readonly note: string | null;
}

const VERIFIED_AT = '2026-09-01T00:00:00.000Z';

export const SWISS_RETAIL_PRODUCT_CATALOG: Readonly<
  Record<SwissRetailIngredientKey, readonly SwissRetailProductReference[]>
> = {
  magerquark: [
    {
      retailer: 'coop',
      retailerProductId: '6568630',
      gtin: null,
      name: 'Prix Garantie Magerquark',
      packageQuantity: 500,
      packageUnit: 'g',
      directUrl:
        'https://www.coop.ch/de/lebensmittel/milchprodukte-eier/quark/quark-nature/prix-garantie-magerquark/p/6568630',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
    {
      retailer: 'migros',
      retailerProductId: '200803100000',
      gtin: null,
      name: 'M-Budget · Magerquark',
      packageQuantity: 500,
      packageUnit: 'g',
      directUrl: 'https://www.migros.ch/de/product/200803100000',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
  ],
  reis: [
    {
      retailer: 'coop',
      retailerProductId: '6554390',
      gtin: null,
      name: 'Prix Garantie Langkornreis Parboiled',
      packageQuantity: 1000,
      packageUnit: 'g',
      directUrl:
        'https://www.coop.ch/de/lebensmittel/vorraete/grundnahrungsmittel/reis/langkorn-vitamin-camolino/prix-garantie-langkornreis-parboiled/p/6554390',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
    {
      retailer: 'migros',
      retailerProductId: '104415300000',
      gtin: null,
      name: 'Migros · Langkornreis · parboiled',
      packageQuantity: 1000,
      packageUnit: 'g',
      directUrl: 'https://www.migros.ch/de/product/104415300000',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
  ],
  brokkoli: [
    {
      retailer: 'coop',
      retailerProductId: '5821161',
      gtin: null,
      name: 'Broccoli',
      packageQuantity: 750,
      packageUnit: 'g',
      directUrl:
        'https://www.coop.ch/de/lebensmittel/tiefgekuehlt/fruechte-gemuese/gemuese-kartoffelprodukte/sortenreine-gemuese/broccoli/p/5821161',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
    {
      retailer: 'migros',
      retailerProductId: '161619900000',
      gtin: null,
      name: 'M-Budget · Broccoli',
      packageQuantity: 750,
      packageUnit: 'g',
      directUrl: 'https://www.migros.ch/de/product/161619900000',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
  ],
  haferflocken: [
    {
      retailer: 'coop',
      retailerProductId: '6525757',
      gtin: null,
      name: 'Prix Garantie Haferflocken grob',
      packageQuantity: 500,
      packageUnit: 'g',
      directUrl:
        'https://www.coop.ch/de/lebensmittel/vorraete/mueesli-cerealien/flakes/prix-garantie-haferflocken-grob/p/6525757',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
    {
      retailer: 'migros',
      retailerProductId: '104202100000',
      gtin: null,
      name: 'M-Classic · Vollkorn-Haferflocken · grob',
      packageQuantity: 1000,
      packageUnit: 'g',
      directUrl: 'https://www.migros.ch/de/product/104202100000',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
  ],
  eier: [
    {
      retailer: 'coop',
      retailerProductId: '7510474',
      gtin: null,
      name: 'Freilandeier 53g+ 10 Stück',
      packageQuantity: 10,
      packageUnit: 'piece',
      directUrl:
        'https://www.coop.ch/de/lebensmittel/milchprodukte-eier/eier/eier-roh/freilandeier-53g-10-stueck/p/7510474',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
    {
      retailer: 'migros',
      retailerProductId: '196025001000',
      gtin: null,
      name: 'Eier · 53+ Freilandhaltung',
      packageQuantity: 10,
      packageUnit: 'piece',
      directUrl: 'https://www.migros.ch/de/product/196025001000',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
  ],
  hahnchenbrust: [
    {
      retailer: 'coop',
      retailerProductId: '6644873',
      gtin: null,
      name: 'Pouletbrust',
      packageQuantity: 1000,
      packageUnit: 'g',
      directUrl:
        'https://www.coop.ch/de/lebensmittel/tiefgekuehlt/fleisch-fisch/fleisch-gefluegel/pouletbrust/p/6644873',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
    {
      retailer: 'migros',
      retailerProductId: '166001400000',
      gtin: null,
      name: 'M-Budget · Pouletbrust-Geschnetzeltes · mit Würzlake',
      packageQuantity: 750,
      packageUnit: 'g',
      directUrl: 'https://www.migros.ch/de/product/166001400000',
      verifiedAt: VERIFIED_AT,
      note: 'Alternative, kein Naturprodukt: 83 % Poulet mit Würzlake.',
    },
  ],
  naturtofu: [
    {
      retailer: 'coop',
      retailerProductId: '7543630',
      gtin: null,
      name: 'Prix Garantie Tofu nature',
      packageQuantity: 400,
      packageUnit: 'g',
      directUrl:
        'https://www.coop.ch/de/lebensmittel/fertiggerichte/tofu/frischer-tofu/prix-garantie-tofu-nature/p/7543630',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
    {
      retailer: 'migros',
      retailerProductId: '130927400000',
      gtin: null,
      name: 'M-Budget · Tofu · Bio, Nature, vegan',
      packageQuantity: 300,
      packageUnit: 'g',
      directUrl: 'https://www.migros.ch/de/product/130927400000',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
  ],
  gemusemischung: [
    {
      retailer: 'coop',
      retailerProductId: '4881523',
      gtin: null,
      name: 'Prix Garantie Schweizer Gemüsemischung',
      packageQuantity: 1200,
      packageUnit: 'g',
      directUrl:
        'https://www.coop.ch/de/lebensmittel/tiefgekuehlt/fruechte-gemuese/gemuese-kartoffelprodukte/gemuese-mischungen/prix-garantie-schweizer-gemuesemischung/p/4881523',
      verifiedAt: VERIFIED_AT,
      note: 'Enthält Sellerie.',
    },
    {
      retailer: 'migros',
      retailerProductId: '161644700000',
      gtin: null,
      name: 'M-Budget · Gemüsemischung',
      packageQuantity: 800,
      packageUnit: 'g',
      directUrl: 'https://www.migros.ch/de/product/161644700000',
      verifiedAt: VERIFIED_AT,
      note: null,
    },
  ],
};

export function getSwissRetailProductReferences(
  ingredientKey: string
): readonly SwissRetailProductReference[] {
  if (!Object.hasOwn(SWISS_RETAIL_PRODUCT_CATALOG, ingredientKey)) return [];
  return SWISS_RETAIL_PRODUCT_CATALOG[
    ingredientKey as SwissRetailIngredientKey
  ];
}

export function getSwissRetailProductReference(
  ingredientKey: string,
  retailer: SwissRetailer
): SwissRetailProductReference | null {
  return (
    getSwissRetailProductReferences(ingredientKey).find(
      (reference) => reference.retailer === retailer
    ) ?? null
  );
}
