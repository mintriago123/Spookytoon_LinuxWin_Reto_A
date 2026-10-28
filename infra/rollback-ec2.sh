#!/usr/bin/env bash
set -euo pipefail
umask 027
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/release-common.sh"
require_node
exec 9>"$APP_ROOT/deploy.lock"
flock -n 9 || { echo 'Otro despliegue/rollback está activo' >&2; exit 1; }
target=$(mktemp "$APP_ROOT/deployments/rollback-target-XXXXXXXX.json")
current=$(mktemp "$APP_ROOT/deployments/rollback-current-XXXXXXXX.json")
cp "$APP_ROOT/previous-release.json" "$target"
check_state "$target"
capture_state "$current"
restore_current() {
    result=$?
    trap - ERR
    if ! activate_state "$current"; then echo 'ERROR: no se pudo restaurar la entrega activa' >&2; fi
    exit "$result"
}
trap restore_current ERR
activate_state "$target"
save_state "$current" "$APP_ROOT/previous-release.json"
save_state "$target" "$APP_ROOT/current-release.json"
python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["backend"])' "$current" > "$APP_ROOT/previous-release"
trap - ERR
echo 'Rollback conjunto completado; DynamoDB no se revierte.'
