#!/usr/bin/env bash
set -euo pipefail
commit=78cff56dadc61a4cad0c560af48bded612b1cefc
web_root=/opt/spookython/web
web_release="$web_root/releases/$commit"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_container="caddy-proxy-before-prueba-$stamp"
backup_config="/home/ec2-user/Caddyfile.before-prueba-$stamp"
image=$(sudo docker inspect caddy-proxy --format '{{.Image}}')
mkdir -p "$web_release"
tar -xzf /tmp/spooky-prueba-78cff56-frontend.tar.gz -C "$web_release"
printf '%s\n' "$commit" > "$web_release/COMMIT"
test -s "$web_release/index.html"
test -s "$web_release/data/grafo_manta.json"
ln -sfn "releases/$commit" "$web_root/current-next"
mv -Tf "$web_root/current-next" "$web_root/current"
sudo docker cp /tmp/Caddyfile-prueba caddy-proxy:/tmp/Caddyfile-prueba
sudo docker exec caddy-proxy caddy validate --config /tmp/Caddyfile-prueba --adapter caddyfile
cp /home/ec2-user/Caddyfile "$backup_config"
rollback() {
    result=$?
    trap - ERR
    cat "$backup_config" > /home/ec2-user/Caddyfile
    sudo docker stop caddy-proxy >/dev/null 2>&1 || true
    sudo docker rm caddy-proxy >/dev/null 2>&1 || true
    sudo docker rename "$backup_container" caddy-proxy
    sudo docker start caddy-proxy
    exit "$result"
}
sudo docker stop caddy-proxy
sudo docker rename caddy-proxy "$backup_container"
trap rollback ERR
cat /tmp/Caddyfile-prueba > /home/ec2-user/Caddyfile
sudo docker run -d --name caddy-proxy --network host --restart unless-stopped \
    -v caddy_data:/data -v caddy_config:/config \
    -v /home/ec2-user/Caddyfile:/etc/caddy/Caddyfile \
    -v "$web_root:/srv/spookython:ro" "$image"
healthy=false
for attempt in {1..20}; do
    if curl --fail --silent --max-time 3 --resolve 3-128-78-190.sslip.io:443:127.0.0.1 \
      https://3-128-78-190.sslip.io/ -o /tmp/spookython-web-check.html && \
      python3 -c 'assert "<div id=\"root\">" in open("/tmp/spookython-web-check.html").read()'; then healthy=true; break; fi
    sleep 1
done
[[ "$healthy" == true ]]
trap - ERR
printf 'Frontend %s publicado. Rollback: contenedor %s y configuración %s\n' "$commit" "$backup_container" "$backup_config"
