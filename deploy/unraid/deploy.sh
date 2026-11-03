#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
PREVIOUS_ENV_FILE="${SCRIPT_DIR}/.env.previous"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yml"
LOCK_FILE="${SCRIPT_DIR}/.deploy.lock"
PROJECT_NAME="sparkyfitness"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

read_env_value() {
  local key="$1"
  awk -v key="${key}" '
    index($0, key "=") == 1 {
      sub(/^[^=]*=/, "")
      print
      exit
    }
  ' "${ENV_FILE}"
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

compose() {
  docker compose \
    --project-name "${PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    "$@"
}

start_application() {
  local options=(--detach --remove-orphans --wait --wait-timeout 240)
  if [[ "${LOCAL_IMAGES}" == true ]]; then
    options+=(--pull never)
  fi
  compose up "${options[@]}"
}

verify_local_image() {
  local image="$1"
  local role="$2"
  local metadata
  metadata="$(docker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "${image}")" \
    || fail "local ${role} image is not available: ${image}"
  [[ "${metadata}" == "${image} ${SOURCE_SHA}" ]] \
    || fail "local ${role} image ID and org.opencontainers.image.revision must match the requested image and source SHA"
}

show_failure_context() {
  compose ps >&2 || true
  compose logs --tail 120 sparkyfitness-db sparkyfitness-server sparkyfitness-frontend >&2 || true
}

rollback_application() {
  printf 'Deployment failed; restoring the previous application image references.\n' >&2
  cp -f "${PREVIOUS_ENV_FILE}" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"

  if start_application; then
    printf 'Application rollback completed. The database was not changed by the rollback.\n' >&2
  else
    printf 'Application rollback also failed; manual intervention is required.\n' >&2
    show_failure_context
  fi
}

LOCAL_IMAGES=false
if [[ "${1:-}" == --local ]]; then
  LOCAL_IMAGES=true
  shift
fi
[[ $# -eq 3 ]] || fail "usage: ./deploy.sh [--local] <frontend-image> <server-image> <source-sha>"

FRONTEND_IMAGE="$1"
SERVER_IMAGE="$2"
SOURCE_SHA="$3"

if [[ "${LOCAL_IMAGES}" == true ]]; then
  IMAGE_PATTERN='^sha256:[a-f0-9]{64}$'
  [[ "${FRONTEND_IMAGE}" =~ ${IMAGE_PATTERN} ]] || fail "local frontend image must be a full sha256 image ID"
  [[ "${SERVER_IMAGE}" =~ ${IMAGE_PATTERN} ]] || fail "local server image must be a full sha256 image ID"
else
  IMAGE_PATTERN='^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$'
  [[ "${FRONTEND_IMAGE}" =~ ${IMAGE_PATTERN} ]] || fail "frontend image must be an immutable ghcr.io digest"
  [[ "${SERVER_IMAGE}" =~ ${IMAGE_PATTERN} ]] || fail "server image must be an immutable ghcr.io digest"
fi
[[ "${SOURCE_SHA}" =~ ^[a-f0-9]{40}$ ]] || fail "source SHA must be a full 40-character Git commit SHA"

for command_name in docker awk gzip flock mktemp; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "required command is missing: ${command_name}"
done

docker compose version >/dev/null 2>&1 || fail "the Docker Compose plugin is not available"
docker compose up --help | grep -q -- '--wait' || fail "Docker Compose is too old; the deployment requires support for docker compose up --wait"

[[ -f "${ENV_FILE}" ]] || fail "missing ${ENV_FILE}; run bootstrap.sh first"
[[ -f "${COMPOSE_FILE}" ]] || fail "missing ${COMPOSE_FILE}"
[[ "$(id -u)" -eq 0 ]] || fail "run the deployment as root on Unraid"

exec 9>"${LOCK_FILE}"
flock -n 9 || fail "another SparkyFitness deployment is already running"

if [[ "${LOCAL_IMAGES}" == true ]]; then
  verify_local_image "${FRONTEND_IMAGE}" frontend
  verify_local_image "${SERVER_IMAGE}" server
fi

APPDATA_ROOT="$(read_env_value UNRAID_APPDATA_ROOT)"
[[ "${APPDATA_ROOT}" == /mnt/user/appdata/* ]] || fail "UNRAID_APPDATA_ROOT must be below /mnt/user/appdata"

POSTGRESQL_ROOT="${APPDATA_ROOT}/postgresql"
BACKUP_DIR="${APPDATA_ROOT}/predeploy-backups"
mkdir -p "${POSTGRESQL_ROOT}" "${BACKUP_DIR}"

# Keep the bind-mount root compatible with the official PostgreSQL 18 image,
# which initializes its versioned PGDATA as the unprivileged postgres user.
chmod 1777 "${POSTGRESQL_ROOT}"

umask 077

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DATABASE_BACKUP="${BACKUP_DIR}/sparkyfitness-${TIMESTAMP}-${SOURCE_SHA:0:12}.sql.gz"

if compose ps --status running --services | grep -Fxq sparkyfitness-db; then
  printf 'Creating pre-deployment database backup: %s\n' "${DATABASE_BACKUP}"
  BACKUP_TEMPORARY="${DATABASE_BACKUP}.tmp"
  if compose exec -T sparkyfitness-db sh -c \
    'exec pg_dump --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
    | gzip -9 > "${BACKUP_TEMPORARY}"; then
    mv -f "${BACKUP_TEMPORARY}" "${DATABASE_BACKUP}"
  else
    rm -f "${BACKUP_TEMPORARY}"
    fail "database backup failed; deployment was not started"
  fi
else
  printf 'Database is not running; skipping backup for this first deployment.\n'
fi

cp -f "${ENV_FILE}" "${PREVIOUS_ENV_FILE}"
chmod 600 "${PREVIOUS_ENV_FILE}"

set_env_value SPARKY_FITNESS_FRONTEND_IMAGE "${FRONTEND_IMAGE}"
set_env_value SPARKY_FITNESS_SERVER_IMAGE "${SERVER_IMAGE}"
set_env_value SPARKY_FITNESS_SOURCE_SHA "${SOURCE_SHA}"

if [[ "${LOCAL_IMAGES}" == true ]]; then
  printf 'Using verified local images for commit %s; registry pulls are disabled.\n' "${SOURCE_SHA}"
else
  printf 'Pulling immutable images for commit %s.\n' "${SOURCE_SHA}"
  if ! compose pull sparkyfitness-server sparkyfitness-frontend; then
    rollback_application
    exit 1
  fi
fi

printf 'Starting SparkyFitness and waiting for healthy containers.\n'
if ! start_application; then
  show_failure_context
  rollback_application
  exit 1
fi

compose ps
printf '%s\n' "${SOURCE_SHA}" > "${SCRIPT_DIR}/.last-successful-deploy"
printf 'Deployment completed successfully: %s\n' "${SOURCE_SHA}"
