# Interval, Circuit & WOD Workouts

SparkyFitness provides a comprehensive workout engine designed for both traditional strength training and high-intensity interval conditioning. Whether you are running a classic weightlifting split, a high-cadence **Tabata** cycle, an **EMOM** challenge, or a competitive **CrossFit-style WOD** (AMRAP / For Time), SparkyFitness keeps you on pace with real-time HUD clocks, audio countdowns, and automated set logging.

---

## Overview of Workout Formats

When creating a workout preset or starting an active session, you can choose from six specialized workout formats:

| Format | Focus / Style | Timer & Clock Behavior | Scoring & Logging |
| :--- | :--- | :--- | :--- |
| **Standard** | Traditional hypertrophy, powerlifting, bodybuilding | Stopwatch counting up (elapsed time) | Sets, reps, weight, RPE, rest timers between sets |
| **Tabata** | High-intensity interval rounds (e.g. 20s work / 10s rest) | Work/Rest interval clock with 3-2-1 countdown beeps | Automatic set completion at the end of each work interval |
| **EMOM** | Every Minute On the Minute | Repeating 60s (or custom) clock with start chimes | Work inside the minute; rest the remainder; tracks rounds |
| **AMRAP** | As Many Rounds/Reps As Possible within a fixed time cap | Global countdown clock down to `00:00` | Completed rounds + extra reps, Rx / Scaled status |
| **For Time** | Complete prescribed work as quickly as possible | Elapsed stopwatch counting up to an optional time cap | Finish time, time cap reached status, Rx / Scaled status |
| **Custom Interval / HIIT** | Custom intervals with unique work/rest targets per exercise | Dynamic multi-step interval clock with custom timers | Step-by-step automated set progression and completion |

---

## Straight Sets vs. Circuit & Multi-Round Training

Understanding the difference between **Straight Sets** and **Circuit / Multi-Round Training** helps ensure your workout presets and active HUD track exactly as intended:

```
STRAIGHT SETS (Standard Strength)
Exercise A: Set 1  ──>  Set 2  ──>  Set 3
                          │ (Complete all sets of A first)
                          ▼
Exercise B: Set 1  ──>  Set 2  ──>  Set 3

─────────────────────────────────────────────────────────────

CIRCUIT / MULTI-ROUND (Tabata, EMOM, HIIT)
Round 1: Exercise A (Set 1)  ──>  Exercise B (Set 1)  ──>  Exercise C (Set 1)
                                                                │
Round 2: Exercise A (Set 2)  ──>  Exercise B (Set 2)  ──>  Exercise C (Set 2)
                                                                │
Round 3: Exercise A (Set 3)  ──>  Exercise B (Set 3)  ──>  Exercise C (Set 3)
```

### 1. Straight Sets (Single Exercise Focus)
In straight sets, you perform all assigned sets for a single movement before moving on to the next exercise (e.g. 3 sets of Bench Press, followed by 3 sets of Incline Dumbbell Press).
* Best suited for: **Standard** workouts.
* Logging behavior: You log weight and reps for Set 1, rest, log Set 2, rest, and complete the exercise before advancing.

### 2. Circuit & Multi-Round (Tabata, EMOM & HIIT)
In a circuit, you perform one set of each exercise in succession to complete a "Round", then repeat the entire cycle for the prescribed number of rounds.
* Best suited for: **Tabata**, **EMOM**, **AMRAP**, **For Time**, and **Custom Interval / HIIT**.
* Logging behavior: The interval HUD steps through each exercise in Round 1 (e.g. Pull-ups $\rightarrow$ Push-ups $\rightarrow$ Squats), then seamlessly transitions to Round 2 (Pull-ups $\rightarrow$ Push-ups $\rightarrow$ Squats) until all rounds are finished.

---

## Active Workout HUD & Audio Engine

When you launch an interval workout on Web or Mobile, SparkyFitness activates the **Active Interval HUD**:

```
┌────────────────────────────────────────────────────────┐
│  TABATA 20/10                  ROUND 2 OF 8 (STEP 1/3) │
│                                                        │
│                    WORK PHASE                          │
│                                                        │
│                     00:16                              │
│                                                        │
│       Current: Pull-ups (Bodyweight x 10 reps)         │
│       Next: Push-ups (Bodyweight x 15 reps)            │
│                                                        │
│    [ ◀ Prev ]      [ ⏸ Pause / ▶ Resume ]     [ Next ▶ ]│
└────────────────────────────────────────────────────────┘
```

### Key HUD Features

1. **Phase Color Coding**:
   - 🟢 **Work Phase (Green)**: High-intensity effort interval. Focus on executing repetitions with clean form.
   - 🔵 **Rest Phase (Blue)**: Rest and recovery interval. Catch your breath and prepare for the upcoming exercise.
   - 🟡 **Preparation / Transition (Yellow)**: Initial countdown before the first round begins.
2. **Audio & Haptic Cues**:
   - **3-2-1 Countdown**: Short audio warning beeps play during the final 3 seconds of any work or rest interval.
   - **Phase Transition Chime**: A distinct higher-frequency chime sounds the moment a new phase begins.
   - **Workout Finish**: A celebratory finish alert plays when all rounds and sets are completed.
3. **Zero-Drift Timer Clock**:
   - The workout clock is synchronized with absolute wall-clock timestamps (`performance.now()` and epoch timestamps).
   - If your phone screen sleeps, locks, or you switch apps, the clock **does not drift or freeze**. When you reopen the app, the timer instantly resumes at the exact second.

---

## Automated Set Completion

To keep your hands free during high-intensity sessions, SparkyFitness features **Smart Auto-Completion**:

* **How it Works**: When the countdown timer for a **Work Phase** reaches `00:00`, the active set is automatically marked as **Completed** in your session draft.
* **Preserved Metrics**: The target reps, weight, or distance prescribed in your preset are preserved.
* **On-the-Fly Adjustments**: You can tap any completed set at any time during or after the workout to adjust the actual reps performed, add extra weight, or mark a set as incomplete if needed.

---

## WOD Formats: AMRAP & For Time

CrossFit and functional fitness workouts require specialized scoring parameters. SparkyFitness provides native support for **AMRAP** and **For Time** modalities.

### AMRAP (As Many Rounds / Reps As Possible)

* **Goal**: Complete as many rounds and reps of the prescribed movement circuit within a strict time limit (e.g., *20-Minute AMRAP: 5 Pull-ups, 10 Push-ups, 15 Air Squats*).
* **Clock**: A global countdown clock runs down from the time cap to zero.
* **Fast Round Logging**: A prominent `+1 Round` button allows you to tap each time you finish a full circuit without navigating between individual exercise rows.
* **Scoring Metric**: Recorded as `Rounds + Extra Reps` (e.g., `8 Rounds + 12 Reps`).

### For Time

* **Goal**: Complete all prescribed exercises and rep schemes as fast as possible (e.g., *Fran: 21-15-9 Thrusters and Pull-ups*).
* **Clock**: An elapsed stopwatch counts upward from `00:00`.
* **Optional Time Cap**: If a time cap is configured (e.g. 15 minutes) and you do not finish before time expires, the workout is scored as **Time Capped (CAP)** with remaining reps noted.
* **Scoring Metric**: Recorded as total finish time (e.g., `07:42`).

---

## Rx vs. Scaled Scoring & Scaling Notes

Every WOD workout can be logged with competition-standard division tracking:

* **Rx (As Prescribed)**: Selected when all exercises were completed exactly as written (prescribed weights, official movement standards, and no modifications).
* **Scaled**: Selected if weights were reduced, movements were substituted (e.g., jumping pull-ups or ring rows instead of bar muscle-ups), or reps were altered.
* **Scaling Notes**: When logging a Scaled score, you can record custom notes detailing exactly what was modified (e.g., *Used 40kg barbell instead of 60kg; subbed knee push-ups*).

### Diary & History Badges

Completed interval and WOD sessions display high-visibility badges in your Daily Exercise Diary and history feeds:

* `AMRAP 20:00` • **14 + 5 Rx**
* `For Time` • **08:14 Scaled**
* `Tabata` • **8 Rounds Completed**

---

## Creating & Scheduling Interval Presets

To create an interval workout preset:

1. Navigate to **Exercises** $\rightarrow$ **Workout Presets** in the web or mobile app.
2. Click **Create Preset**.
3. Select your desired **Format** from the dropdown (*Tabata, EMOM, AMRAP, For Time, Custom Interval, or Standard*).
4. Configure the format parameters:
   - **Rounds**: Total number of circuit iterations (e.g., 8 rounds for Tabata).
   - **Work Time (seconds)**: Duration of high-intensity effort per interval.
   - **Rest Time (seconds)**: Duration of recovery between intervals.
   - **Time Cap (minutes)**: Global time limit (for AMRAP and For Time).
5. Add your exercises and target reps / weights.
6. Save the preset. You can now launch it directly from the preset menu or schedule it into your sequential or weekly **Workout Plan**. The AI assistant and MCP tools can also create format presets, inspect timers, and record WOD scores directly.
