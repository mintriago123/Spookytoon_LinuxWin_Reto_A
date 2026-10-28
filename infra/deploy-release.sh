#!/usr/bin/env bash
# Entrada local: compila sin cargar la EC2 y sin leer la API key.
set -euo pipefail
repo=$(git rev-parse --show-toplevel)
commit=$(git -C "$repo" rev-parse --verify "${1:-origin/prueba}^{commit}")
host=${EC2_HOST:-ec2-user@3.128.78.190}
key=${SSH_KEY:-$HOME/Descargas/Michi.pem}
remote_repo=${REMOTE_REPO_DIR:-/home/ec2-user/Spookytoon_LinuxWin_Reto_A}
remote_node=${REMOTE_NODE_BINARY:-/home/ec2-user/.local/node/node-v24.22.0-linux-x64/bin/node}
[[ "$host" =~ ^[a-zA-Z0-9_.@-]+$ && "$remote_repo" =~ ^/[a-zA-Z0-9_./-]+$ && "$remote_node" =~ ^/[a-zA-Z0-9_./-]+$ ]]
node -e 'if (+process.versions.node.split(".")[0] !== 24) process.exit(1)'
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
git -C "$repo" archive "$commit" frontend backend/data/grafo_manta.json | tar -x -C "$work"
npm --prefix "$work/frontend" ci --no-audit --no-fund
npm --prefix "$work/frontend" run typecheck
npm --prefix "$work/frontend" test
npm --prefix "$work/frontend" run lint
VITE_API_BASE_URL=https://3-128-78-190.sslip.io VITE_WS_URL=wss://3-128-78-190.sslip.io/ws \
    npm --prefix "$work/frontend" run build
python3 "$repo/infra/release-artifact.py" pack "$commit" "$work/frontend/dist" "$work/backend/data/grafo_manta.json" "$work/frontend.tgz"
digest=$(sha256sum "$work/frontend.tgz" | cut -d' ' -f1)
ssh_args=(-i "$key" -o BatchMode=yes -o StrictHostKeyChecking=yes)
remote_dir=$(ssh "${ssh_args[@]}" "$host" 'mktemp -d /tmp/spookython-deploy-XXXXXXXX')
[[ "$remote_dir" =~ ^/tmp/spookython-deploy-[a-zA-Z0-9]+$ ]]
scp "${ssh_args[@]}" "$work/frontend.tgz" "$repo/infra/deploy-ec2.sh" "$repo/infra/release-common.sh" "$repo/infra/release-artifact.py" "$host:$remote_dir/"
ssh "${ssh_args[@]}" "$host" \
    "set -e; export NODE_BINARY='$remote_node'; export PATH='$(dirname "$remote_node")':\$PATH; export REPO_DIR='$remote_repo'; git -C '$remote_repo' fetch origin; bash '$remote_dir/deploy-ec2.sh' '$commit' '$remote_dir/frontend.tgz' '$digest'"
