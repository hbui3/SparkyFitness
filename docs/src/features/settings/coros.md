# COROS Integration

The COROS integration allows you to sync workouts, sports telemetry, and activity sessions from your COROS account directly to SparkyFitness using the official **COROS Model Context Protocol (MCP)** over OAuth 2.0.

---

## Overview

Unlike traditional API integrations that require manual developer account approval or API keys, SparkyFitness connects directly to COROS's official MCP server using **Dynamic Client Registration (DCR)** and **PKCE S256 OAuth 2.0**.

* **Zero API Keys Required:** No developer portal registration or client secret management is needed.
* **Full Telemetry Ingest:** Downloads raw binary `.fit` activity files to parse full GPS tracks, heart rate zones, cadence, elevation, power, and laps.
* **Smart Budget & Fallback:** Seamlessly falls back to structured activity summaries if daily download quotas are reached.

---

## Setup & Connection

Connecting your COROS account is simple:

1. In SparkyFitness, navigate to **Settings → External Providers**.
2. Click **Add Provider** and select **COROS**.
3. Choose your regional MCP server:
   * **Global / US (Default):** `https://mcpus.coros.com/mcp`
   * **Europe:** `https://mcpeu.coros.com/mcp`
   * **China:** `https://mcpcn.coros.com/mcp`
4. Click **Save & Connect**.
5. You will be redirected to the official COROS authorization page. Sign in with your COROS credentials and authorize SparkyFitness.
6. Once authorized, you will be redirected back to SparkyFitness and your account will show as **Connected**.

> [!TIP]
> **Self-Hosted Instances**: COROS OAuth requires your instance URL (`SPARKY_FITNESS_FRONTEND_URL`) to use **HTTPS** (or `http://localhost` for local development). If your server is behind a reverse proxy, ensure SSL/TLS is properly configured.

---

## Data Synchronized

### 1. Workouts & Sports Telemetry (FIT Ingest)
When an activity is synced, SparkyFitness downloads the activity's native `.fit` file from COROS and extracts:
* **Core Metrics:** Duration, distance, active calories burned, average heart rate, and max heart rate.
* **Sport Classification:** Running (Outdoor, Trail, Track, Treadmill), Cycling (Road, Indoor), Swimming, Strength Training, Walking, Hiking, Rowing, Skiing, and more.
* **Lap & Interval Breakdowns:** Lap splits, average pace per lap, elevation gain/loss, and cadence.
* **GPS Route & Heart Rate Zones:** Detailed telemetry for route maps and workout charts.

### 2. Summary Fallback
If an activity FIT file is unavailable or if the daily FIT download quota is reached, SparkyFitness parses the COROS activity summary report, ensuring your exercise diary duration, distance, calories, and sport type are logged without interruption.

---

## Syncing Data

### Automatic Background Sync
SparkyFitness runs a background sync job every hour to automatically import new workouts logged on your COROS watch or app.

### Manual Range Sync
You can backfill or manually trigger a sync at any time:
1. Go to **Settings → External Providers**.
2. Click the **Sync** button on your COROS provider card.
3. Select your desired date range (e.g., past 30 days, past year, or a custom range).
4. Click **Sync Now**. SparkyFitness will automatically chunk large date ranges into 90-day requests and import all activities.

---

## Quotas & Rate Limits

> [!IMPORTANT]
> **Daily FIT File Quota**:
> COROS enforces a rate limit of **50 FIT file downloads per day** per user account (SparkyFitness uses a conservative safety buffer of 45).
> 
> * If you sync more than 45 activities in a single 24-hour period, SparkyFitness will download FIT files for the first 45 activities and automatically **defer** remaining activities to subsequent syncs to preserve full telemetry.
> * The next sync will continue downloading and importing remaining activities.

---

## Contributing & Diagnostics

If you encounter an unsupported sport type or format, you can share diagnostic data to help improve the integration:
1. An administrator can enable **Allow Local Provider Response Capture** in **Admin → Global Provider Settings**.
2. Open the **Sync Range** dialog on your COROS provider card and select **Sync and save this sync's raw responses to a file on the server**.
3. After syncing, the server saves the raw bundle to `SparkyFitnessServer/mock_data/coros_mcp_raw.json`. You can redact sensitive GPS coordinates and share it with the **CodeWithCJ** community on [Discord](https://discord.gg/vcnMT5cPEA) to help add new metrics!
