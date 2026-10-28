#!/usr/bin/env bash
set -euo pipefail
umask 027
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/release-common.sh"
REPO_DIR=${REPO_DIR:-$(cd -- "$script_dir/.." && pwd)}
for command in git node npm pm2 curl flock tar python3 sha256sum sudo; do command -v "$command" >/dev/null; done
require_node
[[ $# == 3 ]] || { echo 'Uso: deploy-ec2.sh COMMIT FRONTEND_TGZ SHA256' >&2; exit 1; }
test -r "$BACKEND_ENV_FILE"
"$NODE_BINARY" --env-file="$BACKEND_ENV_FILE" -e 'if (!process.env.OPERATOR_PASSWORD || process.env.OPERATOR_PASSWORD === process.env.ROUTE_API_KEY) { console.error("OPERATOR_PASSWORD debe estar definida y ser distinta de ROUTE_API_KEY"); process.exit(1) }'
mkdir -p "$APP_ROOT/releases" "$APP_ROOT/web/releases" "$APP_ROOT/deployments"
exec 9>"$APP_ROOT/deploy.lock"
flock -n 9 || { echo 'Otro despliegue/rollback está activo' >&2; exit 1; }
target=$(git -C "$REPO_DIR" rev-parse --verify "$1^{commit}")
[[ "$3" =~ ^[0-9a-f]{64}$ && "$(sha256sum "$2" | cut -d' ' -f1)" == "$3" ]] || { echo 'Checksum de transferencia inválido' >&2; exit 1; }
release=$(mktemp -d "$APP_ROOT/releases/${target:0:12}-XXXXXXXX")
git -C "$REPO_DIR" archive "$target" backend infra scripts/verify-ec2-rounds.mjs tsconfig.json | tar -x -C "$release"
printf '%s\n' "$target" > "$release/COMMIT"
python3 "$script_dir/release-artifact.py" verify "$target" "$2" "$release/backend/data/grafo_manta.json" "$release/artifact"
web_release="$APP_ROOT/web/releases/$(basename "$release")"
mv "$release/artifact/dist" "$web_release"
printf '%s\n' "$target" > "$web_release/COMMIT"
mv "$release/artifact/release-manifest.json" "$release/release-manifest.json"
docker_cmd inspect "$CADDY_CONTAINER" --format '{{json .Mounts}}' | python3 -c 'import json,sys,pathlib;assert any(m["Destination"]=="/srv/spookython" and not m["RW"] and pathlib.Path(m["Source"]).resolve()==pathlib.Path(sys.argv[1]).resolve() for m in json.load(sys.stdin))' "$APP_ROOT/web"
validate_caddy "$release/infra/Caddyfile"
npm --prefix "$release/backend" ci --no-audit --no-fund
npm --prefix "$release/backend" run typecheck
NODE_ENV=test npm --prefix "$release/backend" test
before="$APP_ROOT/deployments/$(basename "$release")-before.json"
after="$APP_ROOT/deployments/$(basename "$release")-after.json"
capture_state "$before"
check_state "$before"
python3 - "$release" "$web_release" "$after" <<'STATE'
import pathlib,json,sys
b,f,out=map(pathlib.Path,sys.argv[1:])
out.write_text(json.dumps({'schemaVersion':1,'commit':(b/'COMMIT').read_text().strip(),
    'backend':str(b),'frontend':str(f),'caddy':(b/'infra/Caddyfile').read_text()},indent=2))
STATE
restore_on_error() {
    result=$?
    trap - ERR
    if activate_state "$before"; then
        save_state "$before" "$APP_ROOT/current-release.json" || true
        echo 'Entrega anterior restaurada: frontend, backend y Caddy' >&2
    else
        echo 'ERROR: rollback no saludable; revisar logs y manifests de deployments/' >&2
    fi
    exit "$result"
}
trap restore_on_error ERR
activate_state "$after"
operator_response=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code} %{content_type}' "${PUBLIC_API_URL%/}/operador/sesion")
[[ "$operator_response" == "401 application/json"* ]] || { echo 'Caddy no enruta /operador/sesion al backend' >&2; false; }
save_state "$before" "$APP_ROOT/previous-release.json"
save_state "$after" "$APP_ROOT/current-release.json"
python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["backend"])' "$before" > "$APP_ROOT/previous-release"
trap - ERR
printf 'Desplegado %s: frontend + backend + Caddy; readiness y web OK.\n' "$target"
