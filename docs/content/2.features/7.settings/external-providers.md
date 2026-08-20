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

The AI coach can also search the connected account's real Gym Monster exercise
library, create a repetition-based custom workout with Speediance's **Gain
Muscle** preset, and reserve it for a calendar day after the owner explicitly
asks it to do so. Exercise group, variant, title, accessory requirements, and
set configuration are verified against Speediance before and after the write.
An identically named workout is reused only when its complete exercise and set
content matches; ambiguous or conflicting remote state is not overwritten.
Before proposing or scheduling the next workout, the coach reads the owner's
recent structured workout feedback and active training preferences. It can use
bounded volume/rest guidance and preferred exercises, while an exercise marked
as avoided is blocked at the Speediance write boundary unless the owner
explicitly overrides that exact preference.

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
