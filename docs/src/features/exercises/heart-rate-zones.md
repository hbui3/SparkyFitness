# Heart Rate Zones

SparkyFitness splits heart rate into five zones. The same zones are used everywhere: the time-in-zone chart on a workout, the training load on Exercise Statistics, and the heart rate ranges suggested when you plan a run.

## Where to set them

- **Mobile:** Settings → Heart Rate Zones.
- **Web:** Settings → Profile & Account → Heart Rate Zones.

The screen shows your five zones with their bpm ranges, and where your max heart rate comes from:

| Shown as | Meaning |
| :--- | :--- |
| You set it | You entered a max heart rate. |
| From your date of birth | Worked out from your age with the Nes formula, 211 − 0.64 × age. |
| From the highest heart rate in the workout | No date of birth and no max set; used while splitting a single workout. |
| A typical value | Nothing to go on, so 190 bpm. Add your date of birth or set your own. |

On iPhone with iOS 27 or later, **Use Apple Health zones** reads the heart rate zones from Apple Health and fills them in as custom zones. It does not change your max heart rate. If resting heart rate is empty, it fills that from Apple Health too. Nothing is stored until you tap Save, and past workouts are not recalculated. The button is hidden on older iOS versions and on Android, because Apple only shares those zones with apps from iOS 27, and not as a normal Health sample.

A workout that Apple Health already split into zones keeps Apple's time in each zone, instead of being worked out again from your settings. That covers a workout recorded in the Fitness app, a run recorded on Apple Watch, a workout recorded in Sparky on the watch, and a phone GPS recording whose watch workout was saved. The chart matches the Fitness app, including time below the first boundary, which Apple counts as zone 1. Those workouts say the zones were set by the device. This needs iOS 27 or watchOS 27. Anything Apple did not split still uses your settings. Past workouts are not rewritten.

Max heart rate must be 100 to 250 bpm and resting heart rate 25 to 150 bpm. Leave max empty to go back to the date of birth estimate. **Reset to default** clears everything on the screen.

## Zone methods

| Method | Zone 1 to 5 start at |
| :--- | :--- |
| **% of max heart rate** (default) | 50, 60, 70, 80 and 90% of max heart rate. |
| **Heart rate reserve** (Karvonen) | Resting heart rate + 50, 60, 70, 80 and 90% of the gap between resting and max. Needs a resting heart rate. |
| **Custom zones** | The five bpm values you enter. Each zone must start above the one before it. |

If you pick a method that is missing what it needs (heart rate reserve with no resting heart rate), zones are shown as % of max heart rate and the screen says so.

Time below zone 1 is not counted in any zone.

## Which age formula is used

Everything uses the Nes formula (211 − 0.64 × age). It is the formula stored zones have always used, so zones for people who change nothing stay exactly as they were. Two places used other formulas before and now follow it: training load (220 − age) and suggested heart rate ranges for a planned run (Tanaka, 208 − 0.7 × age). Training load and suggested ranges can shift by a few bpm or a few load points for people who have not set their own max heart rate.

Suggested ranges for a planned run now come straight from your zones: warm-up and cool-down are zone 1, easy is zone 2 and fast is zone 4.

## What changing zones does to past workouts

Changing your zones does **not** rewrite past workouts. Time in zone is worked out when a workout is recorded or synced and stored with the zone boundaries and the method used, so history never shifts under you. New settings apply to:

- workouts you record or sync from now on;
- training load (which is calculated on demand from your current zones);
- suggested ranges for planned runs.

Zone charts say which method the workout's zones were worked out with ("Zones: Heart rate reserve…"). Workouts from a Garmin or other device that supplies its own zones say the zones were set by the device. Workouts stored before methods were recorded show no method.

## For developers

- Shared logic: `shared/src/utils/heartRateZones.ts`. `floorsFromAppleHeartRateZones` turns Apple's five preferred zones into custom floors (zone 1 with no lower bound starts at 30 bpm; any other count is ignored). The phone reads them with `modules/apple-heart-zones` on iOS 27. `bucketsFromAppleWorkoutZones` turns a finished workout's heart-rate zone group into stored rows (`zone_method` `device`) and keeps time below the first boundary as zone 1; the server uses that instead of `computeTimeInZones` when a sync or a watch post includes it. `resolveHeartRateZones` turns settings and date of birth into the five zones; `heartRateZoneRange(resolved, zone)` returns the bpm range of zone N (the top zone ends at max heart rate); `computeTimeInZones` buckets a heart rate series.
- API: `GET` / `PUT /api/v2/heart-rate-zones` (owner-only; contract in `shared/src/schemas/api/HeartRateZones.api.zod.ts`).
- Storage: `max_heart_rate`, `resting_heart_rate`, `hr_zone_method`, `hr_zone_custom_floors` on `user_preferences`; `zone_method` on `exercise_entry_hr_zones`.
