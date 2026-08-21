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

---

## Contributing Mock Data

We are constantly working to improve these integrations. If you notice data missing or incorrect, you can help by providing anonymized mock data.

Join the **CodeWithCJ** community on [Discord](https://discord.gg/vcnMT5cPEA) and reach out if you'd like to share your mock data to help us improve the sync logic!
