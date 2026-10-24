# GitHub Actions Workflows

This directory contains all GitHub Actions workflows for the SparkyFitness project.

## Workflows Overview

### CI/CD Workflows

#### `ci-tests.yml`

**Purpose**: Run automated tests for Frontend, Backend, Mobile, and Garmin components.

**Triggers**: Pull requests, pushes to `main`, and explicit dispatches from the
upstream review workflow

**What it does**:

- Detects which components changed using path filters
- Runs component-specific test suites:
  - **Frontend**: `pnpm run validate` + `pnpm run test:ci` (type check, lint, format, tests)
  - **Backend**: `pnpm run validate` + `pnpm run test:ci`
  - **Mobile**: Lint + `pnpm run test:ci`
  - **Garmin**: Python pytest with coverage
- Builds both production Docker images on relevant pull requests
- Uploads coverage reports as artifacts

---

#### `pr-validation.yml`

**Purpose**: Validate that PR submissions follow contribution guidelines and required checkboxes are checked.

**Triggers**: Pull request activity, submitted/dismissed reviews, and created/deleted review comments

**What it does**:

- Analyzes changed files to detect Frontend, Backend, Mobile, and UI changes
- Validates required checkboxes based on change type:
  - **All PRs**: Integrity & License checkbox
  - **New Features**: Alignment checkbox (issue approval)
  - **Frontend Changes**: Quality checkbox (`pnpm run validate`)
  - **Backend Changes**: Code Quality checkbox (TypeScript, Zod, Tests)
  - **UI Changes**: Screenshots checkbox with before/after images
- Posts validation results as a comment on the PR
- Fails the check if required checkboxes are missing
- Updates the same comment on subsequent edits (no spam)

Review events from forks have read-only tokens. They still validate the checklist and unresolved review conversations, with results in the job summary. Labels, checklist restoration, and the PR validation comment are updated only on `pull_request_target` events. Review runs cannot cancel those updates, and policy rules are always loaded from the PR base.

**Change Detection Logic**:

```javascript
hasFrontendChanges = files in SparkyFitnessFrontend/ or src/
hasBackendChanges = files in SparkyFitnessServer/
hasMobileChanges = files in SparkyFitnessMobile/
hasUIChanges = .tsx/.jsx/.css files in components/screens/pages/
```

**Validation Rules**:

- ❌ **ERRORS** (fail the check):
  - Missing "Integrity & License" checkbox (ALL)
  - Missing "Alignment" checkbox (NEW FEATURES)
  - Missing "Quality" checkbox (FRONTEND)
  - Missing "Code Quality" checkbox (BACKEND)
- ⚠️ **WARNINGS** (informational):
  - Missing "Screenshots" checkbox (UI)
  - Missing/incomplete screenshots sections
  - Missing description
  - Missing linked issue

**Important**: This workflow prevents contributors from removing checkboxes. If checkboxes are removed, the validation fails.

---

### Release Workflows

#### `release-please.yml`

**Purpose**: Derive the next version from Conventional Commits and draft the release.

**Triggers**: Pushes to `main`, and manual workflow dispatch

**What it does**:

- Keeps a `chore: release vX.Y.Z` PR open that bumps every version file (the workspace `package.json`s, `SparkyFitnessMobile/app.json`, `helm/chart/Chart.yaml`, `version.txt`) and `CHANGELOG.md`. The bump follows SemVer: `feat:` → minor, `fix:`/`perf:` → patch, `feat!:` or a `BREAKING CHANGE:` footer → major. Commits without a conventional prefix are ignored.
- Re-formats the JSON version files on the release PR branch with Prettier, since release-please writes them with plain `JSON.stringify`
- When the release PR is merged, creates a **draft** release and its tag, and replaces the body with `.github/release-preamble.md` + GitHub's generated notes (the same body `draft-release.yml` builds)

Nothing ships until a maintainer fills in the Key Highlights and publishes the draft. The `release: published` workflows below run on that publish, as before.

Config lives in `release-please-config.json`; the current version in `.release-please-manifest.json`. By default it runs with `GITHUB_TOKEN`, so CI does not run on the release PR. Set a `RELEASE_PLEASE_TOKEN` secret (PAT or GitHub App token with `contents` and `pull-requests` write) to get CI on it.

---

#### `draft-release.yml`

**Purpose**: Manually create a draft release for a version release-please does not produce, such as a four-segment hotfix (`v1.7.3.1`)

**Triggers**: Manual workflow dispatch (`tag`, optional `previous_tag` and `target`)

---

### Deployment Workflows

#### `unraid-cd.yml`

**Purpose**: Publish immutable fork images to GHCR and deploy them safely to an
Unraid server through an ephemeral Tailscale connection.

**Triggers**: Successful `CI Tests` runs on `main`, plus manual workflow dispatch

**Safety**:

- deployment is disabled unless `UNRAID_DEPLOY_ENABLED=true`
- no public SSH port or persistent self-hosted GitHub runner is required
- the server creates a pre-deployment PostgreSQL backup
- Compose health checks gate success and failed app updates roll back

See [`deploy/unraid/README.md`](../../deploy/unraid/README.md) for setup and
required GitHub variables/secrets.

---

#### `upstream-sync.yml`

**Purpose**: Keep this fork informed about new commits from
`CodeWithCJ/SparkyFitness` without changing production automatically.

**Triggers**: Daily at `04:23 UTC`, plus manual workflow dispatch

**One-time repository setting**: GitHub combines the ability for Actions to
create pull requests with the ability to approve reviews in one setting. Enable
`Settings → Actions → General → Allow GitHub Actions to create and approve pull
requests`. This workflow creates and updates draft pull requests but contains no
review approval, ready-for-review, merge, or direct `main` push operation.

**What it does**:

- Compares fork `main` with official upstream `main`
- Rebuilds a draft pull request on `automation/upstream-sync`
- Reports incoming commits, changed files, sensitive paths, and files changed
  independently in both repositories
- Marks migrations, authentication, Coach/Telegram/Speediance, mobile,
  deployment, workflow, and dependency changes for focused review
- Treats 20 commits, 50 files, or 1,500 changed lines as a large update
- Dispatches the existing code/container CI and documentation build explicitly
- Writes the full conflict report to the workflow summary and, when repository
  Issues are enabled, opens or updates a tracking issue instead of guessing

**Safety**:

- Never merges the pull request
- Never pushes to `main`
- Returns an updated pull request to draft status
- Production deployment remains gated on a reviewed merge and successful
  `main` CI

---

#### `auto-docker-deploy.yml`

**Purpose**: Automatically deploy Docker images on version tag pushes

**Triggers**: Push of tags matching `v*.*.*`

---

#### `manual-docker-deploy.yml`

**Purpose**: Manual Docker deployment workflow

**Triggers**: Manual workflow dispatch

---

#### `helm-release.yml`

**Purpose**: Create Helm chart releases

**Triggers**: Release publication

---

#### `umbrel-app-update.yml`

**Purpose**: Keep the [Umbrel App Store](https://github.com/getumbrel/umbrel-apps) package in `umbrel/sparkyfitness/` in step with releases.

**Triggers**: Completion of `Publish Docker Images` for an actual `release` event, and manual workflow dispatch (optional `version` input)

**What it does**:

- Runs `umbrel/update-package.mjs`, which re-pins the frontend, server, Garmin, and PostgreSQL images to their current multi-arch manifest-list digests and rewrites `version` and `releaseNotes` from the GitHub release body
- Lints the result against a fresh `getumbrel/umbrel-apps` checkout with `npm run lint:apps -- sparkyfitness --check-images`, in a separate, tokenless job — the App Store's own install/lint scripts never run in a job that can write to this repository
- Opens a PR here on `umbrel/update-app-package`

It runs after `Publish Docker Images` rather than on `release: published` because the package pins image digests, and those images do not exist until that workflow has pushed them. A `workflow_dispatch` re-run of `Publish Docker Images` (which rebuilds the current branch under the latest tag rather than a new release) is excluded, so a manual rebuild can't be mistaken for a new release.

Submitting to the App Store is a separate workflow (`umbrel-app-submit.yml`) that only runs once this PR is merged — that merge is the human review gate, not something this workflow bypasses by opening both PRs in the same run.

---

#### `umbrel-app-submit.yml`

**Purpose**: Carry an already-merged `umbrel/sparkyfitness/` change to the Umbrel App Store pull request.

**Triggers**: Push to `main` touching `umbrel/sparkyfitness/**` or `umbrel/update-package.mjs`, and manual workflow dispatch

**What it does**:

- Reads the version from the just-merged `umbrel-app.yml`
- Forks `getumbrel/umbrel-apps` on first run (polling until the fork is ready before pushing to it)
- Clones the upstream App Store and patches its **existing** copy of the package in place with `update-package.mjs --target`, touching only `version`, `releaseNotes`, and the pinned image lines — never replacing the whole directory, so anything the Umbrel team has since added (gallery images, an icon, a category change) survives
- Opens or reuses the App Store pull request

The initial App Store submission stays manual (see `umbrel/README.md`): `submission:` has to name a PR that doesn't exist yet, and the Umbrel team wants screenshots on it. This workflow only ever patches a package that already exists upstream, so it is a no-op until that first PR has been merged by the Umbrel team.

**Requires**: the `UMBREL_APPS_TOKEN` secret (a PAT with `public_repo` scope). Without it, the step is skipped with a warning.

---

### Documentation Workflows

#### `docs-test.yml`

**Purpose**: Test documentation builds on PRs

**Triggers**: Pull requests affecting `docs/` directory

---

#### `docs-deploy.yml`

**Purpose**: Deploy documentation to GitHub Pages

**Triggers**: Pushes to `main` affecting `docs/` directory

---

### Platform-Specific Workflows

#### `android.yml`

**Purpose**: Build the signed Android APK and AAB and attach them to the release

**Triggers**: Release publication, and manual workflow dispatch. A manual dispatch only attaches the APK and AAB when run against a release tag; from a branch it builds them without uploading. Not the `v*` tag push: `release-please.yml` creates the tag with the draft, before the release is approved.

---

#### `release-assets.yml`

**Purpose**: Create release assets for published releases

**Triggers**: Release publication

---

### Issue & PR Management Workflows

#### `issue-auto-label.yml`

**Purpose**: Automatically label newly opened or edited issues based on the issue template choices (e.g. `has-pr-volunteer`, `mobile`, `frontend`, `backend`).

**Triggers**: Issues (opened, edited)

---

#### `sync-translations.yml`

**Purpose**: Bidirectional sync with [SparkyFitnessTranslations](https://github.com/CodeWithCJ/SparkyFitnessTranslations), the repository Weblate is connected to. Pushes the English sources out and pulls every other language back, opening one PR on each side (`i18n/update-english-locales` there, `i18n/sync-weblate-translations` here).

Five Weblate components. The mobile app has four because its surfaces use different formats and placeholder rules (`{{value}}`, `%1$s`, `%@`), so Weblate translates each native file directly and no format conversion sits in between:

| Component | In the translations repo | In this repo |
| --- | --- | --- |
| Web | `locales/` | `SparkyFitnessFrontend/public/locales/` |
| Mobile runtime | `mobile/src/localization/locales/` | `SparkyFitnessMobile/src/localization/locales/` |
| Mobile Expo metadata | `mobile/locales/` | `SparkyFitnessMobile/locales/` |
| Mobile Android widgets | `mobile/targets/android-widget/res/` | `SparkyFitnessMobile/targets/android-widget/res/` |
| Mobile iOS widgets | `mobile/targets/widget/` | `SparkyFitnessMobile/targets/widget/` |

A mobile surface missing from the translations repo is skipped with a notice, so the workflow is safe to run before all the components exist; the push side seeds each English source on the first run. `pr-validation.yml` rejects a human PR that edits any non-`en` translation file.

Only locales listed in `SparkyFitnessMobile/src/localization/localeRegistry.json` are shipped on mobile. Others sync in as translation candidates, are reported by the i18n audit as non-blocking diagnostics, and are never bundled. The widget resources are the exception to "sync in": Android compiles every `values-*` directory and the iOS widget target ships every `.lproj` folder, so those two surfaces are pulled for registered locales only and a candidate's widget arrives on the sync after it is registered.

**Triggers**: Manual workflow dispatch only. Requires the `TRANSLATIONS_PAT` secret.

---

#### `auto-merge-bot-prs.yml`

**Purpose**: Automatically and safely merges clean automated PRs for Translations (`i18n/*`) and Nix hashes (`nix/*`) once all CI checks pass. If there are any merge conflicts, the PR is held untouched for manual review.

Umbrel package-update PRs (`umbrel/*`, from `umbrel-app-update.yml`) are **not** in the allowlist, deliberately: merging that PR is what triggers the App Store submission in `umbrel-app-submit.yml`, so it stays a manual review step. Add `'umbrel/'` to `ALLOWED_BRANCH_PREFIXES` and `'umbrel'` to `ALLOWED_LABELS` only if that gate should be removed.

Umbrel package PRs (`umbrel/*`) are **not** in the allowlist. Add `'umbrel/'` to `ALLOWED_BRANCH_PREFIXES` and `'umbrel'` to `ALLOWED_LABELS` if those should merge themselves too.

**Triggers**: Pull requests (opened, synchronize, labeled, ready_for_review), Check suites completed, and manual workflow dispatch

---

#### `first-contributor-welcome.yml`

**Purpose**: Greets first-time contributors with a warm, tailored welcome comment when they open their very first pull request, feature request, or issue.

**Triggers**: Issues opened, Pull requests opened

---

#### `pr-license-enforcement.yml`

**Purpose**: Sweeps open pull requests on a schedule and closes PRs where the mandatory Integrity & License agreement checkbox was not confirmed within the 7-day grace period.

**Triggers**: Scheduled (hourly) and manual workflow dispatch

---

#### `pr-merged-issue-notifier.yml`

**Purpose**: When a PR is merged, automatically replies to linked issues informing reporters that the fix or enhancement is completed and will be available in the upcoming release.

**Triggers**: Pull requests closed (`merged == true`)

---

#### `release-published-notifier.yml`

**Purpose**: When a new release is published, automatically comments on all issues resolved in that release announcing that the release is now live with links to the release notes.

**Triggers**: Release published (`published`)

---

## Development Notes

### Testing Workflows Locally

Run the PR validation regression tests with `pnpm install --filter . --frozen-lockfile --ignore-scripts` and `node --test .github/scripts/pr-validation.test.cjs`. The tests execute the workflow script with read-only review-event API fixtures and run in `pr-validation-tests.yml`.

You can test GitHub Actions locally using [act](https://github.com/nektos/act):

```bash
# Install act
brew install act  # macOS
# or
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash  # Linux

# Test PR validation workflow
act pull_request -e .github/workflows/test-event.json
```

### Modifying Workflows

When modifying workflows:

1. **Test before committing**: Use act or push to a feature branch
2. **Update this README**: Document any significant changes
3. **Check permissions**: Ensure the workflow has necessary permissions
4. **Validate YAML**: Use `yamllint` or GitHub's workflow syntax validator
5. **Consider impact**: Some workflows affect PR checks - be careful with breaking changes

### Common Issues

**Workflow not running:**

- Check trigger conditions (paths, branches, events)
- Verify workflow file is in `.github/workflows/`
- Check YAML syntax is valid

**Permission errors:**

- Add required permissions in workflow file
- Check repository settings allow Actions

**Path filters not working:**

- Use `dorny/paths-filter@v2` for complex path detection
- Test path patterns with actual file changes

## Maintenance

This document should be updated when:

- New workflows are added
- Existing workflows are significantly modified
- Trigger conditions change
- Validation rules change

Last updated: 2026-09-30
