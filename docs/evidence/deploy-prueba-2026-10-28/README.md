# Despliegue integrado de prueba — 2026-10-28

Commit fuente: `78cff56dadc61a4cad0c560af48bded612b1cefc`, rama `prueba`.
Web: https://3-128-78-190.sslip.io
WebSocket: wss://3-128-78-190.sslip.io/ws

## Verificación

- Backend promovido con `infra/deploy-ec2.sh`: typecheck y 37/37 pruebas aprobadas en EC2 antes del corte.
- Frontend del mismo commit compilado con Vite, usando `VITE_API_BASE_URL=https://3-128-78-190.sslip.io` y `VITE_WS_URL=wss://3-128-78-190.sslip.io/ws`. No se modificaron archivos fuente del frontend.
- La URL raíz entrega HTML y los assets JavaScript responden correctamente. Grafo público idéntico al backend por SHA-256.
- Chromium: mapa, cámaras, métricas y WebSocket sin errores de JavaScript. Mapa móvil con altura de 422 px.
- Smoke real R1: 20 sobrevivientes; cuatro turnos comprometidos; 17 sobrevivientes cambiaron de nodo; 16 conservan refugio objetivo. p95 28,5 ms, disponibilidad 100 %, cero timeouts, respuestas inválidas y deadline misses. HTTP/WS coinciden.
- Cuatro cámaras de referencia, tres habilitadas. La cuarta permanece fuera del grafo activo.
- Recuperación real desde DynamoDB tras reiniciar PM2: mismo gameId, turno 4, worldVersion 4, sobrevivientes, refugios, cámaras y observaciones. Estado `paused`.
- Un proceso backend online. CloudWatch y sus cuatro alarmas continuaron en OK después del despliegue.

La verificación de esta release fue de humo; no se repitieron aquí tres rondas de 150 turnos. La evidencia de aceptación completa de `a09f235` permanece en el directorio de integración anterior.

## Publicación web

Backend: `/opt/spookython/current`, PM2 `spookython-backend`, puerto local 3001.
Frontend: `/opt/spookython/web/releases/78cff56dadc61a4cad0c560af48bded612b1cefc`.
El enlace `web/current` es relativo a `releases/COMMIT` para que funcione dentro del contenedor.
Caddy conserva red host, imagen ya instalada, volúmenes TLS `caddy_data`/`caddy_config` y el bind mount de `/home/ec2-user/Caddyfile`. Se agregó un bind mount de solo lectura `/opt/spookython/web:/srv/spookython:ro`.
Caddy sirve el frontend estático desde `/srv/spookython/current`, con fallback SPA; `/estado`, `/ws` y `/simulador/*` conservan proxy al backend. `/health/*`, `/motor/*` y `/paso` mantienen acceso solo interno.

El archivo `Caddyfile` de esta evidencia es la configuración aplicada. `deploy-frontend.sh` registra el procedimiento ejecutado y espera el archivo compilado `/tmp/spooky-prueba-78cff56-frontend.tar.gz`. No es un instalador genérico: está fijado al commit validado.

## Estado de demo

Ronda 1 pausada en turno 4. Para reanudar desde los controles, el operador utiliza su API key existente y estos valores (no son secretos):

- gameId: `deploy-prueba-78cff56`
- ronda: `1`
- seed: `demo-manta-2026`

El secreto de operador permanece exclusivamente en `/etc/spookython/backend.env`, fuera del repositorio y del build.

## Rollback

El backend conserva su release anterior en `/opt/spookython/previous-release`; usar `infra/rollback-ec2.sh` con Node 24 y el mismo usuario PM2.
Caddy anterior detenido: `caddy-proxy-before-prueba-20261028T083445Z`.
Configuración anterior: `/home/ec2-user/Caddyfile.before-prueba-20261028T083445Z`.
Para revertir solo la publicación web, detener el Caddy nuevo, restaurar el contenido del archivo anterior, renombrar el contenedor nuevo, renombrar el anterior a `caddy-proxy` e iniciarlo. Conservar los volúmenes TLS; no borrarlos. Esto vuelve a servir solo la API en el dominio.

El primer intento de publicar estáticos no pasó el healthcheck por un enlace absoluto que no resolvía en el contenedor; el rollback mantuvo la API. Se corrigió a enlace relativo y el segundo intento pasó.
