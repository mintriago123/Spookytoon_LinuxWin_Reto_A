#!/usr/bin/env bash
set -euo pipefail
umask 027
APP_ROOT=${APP_ROOT:-/opt/spookython}
REPO_DIR=${REPO_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}
BACKEND_ENV_FILE=${BACKEND_ENV_FILE:-/etc/spookython/backend.env}
export BACKEND_ENV_FILE
for command in git node npm pm2 curl flock tar; do command -v "$command" >/dev/null; done
node -e 'if (+process.versions.node.split(".")[0] !== 24) process.exit(1)'
test -r "$BACKEND_ENV_FILE"
node --env-file="$BACKEND_ENV_FILE" -e 'if (!process.env.OPERATOR_PASSWORD || process.env.OPERATOR_PASSWORD === process.env.ROUTE_API_KEY) { console.error("OPERATOR_PASSWORD debe estar definida y ser distinta de ROUTE_API_KEY"); process.exit(1) }'
mkdir -p "$APP_ROOT/releases"
exec 9>"$APP_ROOT/deploy.lock"
flock -n 9 || { echo 'Otro despliegue/rollback está activo' >&2; exit 1; }
target=$(git -C "$REPO_DIR" rev-parse --verify "${1:-HEAD}^{commit}")
release=$(mktemp -d "$APP_ROOT/releases/${target:0:12}-XXXXXX")
git -C "$REPO_DIR" archive "$target" backend infra tsconfig.json | tar -x -C "$release"
printf '%s\n' "$target" > "$release/COMMIT"
npm --prefix "$release/backend" ci --no-audit --no-fund
npm --prefix "$release/backend" run typecheck
# Pruebas de backend, incluidos los tres smoke, antes de detener el escritor actual.
NODE_ENV=test npm --prefix "$release/backend" test
previous=$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)
restore_on_error() {
    local result=$?
    trap - ERR
    pm2 stop spookython-backend >/dev/null 2>&1 || true
    if [[ -n "$previous" && -f "$previous/infra/ecosystem.config.cjs" ]]; then
        pm2 delete spookython-backend >/dev/null 2>&1 || true
        pm2 start "$previous/infra/ecosystem.config.cjs" --only spookython-backend --update-env
        ln -sfn "$previous" "$APP_ROOT/current-next"
        mv -Tf "$APP_ROOT/current-next" "$APP_ROOT/current"
        pm2 save
    fi
    echo 'Despliegue fallido; se intentó restaurar el proceso anterior' >&2
    exit "$result"
}
trap restore_on_error ERR
# Detener primero: nunca dos procesos escribiendo la misma partida.
pm2 stop spookython-backend >/dev/null 2>&1 || true
pm2 delete spookython-backend >/dev/null 2>&1 || true
pm2 start "$release/infra/ecosystem.config.cjs" --only spookython-backend --update-env
healthy=false
for attempt in {1..30}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3001/health/ready >/dev/null; then healthy=true; break; fi
    sleep 1
done
[[ "$healthy" == true ]]
public_api_url=$(node --env-file="$BACKEND_ENV_FILE" -p 'process.env.PUBLIC_API_URL || ""')
if [[ -n "$public_api_url" ]]; then
    operator_response=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code} %{content_type}' "${public_api_url%/}/operador/sesion")
    [[ "$operator_response" == "401 application/json"* ]] || { echo 'Caddy no enruta /operador/sesion al backend' >&2; false; }
fi
if [[ -n "$previous" ]]; then printf '%s\n' "$previous" > "$APP_ROOT/previous-release"; fi
ln -sfn "$release" "$APP_ROOT/current-next"
mv -Tf "$APP_ROOT/current-next" "$APP_ROOT/current"
pm2 save
trap - ERR
printf 'Desplegado %s; readiness OK. Partida recuperada permanece pausada.\n' "$target"
