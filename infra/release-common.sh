#!/usr/bin/env bash
APP_ROOT=${APP_ROOT:-/opt/spookython}
CADDY_CONFIG=${CADDY_CONFIG:-/home/ec2-user/Caddyfile}
CADDY_CONTAINER=${CADDY_CONTAINER:-caddy-proxy}
PUBLIC_API_URL=${PUBLIC_API_URL:-https://3-128-78-190.sslip.io}
BACKEND_ENV_FILE=${BACKEND_ENV_FILE:-/etc/spookython/backend.env}
export BACKEND_ENV_FILE
docker_cmd() { sudo docker "$@"; }
capture_state() {
    python3 - "$APP_ROOT" "$CADDY_CONFIG" "$1" <<'PY'
import json,pathlib,sys
root,config,out=map(pathlib.Path,sys.argv[1:])
b=(root/'current').resolve(strict=True); f=(root/'web/current').resolve(strict=True)
assert b.is_relative_to(root/'releases') and f.is_relative_to(root/'web/releases')
out.write_text(json.dumps({'schemaVersion':1,'backend':str(b),'frontend':str(f),
    'commit':(b/'COMMIT').read_text().strip(),'caddy':config.read_text()},indent=2))
PY
}
check_state() {
    python3 - "$APP_ROOT" "$1" <<'PY'
import pathlib,json,sys
root=pathlib.Path(sys.argv[1]).resolve(); s=json.loads(pathlib.Path(sys.argv[2]).read_text())
b=pathlib.Path(s['backend']).resolve(strict=True); f=pathlib.Path(s['frontend']).resolve(strict=True)
assert b.is_relative_to(root/'releases') and f.is_relative_to(root/'web/releases')
assert (b/'infra/ecosystem.config.cjs').is_file() and (f/'index.html').is_file()
assert (b/'COMMIT').read_text().strip()==s['commit']==(f/'COMMIT').read_text().strip()
assert (b/'backend/data/grafo_manta.json').read_bytes()==(f/'data/grafo_manta.json').read_bytes()
assert isinstance(s['caddy'],str) and s['caddy']
PY
}
validate_caddy() {
    docker_cmd cp "$1" "$CADDY_CONTAINER:/tmp/spookython-candidate-Caddyfile"
    docker_cmd exec "$CADDY_CONTAINER" caddy validate --config /tmp/spookython-candidate-Caddyfile --adapter caddyfile
}
wait_ready() {
    for attempt in {1..30}; do
        if curl --fail --silent --max-time 2 http://127.0.0.1:3001/health/ready >/dev/null; then return 0; fi
        sleep 1
    done
    return 1
}
verify_public() {
    local check_dir result
    check_dir=$(mktemp -d "$APP_ROOT/public-check-XXXXXXXX")
    curl --fail --silent --show-error --max-time 10 "$PUBLIC_API_URL/" -o "$check_dir/index.html" || return 1
    curl --fail --silent --show-error --max-time 10 "$PUBLIC_API_URL/data/grafo_manta.json" -o "$check_dir/graph.json" || return 1
    python3 - "$APP_ROOT" "$check_dir" <<'PY'
import pathlib,sys
root,p=map(pathlib.Path,sys.argv[1:])
assert '<div id="root">' in (p/'index.html').read_text()
assert (p/'index.html').read_bytes()==(root/'web/current/index.html').read_bytes()
assert (p/'graph.json').read_bytes()==(root/'current/backend/data/grafo_manta.json').read_bytes()
PY
    result=$?
    rm -rf -- "$check_dir"
    return "$result"
}
activate_state() {
    local state=$1 backend frontend
    check_state "$state" || return 1
    backend=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["backend"])' "$state")
    frontend=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["frontend"])' "$state")
    pm2 stop spookython-backend >/dev/null 2>&1 || true
    pm2 delete spookython-backend >/dev/null 2>&1 || true
    pm2 jlist | python3 -c 'import json,sys;assert not any(p.get("name")=="spookython-backend" and p.get("pid",0)>0 for p in json.load(sys.stdin))' || return 1
    ln -sfn "$backend" "$APP_ROOT/current-next" || return 1
    mv -Tf "$APP_ROOT/current-next" "$APP_ROOT/current" || return 1
    ln -sfn "releases/$(basename "$frontend")" "$APP_ROOT/web/current-next" || return 1
    mv -Tf "$APP_ROOT/web/current-next" "$APP_ROOT/web/current" || return 1
    pm2 start "$backend/infra/ecosystem.config.cjs" --only spookython-backend --update-env || return 1
    wait_ready || return 1
    python3 -c 'import json,sys;open(sys.argv[2],"w").write(json.load(open(sys.argv[1]))["caddy"])' "$state" "$CADDY_CONFIG" || return 1
    docker_cmd exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || return 1
    verify_public || return 1
    pm2 save || return 1
}
save_state() {
    python3 - "$1" "$2" <<'PY'
import os,pathlib,sys
source,dest=map(pathlib.Path,sys.argv[1:]); tmp=dest.with_name(dest.name+'.tmp')
tmp.write_bytes(source.read_bytes()); os.replace(tmp,dest)
PY
}
