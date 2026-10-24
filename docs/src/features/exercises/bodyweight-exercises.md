# Bodyweight Exercises

Pull-ups, dips, push-ups and similar movements move your own body. SparkyFitness has a **Bodyweight (+/− weight)** set type for them, so a weighted or assisted set is logged as what it is and counts correctly in your stats.

## Marking an exercise as bodyweight

Pick **Bodyweight (+/− weight)** as the set type when you create or edit an exercise, on the web or in the mobile app. Exercises imported from the exercise databases whose only equipment is "body only" start with this set type already selected. You can change it at any time.

## Logging sets

Each set has reps and a signed weight:

| You did | Enter as weight |
| :--- | :--- |
| Plain pull-ups | Leave it blank (or 0) |
| Dips with a 20 kg belt | `+20` or `20` |
| Pull-ups on a band or machine taking off 30 kg | `-30` |

The diary shows a weighted set as `+20` so it reads as a change to your body weight. In the mobile app the weight field's keyboard includes a minus sign for these exercises.

## How volume and estimated 1RM are counted

The load a bodyweight set moves is your body weight plus the set's weight:

- At 80 kg, a +20 kg dip moves **100 kg** and a −30 kg assisted pull-up moves **50 kg**.
- Volume is that load × reps. Estimated 1RM (Epley) and weight PRs use the same load.
- Your body weight is the latest check-in weight on or before the workout day, or the earliest one after it if you had not weighed in yet.
- With no body weight recorded at all, only the added weight counts, and an assisted set adds nothing rather than a negative number.

Live PRs in the mobile app compare the added weight, and then reps, against your earlier sessions. An unweighted set counts as +0, so beating your best rep count on plain pull-ups is a PR.

## Limitations

- On the Apple Watch a bodyweight exercise shows its weight as `BW +10` (added), `BW −20` (assisted) or just `BW`. The weight keypad has a ± key for entering an assisted set. The watch learns an exercise is a bodyweight one when the workout starts, so start the workout from a phone build that includes this.
