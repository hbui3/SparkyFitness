# Canadian Nutrient File (Health Canada)

The Canadian Nutrient File (CNF) is the authoritative Canadian food composition database maintained and published by Health Canada. It contains nutritional data for approximately 5,700 foods and up to 152 nutritional components per item.

SparkyFitness provides native support for the Canadian Nutrient File with both **live on-demand search** and **high-speed offline bulk catalog import**.

---

## Key Capabilities

* **Zero Credentials Required**: Completely free and public; no API keys, accounts, or developer registration needed.
* **Bilingual Support**: Fully supports querying and importing foods in both **English (`en`)** and **French (`fr`)**.
* **Live On-Demand Search**: Search foods instantly against Health Canada's official API from both the Web and Mobile app.
* **Bulk Catalog Import**: Download and import all ~5,700 items with complete portion measurements and micro-nutrients in under a minute using high-performance batched database transactions.
* **Portion Measures & Variants**: Includes base 100g reference profiles along with common Canadian household portion sizes (e.g. *1 small*, *1 medium*, *1 cup*, *1 slice*).
* **Automatic Micronutrient Mapping**: Extracts detailed vitamins, minerals, and fatty acid profiles and maps them to your SparkyFitness custom nutrient definitions.
* **Past Diary Sync Option**: Sync new CNF nutrient mappings to past diary entries while preserving diary history.

---

## Availability

::: tip No Setup Required for Users
The Canadian Nutrient File is included as a **default global provider** on every SparkyFitness instance. All users can immediately search and log CNF foods from both the Web and Mobile apps without any configuration. There is nothing to set up, no API keys to enter, and no per-user provider to add.
:::

If your administrator has not yet enabled the CNF provider, they can add it under **Administration → Global Data Providers** or **Settings → External Providers** as an admin. Once added, it becomes available to every user on the server.

---

## Using the Canadian Nutrient File

### Live Online Search

Once the provider is active, Canadian Nutrient File results stream in automatically when you search for foods in the diary:

* **Web**: Appears under the **Canadian Nutrient File** section in the food search dialog.
* **Mobile**: Select **Canadian Nutrient File** from the **Online Results** dropdown filter on the food search screen.

Selecting a food from the online results automatically pulls its complete nutritional profile, portion sizes, and micronutrients into your diary entry and saves a snapshot into your library.

---

## Bulk Catalog Import & Offline Library (Admin Only)

::: warning Admin Only
The bulk catalog import is an **administrator-only** feature. Regular users do not need to perform this step — they can already search and log CNF foods via live online search. Administrators may choose to run a bulk import to pre-populate the entire ~5,700-item catalog for faster offline search across all users.
:::

### Opening the Import Dialog

1. Go to **Settings → External Providers**.
2. Locate the **Canadian Nutrient File** provider card.
3. Click the **CNF Bulk Import** button (download icon).

### Import Options

* **Sync Scope**:
  * **Sync library only (Recommended)**: Adds new foods and updates existing CNF library items without modifying past logged diary entries.
  * **Sync library and update past entries**: Updates existing food library records and re-syncs nutrient profiles and variant structures on past diary logs that reference them.
* **Catalog Source**:
  * **Download official archive (Automated)**: SparkyFitness downloads the latest official distribution archive directly from Health Canada in the background.
  * **Upload local CNF zip archive**: Upload a previously downloaded `cnf-fcen-csv.zip` archive directly from your browser.
* **Language**:
  * Choose **English** or **French** to set the primary imported food descriptions and portion measure units.
* **Sample Import**:
  * Check **Sample Import (first 10 foods only)** to import a small batch and verify portion measurements and custom nutrient mappings before running the full import.

### Clearing the Library

If you wish to remove imported CNF foods, click **Clear CNF Library** in the import dialog. In accordance with SparkyFitness library delete policies, all personal diary logs and meal history referencing these foods are safely preserved as self-contained snapshots.

---

## Micronutrient & Custom Nutrient Matching

Canadian Nutrient File items include rich micronutrient profiles reported by Health Canada laboratories. When imported or searched, SparkyFitness extracts and maps:

| Nutrient Group | Key Nutrients Mapped |
| :--- | :--- |
| **Macronutrients** | Calories, Protein, Carbohydrates, Total Fat, Saturated Fat, Polyunsaturated Fat, Monounsaturated Fat, Trans Fat |
| **Carbohydrates & Fiber** | Dietary Fiber, Total Sugars |
| **Vitamins** | Vitamin A (RAE / IU), Vitamin C, Vitamin D, Vitamin E, Folate, Vitamin B6, Vitamin B12, Thiamin, Riboflavin, Niacin |
| **Minerals** | Sodium, Potassium, Calcium, Iron, Magnesium, Phosphorus, Zinc, Copper, Manganese, Selenium |
| **Others** | Cholesterol, Caffeine, Alcohol, Water |

If you have configured custom nutrients under **Settings → Custom Nutrients**, any CNF nutrient matching your custom nutrient's name or alias will be populated automatically.

---

## Licensing & Attribution

The Canadian Nutrient File is published by Health Canada under the **Open Government Licence – Canada (OGL-Canada-2.0)**.

* **Attribution**: *Contains information published by Health Canada licensed under the Open Government Licence – Canada.*
* **License Details**: [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada)
* **Official Open Data Portal**: [Canadian Nutrient File Dataset](https://open.canada.ca/data/en/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109)

::: tip Non-Endorsement
Use of this data does not imply that Health Canada endorses SparkyFitness or your use of the dataset.
:::
