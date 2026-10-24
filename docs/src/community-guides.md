# Community Guides

This section highlights community-contributed guides and resources for SparkyFitness. These guides are created by users like you to share knowledge, tips, and best practices.

## How to Contribute or Find Guides

If you have a guide you'd like to share, or if you're looking for specific community-driven content, here's how you can engage:

*   **Share your knowledge**: Write a guide and share it with the community. You can submit it as a pull request to the documentation repository.
*   **Join our Discord**: Engage with other community members, ask questions, and find answers in our Discord server. Many community guides and tips are shared there informally.
*   **GitHub Discussions**: Check the GitHub Discussions for ongoing conversations, shared solutions, and requests for new guides.
*   **Contribute to the documentation**: If you see a gap in the documentation or have a guide that would benefit others, consider contributing directly to this documentation site.

## Community Integrations

Standalone tools built by the community that work alongside SparkyFitness. They are **not** part of SparkyFitness, are not maintained by this project, and are not covered by its support — run them at your own discretion. Listing a tool here is not an official endorsement by SparkyFitness.

### Cronometer

[`cronometer-core`](https://github.com/johnkattenhorn/cronometer-core) — a read-only Cronometer client (Python CLI plus an MCP server) that pulls your own daily nutrition totals and biometrics from [cronometer.com](https://cronometer.com).

Run it on a schedule alongside SparkyFitness if you want your Cronometer history available outside the Cronometer app. It uses your ordinary cronometer.com login rather than an API key, because Cronometer publishes no public API — so it depends on an unofficial path that Cronometer may change or block at any time. It is deliberately kept as an independent script rather than a built-in provider ([#2159](https://github.com/CodeWithCJ/SparkyFitness/issues/2159)).

One limitation worth knowing before you try it, observed on a free-tier account: the `servings` export lists per-food rows (`Day,Time,Group,Food Name,Amount,Category`) with no nutrient columns, while only the `dailySummary` export carries the numbers, one row per day. On that path it is a daily-totals source, not a food-diary import. Paid tiers were not tested.

### RENPHO smart tape measure and scale

[`renpho-bridge`](https://github.com/Jerrys-modz/renpho-bridge) — a small Docker container that reads your own measurements from the RENPHO cloud and sends them to SparkyFitness through the existing `POST /api/health-data` endpoint with an API key. It was built after the integration proposal in [#2664](https://github.com/CodeWithCJ/SparkyFitness/issues/2664) and is deliberately kept outside SparkyFitness.

It syncs smart tape measure readings (neck, waist and hip as check-in fields; chest, arms, thighs and the other sites as custom measurements) and smart scale readings (weight, body fat, body water, BMR, muscle and bone mass as check-in fields; extras such as visceral fat as custom measurements). Like the mobile app it does one full-history sync, then re-sends the last few days on every run (`SYNC_DAYS`, default 3). A test mode prints what would be sent without touching SparkyFitness, and a prebuilt multi-arch image is published to `ghcr.io/jerrys-modz/renpho-bridge`.

RENPHO has no public API. The tool talks to the same cloud endpoints as the RENPHO app, using the protocol documented by the MIT-licensed [`renpho-api`](https://github.com/danvaneijck/renpho-api) client, so it may break if RENPHO changes its API and use may be restricted by RENPHO's terms. Because each RENPHO login can sign the phone app out, the tool saves and reuses its session token, but you may still be signed out of the app occasionally; syncing once or twice a day keeps this to a minimum.

### Samsung Health import

You can import sleep and weight data from Samsung Health using the command line and the scripts from [this repository](https://codeberg.org/giggio/sparky_fitness_convert).

First export the data from the Samsung Health app (Settings > Download personal data) then use the 2 files referenced in the repository to import.
