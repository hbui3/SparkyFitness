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
- Speediance (unofficial API; completed workout import)
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

---

## Contributing Mock Data

We are constantly working to improve these integrations. If you notice data missing or incorrect, you can help by providing anonymized mock data.

Join the **CodeWithCJ** community on [Discord](https://discord.gg/vcnMT5cPEA) and reach out if you'd like to share your mock data to help us improve the sync logic!
