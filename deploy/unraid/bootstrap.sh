#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_TEMPLATE="${SCRIPT_DIR}/.env.example"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yml"

usage() {
  cat <<'USAGE'
Usage: ./bootstrap.sh <frontend-url> [admin-email]

Examples:
  ./bootstrap.sh http://tower.local:3004 me@example.com
  ./bootstrap.sh https://fitness.example.com me@example.com

The script creates a new .env with random credentials. It never overwrites an
existing .env because the encryption and authentication secrets must remain
stable for the lifetime of the installation.
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

set_env_value() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"

  awk -v key="${key}" -v value="${value}" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) {
        print key "=" value
      }
    }
  ' "${ENV_FILE}" > "${temporary}"

  chmod 600 "${temporary}"
  mv -f "${temporary}" "${ENV_FILE}"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ $# -ge 1 && $# -le 2 ]] || {
  usage >&2
  exit 2
}

FRONTEND_URL="$1"
ADMIN_EMAIL="${2:-}"

[[ "${FRONTEND_URL}" =~ ^https?://[A-Za-z0-9._:-]+(/.*)?$ ]] || \
  fail "frontend-url must be a complete http:// or https:// URL without spaces"

if [[ -n "${ADMIN_EMAIL}" && ! "${ADMIN_EMAIL}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  fail "admin-email does not look like an email address"
fi

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "the Docker Compose plugin is not available"
command -v openssl >/dev/null 2>&1 || fail "openssl is not installed"
command -v awk >/dev/null 2>&1 || fail "awk is not installed"

[[ -f "${ENV_TEMPLATE}" ]] || fail "missing ${ENV_TEMPLATE}"
[[ -f "${COMPOSE_FILE}" ]] || fail "missing ${COMPOSE_FILE}"
[[ ! -e "${ENV_FILE}" ]] || fail "${ENV_FILE} already exists; refusing to rotate stable secrets"

umask 077
cp "${ENV_TEMPLATE}" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

set_env_value SPARKY_FITNESS_FRONTEND_URL "${FRONTEND_URL%/}"
set_env_value SPARKY_FITNESS_DB_PASSWORD "$(openssl rand -hex 32)"
set_env_value SPARKY_FITNESS_APP_DB_PASSWORD "$(openssl rand -hex 32)"
set_env_value SPARKY_FITNESS_API_ENCRYPTION_KEY "$(openssl rand -hex 32)"
set_env_value BETTER_AUTH_SECRET "$(openssl rand -hex 48)"

if [[ -n "${ADMIN_EMAIL}" ]]; then
  set_env_value SPARKY_FITNESS_ADMIN_EMAIL "${ADMIN_EMAIL}"
fi

APPDATA_ROOT="$(awk -F= '$1 == "UNRAID_APPDATA_ROOT" { sub(/^[^=]*=/, ""); print; exit }' "${ENV_FILE}")"
[[ "${APPDATA_ROOT}" == /mnt/user/appdata/* ]] || fail "UNRAID_APPDATA_ROOT must remain below /mnt/user/appdata"

mkdir -p \
  "${APPDATA_ROOT}/postgresql" \
  "${APPDATA_ROOT}/uploads" \
  "${APPDATA_ROOT}/backup" \
  "${APPDATA_ROOT}/predeploy-backups"

if grep -Eq '^[A-Za-z_][A-Za-z0-9_]*=CHANGE_ME$' "${ENV_FILE}"; then
  fail "bootstrap left an unresolved CHANGE_ME value in ${ENV_FILE}"
fi

docker compose --project-name sparkyfitness --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --quiet

printf '\nBootstrap complete.\n'
printf 'Configuration: %s\n' "${ENV_FILE}"
printf 'Persistent data: %s\n' "${APPDATA_ROOT}"
printf 'Next: configure the GitHub environment, then enable UNRAID_DEPLOY_ENABLED.\n'
