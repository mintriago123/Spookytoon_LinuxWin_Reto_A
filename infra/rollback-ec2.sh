#!/usr/bin/env bash
set -euo pipefail
APP_ROOT=${APP_ROOT:-/opt/spookython}
BACKEND_ENV_FILE=${BACKEND_ENV_FILE:-/etc/spookython/backend.env}
export BACKEND_ENV_FILE
exec 9>"$APP_ROOT/deploy.lock"
flock -n 9 || { echo 'Otro despliegue/rollback está activo' >&2; exit 1; }
target=$(cat "$APP_ROOT/previous-release")
case "$target" in "$APP_ROOT"/releases/*) ;; *) echo 'Release anterior fuera de APP_ROOT' >&2; exit 1 ;; esac
test -f "$target/COMMIT"
test -f "$target/infra/ecosystem.config.cjs"
current=$(readlink -f "$APP_ROOT/current")
restore_current() {
    local result=$?
    trap - ERR
    pm2 stop spookython-backend >/dev/null 2>&1 || true
    pm2 delete spookython-backend >/dev/null 2>&1 || true
    pm2 start "$current/infra/ecosystem.config.cjs" --only spookython-backend --update-env
    ln -sfn "$current" "$APP_ROOT/current-next"
    mv -Tf "$APP_ROOT/current-next" "$APP_ROOT/current"
    pm2 save
    echo 'Rollback no saludable; se restauró el proceso que estaba activo' >&2
    exit "$result"
}
trap restore_current ERR
pm2 stop spookython-backend >/dev/null 2>&1 || true
pm2 delete spookython-backend >/dev/null 2>&1 || true
pm2 start "$target/infra/ecosystem.config.cjs" --only spookython-backend --update-env
healthy=false
for attempt in {1..30}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3001/health/ready >/dev/null; then healthy=true; break; fi
    sleep 1
done
[[ "$healthy" == true ]]
ln -sfn "$target" "$APP_ROOT/current-next"
mv -Tf "$APP_ROOT/current-next" "$APP_ROOT/current"
printf '%s\n' "$current" > "$APP_ROOT/previous-release"
pm2 save
trap - ERR
printf 'Rollback a %s; readiness OK; no se revierte DynamoDB.\n' "$(cat "$target/COMMIT")"
