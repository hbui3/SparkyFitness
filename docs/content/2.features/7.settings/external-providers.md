# External Providers

SparkyFitness supports integration with external health and fitness data providers to automatically sync your activity and measurements.

---

## Supported Providers

SparkyFitness supports integration with the following health and fitness data providers:

- Apple Health (iOS)
- Google Health Connect (Android)
- Fitbit
- Garmin Connect
- Oura Ring
- Withings
- Polar Flow (partially tested)
- Hevy (not tested)
- Speediance (unofficial API; completed workout import plus custom workout scheduling)
- iGPSPORT (unofficial web API; original FIT activity import)
- OpenFoodFacts
- USDA
- Fatsecret
- Nutritionix
- Mealie
- Tandoor
- Strava (partially tested)

Speediance accounts are configured with an email, password, and account region
(EU or Global). Credentials are encrypted in the SparkyFitness database and are
used only when a manual or scheduled workout import signs in. Program and custom
workouts include their exercise/set details; Free Lift and Quick sessions are
imported as session summaries. Because this relies on an unofficial mobile API,
it may need maintenance when Speediance changes its backend.

Under **Training**, the owner can open the Speediance Workout Manager to list,
create, and edit complete custom workouts and reserve them on calendar days.
Exercises can be reordered and configured with warm-up, muscle-gain, stamina,
strength, or fixed-kilogram presets; standard, chains, and eccentric resistance;
repetitions, timed or calorie targets, target RM or fixed weight, Vita levels,
and per-set rest. Each saved remote
workout is mirrored to a native Sparky workout preset, so the same training can
still be used when Speediance is unavailable. Speediance is intentionally not
shown in the generic Online exercise importer because safe workout creation
requires the dedicated variant and payload checks.
Deleting a remote workout requires confirmation of its current exact name; the
native Sparky preset is deliberately preserved for history and offline use.

The AI coach exposes the same manager operations. After explicit owner intent,
it can read and update an exact existing workout (for example, insert separate
warm-up blocks), schedule or unschedule it, or create a dated multi-month plan.
Multi-month plans use SparkyFitness's existing workout plan templates and future
diary sessions while reserving the corresponding dates in Speediance; there is
no parallel plan database. Exercise group, variant, title, accessory
requirements, and set configuration are verified against Speediance before and
after each write.
Speediance can provide several coach/video versions of the same exercise.
SparkyFitness selects the explicitly German (`coachLanguage: de`) version by
default and blocks automated workout creation for an exercise when no German
coach video is available.
An identically named workout is reused only when its complete exercise and set
content matches. If only its coach/video variants are outdated, SparkyFitness
updates the existing template to the current German variants. Other ambiguous
or conflicting remote state is not overwritten.
Before proposing or scheduling the next workout, the coach reads the owner's
recent structured workout feedback and active training preferences. It can use
bounded volume/rest guidance and preferred exercises, while an exercise marked
as avoided is blocked at the Speediance write boundary unless the owner
explicitly overrides that exact preference.

When proactive training coaching is enabled, still-open planned sessions are
named in the adaptive reminders. A plan session missed yesterday is copied to
today in Sparky and, when the remote account is reachable, reserved for today in
Speediance. The next morning message explicitly identifies the missed workout;
later reminders remain concrete until the planned session is completed.

iGPSPORT accounts are configured with an email address or phone number,
password, and account region (Global or China). SparkyFitness encrypts these
credentials and uses them only for manual or scheduled imports. The importer
downloads the original FIT file for each activity, so supported FIT fields such
as GPS tracks, heart rate, power, cadence, elevation, laps, duration, distance,
calories, and time-series detail flow through the existing native FIT pipeline.
When the same workout also arrives through Apple Health, the richer iGPSPORT
record takes priority in activity reports. The integration uses an unofficial
web API and may require maintenance when iGPSPORT changes its backend.

## Open Food Facts Accounts and Contributions

Open Food Facts searches work without an account. Adding both an Open Food Facts username and password lets SparkyFitness publish an individual product only after you review its exact preview and confirm the data and photo rights. This first release supports manual contributions, one product at a time.

You can configure credentials in either place:

- **Personal:** Go to **Settings → Food & Exercise Data Providers** and add or edit an active Open Food Facts provider. The contribution card lets you save the two-letter language of your product packaging. A personal account takes priority over a global account.
- **Server-wide:** An administrator can open **Administration → Global Data Providers** and enable **Allow Open Food Facts contributions on this server**. An active global Open Food Facts account is an optional fallback for users without a personal account. The server gate is disabled by default. Enabling it or saving credentials does not publish any products or provide consent for users.

Credentials are encrypted at rest. Both username and password are required for contributions, and credentialed contribution endpoints must use HTTPS. Self-hosted HTTP instances remain available for unauthenticated searches.

For sandbox testing, set the provider URL to `https://world.openfoodfacts.net`. SparkyFitness automatically supplies the staging server's documented `off:off` HTTP Basic gate. Open Food Facts production and staging accounts are separate, so the provider must use an account registered on the selected environment.

To contribute a product:

1. Create or edit your own custom food and choose **Save and preview contribution**, or open the saved food's menu and select **Contribute to Open Food Facts**. The food is saved locally before the contribution dialog opens.
2. Select a fresh photo you took of the product's front, nutrition label or packaging. Choose what the photo shows and check the two-letter product language. JPEG, PNG and WebP photos are converted to JPEG and image metadata is removed. The photo must be clear enough to read; tiny images are rejected.
3. Choose **Preview contribution**. Review the destination product link, whether the product already exists, which account will publish, the sanitized photo and every outgoing field. Open the existing public product to compare its current information.
4. Separately confirm that you entered and verified the packaging data and that you took and own the photo. Then choose **Publish this contribution**. Both confirmations start unchecked for every new preview.

SparkyFitness sends the product name, brand, barcode, serving information and eligible nutrition from the default variant. Only custom products entered locally from physical packaging are eligible. Imported data, including products downloaded from Open Food Facts or proprietary third-party databases, is excluded. A non-internal, checksum-valid barcode, product name and metric-convertible default serving are required. Unknown nutrients are not turned into zeroes. The server rechecks ownership and eligibility before publication; family delegates cannot contribute someone else's food.

The preview is valid for ten minutes. Changing the photo, photo type or language clears the preview and its confirmations. If the food, publishing account or public product changes, request and review a fresh preview. Preparing or cancelling a preview does not change Open Food Facts, and ordinary food saves, setting changes, diary entries and deletions never publish or queue contributions. There is no bulk contribution action or automatic retry in this release.

The photo is published first. If it succeeds but the structured data result cannot be confirmed, the result explicitly reports **Photo published; product data unconfirmed** with a link to inspect the public product. The data may already have been saved, for example when the response times out. The local food remains saved. Inspect the destination before starting a new contribution; an uncertain result is never retried automatically.

Submitted data is covered by the Open Food Facts Open Database License (ODbL) and Database Contents License; photos are published under CC BY-SA. Review the [Open Food Facts Contributor Terms](https://world.openfoodfacts.org/terms-of-use) before confirming a contribution. Existing food images and arbitrary image URLs are never reused automatically.

---

## Contributing Mock Data

We are constantly working to improve these integrations. If you notice data missing or incorrect, you can help by providing anonymized mock data.

Join the **CodeWithCJ** community on [Discord](https://discord.gg/vcnMT5cPEA) and reach out if you'd like to share your mock data to help us improve the sync logic!
