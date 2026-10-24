# Umbrel Installation Guide

SparkyFitness is packaged for [umbrelOS](https://umbrel.com/umbrelos) as an App
Store app. The package lives in this repository under
[`umbrel/sparkyfitness/`](https://github.com/CodeWithCJ/SparkyFitness/tree/main/umbrel/sparkyfitness)
and is submitted to the [Umbrel App Store](https://github.com/getumbrel/umbrel-apps).

## Install

Open the App Store on your Umbrel, search for **SparkyFitness**, and install it.
No configuration is required: Umbrel generates the database password, API
encryption key, and session secret for you and keeps them stable across
restarts, updates, and backups.

Once it starts, open the app and create an account. **The first account you
create becomes the administrator**, so make yours before sharing the app with
anyone else.

## What Umbrel manages for you

| Setting | Value on Umbrel |
| --- | --- |
| App URL | `http://umbrel.local:3019` (also reachable over `https://`) |
| Database | Bundled PostgreSQL 18, no setup needed |
| Secrets | Derived from the device seed; never regenerated |
| Data | `~/umbrel/app-data/sparkyfitness/data/` (database, uploads, backups) |
| Backups | Included in Umbrel's own backups |

Because secrets are derived from the device seed rather than generated at each
boot, sessions and stored two-factor secrets survive restarts and updates. See
[Environment Variables](/install/environment-variables) for what each of these
settings does.

## Access

SparkyFitness manages its own accounts and two-factor authentication, so this
package turns Umbrel's login screen **off** for the whole app
(`PROXY_AUTH_ADD: "false"`) rather than layering the two. Anyone who can reach
your Umbrel on port 3019 reaches the SparkyFitness sign-in page directly, the
same as any other deployment of SparkyFitness — Umbrel's device password is not
a second gate in front of it.

This is a deliberate trade-off, not an oversight: Umbrel's login is
single-owner, so a partner or family member signing in with their own
SparkyFitness account would otherwise have to share your Umbrel device
password, or be locked out entirely. Use SparkyFitness's own login, and its 2FA
setting in your account settings, to control who can sign in.

`/uploads` is served as static files ahead of SparkyFitness's own auth
middleware on every deployment, not something specific to Umbrel — anyone who
knows an upload's URL can fetch it without signing in at all. Check-in photos
and pregnancy uploads are the exception; those subtrees are blocked outright.

### Connecting the mobile app

Use **`https://umbrel.local:3019`**, or `https://<your-Umbrel-LAN-IP>:3019`.

Release builds of the mobile app reject a plain-HTTP server, because HTTPS is
required to register passkeys, use the camera, and satisfy Apple Health and
Health Connect policy. umbrelOS serves every app port over both HTTP and TLS, so
the HTTPS URL works on the same port — but the certificate comes from Umbrel's
own local authority, so your phone will not trust it until you install and trust
that certificate.

## Limitations

- Garmin Connect sync for accounts registered in the China region is not
  supported, since `GARMIN_SERVICE_IS_CN` is not exposed as an install option.
- Email and outbound proxy settings are not exposed as Umbrel install options.
  If you need them, use the [Docker Compose](/install/docker-compose)
  deployment instead. OIDC single sign-on does not have this limitation — it is
  configured from within the app's own admin settings, not through environment
  variables, so it works on Umbrel the same as anywhere else.
