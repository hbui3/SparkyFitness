# SparkyFitness auf Unraid: CI/CD

Dieser Stack baut Frontend und Server nach einem erfolgreichen `CI Tests`-Lauf
auf GitHub, veröffentlicht unveränderliche Images in GHCR und aktualisiert
Unraid über eine kurzlebige Tailscale-Verbindung. Unraid benötigt keinen
öffentlich erreichbaren SSH-Port und keinen dauerhaft laufenden GitHub Runner.

## Ablauf

1. Pull Requests führen Tests und Produktions-Builds aus.
2. Ein erfolgreicher CI-Lauf auf `main` startet `unraid-cd.yml`.
3. GitHub baut `linux/amd64`-Images, veröffentlicht Tags und signierte
   Provenance und gibt exakte Image-Digests an das Deployment weiter.
4. Ein kurzlebiger GitHub-Runner tritt dem Tailnet als `tag:ci` bei.
5. Unraid erstellt vor dem Update einen PostgreSQL-Dump, zieht die exakten
   Digests und wartet auf alle Container-Healthchecks.
6. Bei einem Fehler werden die vorherigen App-Images wieder gestartet. Ein
   Datenbank-Rollback erfolgt absichtlich nie automatisch.

## 1. Unraid und Tailscale vorbereiten

Die Automatisierung setzt Unraid 7 oder neuer, Docker Compose und das offizielle
Tailscale-Plugin voraus.

1. Installiere in Unraid unter **Apps** das offizielle Tailscale-Plugin.
2. Verbinde Unraid mit deinem Tailnet und aktiviere **Tailscale SSH**.
3. Weise der Unraid-Maschine in der Tailscale-Adminoberfläche `tag:unraid` zu.
4. Erstelle einen OAuth Client mit `Auth Keys: Write` und ausschließlich
   `tag:ci`. Kopiere Client-ID und Secret sofort an einen sicheren Ort.
5. Erlaube nur dem CI-Tag SSH als `root` auf den Unraid-Tag. Ergänze deine
   bestehende Tailnet Policy sinngemäß um folgende Einträge; überschreibe dabei
   keine bereits vorhandenen Regeln:

```json
{
  "tagOwners": {
    "tag:ci": ["autogroup:admin"],
    "tag:unraid": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:ci"],
      "dst": ["tag:unraid"],
      "ip": ["tcp:22"]
    }
  ],
  "ssh": [
    {
      "action": "accept",
      "src": ["tag:ci"],
      "dst": ["tag:unraid"],
      "users": ["root"]
    }
  ]
}
```

Tagged Geräte dürfen per Tailscale SSH nur andere tagged Geräte erreichen.
Deshalb sind sowohl `tag:ci` als auch `tag:unraid` erforderlich.

## 2. Einmaliges Bootstrap auf Unraid

Öffne das Unraid-Terminal und lade die vier öffentlichen Deployment-Dateien:

```bash
mkdir -p /mnt/user/appdata/sparkyfitness/deployment
cd /mnt/user/appdata/sparkyfitness/deployment
curl -fsSLO https://raw.githubusercontent.com/hbui3/SparkyFitness/main/deploy/unraid/compose.yml
curl -fsSLO https://raw.githubusercontent.com/hbui3/SparkyFitness/main/deploy/unraid/.env.example
curl -fsSLO https://raw.githubusercontent.com/hbui3/SparkyFitness/main/deploy/unraid/bootstrap.sh
curl -fsSLO https://raw.githubusercontent.com/hbui3/SparkyFitness/main/deploy/unraid/deploy.sh
chmod 700 bootstrap.sh deploy.sh
```

Erzeuge anschließend die lokale `.env`. Verwende die URL, über die Browser und
iOS-App SparkyFitness tatsächlich erreichen. Die Datei wird nicht überschrieben
und enthält zufällig erzeugte Datenbank-, Verschlüsselungs- und Auth-Secrets.

```bash
./bootstrap.sh https://fitness.example.com deine-mail@example.com
```

Für einen reinen Tailnet-Zugriff kann die URL beispielsweise
`http://tower.dein-tailnet.ts.net:3004` sein. Prüfe danach `.env`, ohne die
stabilen Secrets zu verändern. Nach Erstellung des ersten Kontos sollte
`SPARKY_FITNESS_DISABLE_SIGNUP=true` gesetzt werden.

### Telegram-Coach aktivieren

Telegram nutzt denselben öffentlichen HTTPS-Endpunkt wie die Web-App; am
Reverse Proxy ist deshalb **kein weiterer Port** nötig. `/api/telegram/webhook`
wird über den bestehenden SparkyFitness-Port `3004` an den Server geleitet.

1. Öffne in Telegram `@BotFather`, führe `/newbot` aus und bewahre den Bot-Token
   sicher auf.
2. Öffne SparkyFitness als Administrator und gehe zu **Administration →
   Telegram-Coach**.
3. Füge dort den BotFather-Token ein und wähle **Token prüfen und speichern**.

SparkyFitness prüft den Token direkt bei Telegram, erzeugt selbst einen
Webhook-Schlüssel und speichert beide Werte mit
`SPARKY_FITNESS_API_ENCRYPTION_KEY` verschlüsselt in der Datenbank. Der Token
wird danach weder in der Oberfläche angezeigt noch durch die API
zurückgegeben. Ein Server-Neustart oder ein neues Container-Image verliert die
Konfiguration nicht.

Die folgenden `.env`-Werte sind nur noch ein optionaler Fallback für
Installationen, die Telegram nicht über die Admin-Oberfläche konfigurieren
möchten:

```dotenv
SPARKY_FITNESS_TELEGRAM_BOT_TOKEN=<BotFather-Token>
SPARKY_FITNESS_TELEGRAM_WEBHOOK_SECRET=<zufälliger geheimer Wert>
SPARKY_FITNESS_TELEGRAM_WEBHOOK_URL=https://sparky.wunderspiele.ch/api/telegram/webhook
```

Einen Fallback-Webhook-Schlüssel kannst du direkt auf Unraid mit
`openssl rand -hex 32` erzeugen. Nach Änderungen an `.env` muss mindestens der
Server neu gestartet werden:

```bash
cd /mnt/user/appdata/sparkyfitness/deployment
docker compose --env-file .env -f compose.yml up -d sparkyfitness-server
```

Unter **Einstellungen → Nutrition & Diet → AI Coach Profile** erzeugt
**Telegram verbinden** danach einen 15 Minuten gültigen Einmal-Link. Antworten
im privaten Telegram-Chat laufen durch denselben konfigurierten KI-Anbieter und
landen im selben privaten Sparky-Chatverlauf. `/stop` trennt die Verbindung.

## 3. GitHub konfigurieren

Lege im Repository das Environment `unraid-production` an und speichere darin:

| Typ      | Name                    | Inhalt                                       |
| -------- | ----------------------- | -------------------------------------------- |
| Secret   | `TS_OAUTH_CLIENT_ID`    | ID des auf `tag:ci` begrenzten OAuth Clients |
| Secret   | `TS_OAUTH_SECRET`       | Secret dieses OAuth Clients                  |
| Variable | `UNRAID_TAILSCALE_HOST` | Tailscale-IP oder MagicDNS-Name von Unraid   |
| Variable | `UNRAID_DEPLOY_PATH`    | `/mnt/user/appdata/sparkyfitness/deployment` |

Lege zusätzlich auf **Repository-Ebene** die Variable
`UNRAID_DEPLOY_ENABLED=false` an. Die Job-Bedingung wird ausgewertet, bevor
GitHub Environment-Variablen lädt; der zentrale Deployment-Schalter muss daher
absichtlich eine Repository-Variable sein. Stelle ihn erst nach abgeschlossenem
Bootstrap auf `true`.

`UNRAID_DEPLOY_ENABLED=false` lässt Builds und GHCR-Veröffentlichungen laufen,
überspringt aber das Deployment. So kann die Pipeline gefahrlos vor den
Zugangsdaten gemergt werden.

## 4. Erstes Deployment und Betrieb

Nach dem Umschalten von `UNRAID_DEPLOY_ENABLED` auf `true` starte unter
**Actions → Publish and Deploy to Unraid → Run workflow** einen manuellen Lauf.
Danach genügt jeder erfolgreich getestete Merge nach `main`.

Die Web-App läuft standardmäßig auf Port `3004`. PostgreSQL wird nicht am Host
veröffentlicht. Persistente Daten liegen unter:

- `/mnt/user/appdata/sparkyfitness/postgresql`
- `/mnt/user/appdata/sparkyfitness/uploads`
- `/mnt/user/appdata/sparkyfitness/backup`
- `/mnt/user/appdata/sparkyfitness/predeploy-backups`

Das oberste `postgresql`-Mount erhält entsprechend dem offiziellen
PostgreSQL-18-Alpine-Image den Sticky-Modus `1777`, damit der unprivilegierte
Containerbenutzer sein versionsbezogenes Datenverzeichnis initialisieren kann.
Das eigentliche Datenverzeichnis darunter bleibt ausschließlich für PostgreSQL
zugänglich.

Hilfreiche Befehle auf Unraid:

```bash
cd /mnt/user/appdata/sparkyfitness/deployment
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs -f --tail 200
```

Für einen manuellen App-Rollback liegt die vorige Konfiguration in
`.env.previous`. Kopiere sie nur dann zurück, wenn du den konkreten
Deployment-Fehler geprüft hast. Datenbank-Backups werden bewusst separat
behandelt, da ihre Wiederherstellung vorhandene Daten überschreibt.

## Sicherheitsgrenzen

- App-Secrets und Gesundheitsdaten bleiben auf Unraid; GitHub erhält sie nicht.
- Der kurzlebige GHCR-Token wird nach jedem Deployment von Unraid entfernt.
- Nur erfolgreiche CI-Läufe auf `main` deployen automatisch.
- Das Deployment verwendet exakte Image-Digests statt veränderlicher Tags.
- Der Tailscale OAuth Client darf nur kurzlebige Geräte mit `tag:ci` erzeugen.
- `UNRAID_DEPLOY_ENABLED` ist der zentrale Not-Aus für automatische Deployments.

Weiterführend: [Unraid Tailscale](https://docs.unraid.net/unraid-os/system-administration/secure-your-server/tailscale/),
[Tailscale GitHub Action](https://github.com/tailscale/github-action),
[GitHub Container Registry](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
