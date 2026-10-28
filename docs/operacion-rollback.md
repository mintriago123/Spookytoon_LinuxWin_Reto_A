# Operación y rollback en EC2

## Topología y configuración

Instancia `i-010f44e5ec891fc73`, EC2 t3.micro (2 vCPU / 1 GiB), Amazon Linux 2023, zona `us-east-2a`. Servicios regionales en `us-east-2`. Caddy termina TLS para `3-128-78-190.sslip.io` y reenvía HTTP/WS a `localhost:3001`. Un único escritor PM2 en modo fork; no lanzar otra copia, cluster PM2, contenedor o servidor de desarrollo sobre la misma partida. El navegador lee `/estado` y `/ws`; controles requieren `x-api-key` suministrada por un operador, nunca embebida en el build web.

Requisitos de máquina: Git, Node 24.12+ de la serie 24, npm, PM2, curl, util-linux/flock, Caddy, AWS CLI v2 y opcionalmente CloudWatch Agent. Registrar versiones instaladas y fijarlas al preparar la AMI. Los scripts de release no instalan paquetes del sistema ni modifican IAM, DNS o security groups.

Preparación única por el operador:

```bash
sudo install -d -o ec2-user -g ec2-user -m 0750 /opt/spookython /var/log/spookython
sudo install -d -o root -g ec2-user -m 0750 /etc/spookython
sudo install -o ec2-user -g ec2-user -m 0600 backend/.env.example /etc/spookython/backend.env
# Editar backend.env y sustituir ROUTE_API_KEY por un secreto real, sin publicarlo.
sudo install -d -o caddy -g caddy -m 0750 /var/log/caddy
sudo install -o root -g caddy -m 0640 infra/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Ejecutar PM2 y scripts como `ec2-user`, con el mismo PM2_HOME. Configurar `pm2 startup` mediante el comando que PM2 muestre para el usuario y guardar con `pm2 save`; verificar reinicio de la instancia antes del evento. PM2 lee el archivo env externo con `--env-file`, no guarda la API key en el archivo del repositorio. Abrir 80/443 en el security group; restringir SSH o usar SSM; 3001 no se expone a Internet. Caddy deniega `/health/*`, `/motor/*` y `/paso` desde el dominio público: sus pruebas son locales. `localhost:3001` debe resolver hacia el listener local de Fastify.

La instancia necesita un IAM Role con permisos sobre la tabla, no access keys en `.env`, PM2 o Docker. Renderizar el marcador `REPLACE_WITH_ACCOUNT_ID` de `infra/iam-policy-dynamodb.json` con la cuenta real antes de adjuntar esa política al role. Permite DescribeTable, GetItem y PutItem en una sola tabla y región; PutItem autoriza también las escrituras Put de TransactWriteItems. No requiere Scan, ListTables, DeleteItem ni acceso a tablas ajenas. La creación de alarmas y las operaciones IAM usan una identidad de operador independiente.

La tabla existente `spookython-manta-state` está ACTIVE y On-Demand con `gameId` (partition, S) y `turnId` (sort, N), verificado por SSH el 28 de octubre. El adaptador detecta ese esquema y también admite PK/SK de texto; no migra ni borra datos. Usa prefijos GAME#/META# para separar sus checkpoints de ítems anteriores. Un esquema distinto falla antes de readiness. Confirmar con `aws dynamodb describe-table --region us-east-2 --table-name spookython-manta-state`. El esquema se consultó desde EC2 antes de preparar la release.

## Desplegar frontend y backend juntos

Desde la estación de trabajo, Node 24.12+ de la serie 24, Python 3.9+, Git,
SSH/SCP y la clave SSH existente. La rama final de integración es `prueba`.

```bash
git fetch origin
SSH_KEY="$HOME/Descargas/Michi.pem" bash infra/deploy-release.sh origin/prueba
```

El comando extrae el commit a un temporal, instala por lockfile, ejecuta
los tests, typecheck y lint del frontend y compila sus estáticos para el dominio
público. No modifica archivos fuente ni obtiene la API key. Transfiere un
artefacto con commit, inventario SHA-256 y hash/version del grafo. EC2 comprueba
checksum de transferencia, rutas seguras, inventario y grafo antes de preparar
la release. El build web ocurre localmente para no cargar la t3.micro activa.

El comando remoto `deploy-ec2.sh COMMIT FRONTEND_TGZ SHA256` ejecuta npm ci,
typecheck y pruebas del backend antes del corte. Requiere `release-common.sh`
y `release-artifact.py` junto al script; el orquestador los transfiere.
La identidad AWS sigue siendo el role de EC2, sin llaves adicionales.

Se aplica un lock común a deploy y rollback. Primero se detiene y elimina el
proceso PM2 anterior y se comprueba que no quede un escritor vivo; después se
activan los dos enlaces de release, se inicia un solo backend y se verifica
readiness. Solo entonces se recarga Caddy y se comprueban la web y el grafo
públicos. Un fallo restaura frontend, backend y configuración anteriores.
La transición tiene una interrupción breve y los clientes WS reconectan.

Backend: `/opt/spookython/current`. Frontend: `/opt/spookython/web/current`,
con enlace relativo a `releases/ID` para funcionar dentro del contenedor.
`current-release.json` y `previous-release.json` identifican la pareja de rutas,
commit y configuración Caddy. `deployments/` conserva los estados antes/después;
no contienen la API key. Las releases antiguas se conservan para rollback.

El Caddy de esta instancia corre en Docker, con certificados persistentes en
`caddy_data` y `caddy_config`. Debe tener el bind mount de solo lectura
`/opt/spookython/web:/srv/spookython:ro` y el archivo existente
`/home/ec2-user/Caddyfile:/etc/caddy/Caddyfile`. El despliegue verifica ese montaje
antes del corte; no recrea el contenedor ni elimina certificados. La raíz sirve
el frontend; `/estado`, `/ws` y `/simulador/*` hacen proxy a localhost:3001.
`/health/*`, `/motor/*` y `/paso` permanecen internos.

Configuración opcional del orquestador: `EC2_HOST`, `SSH_KEY`,
`REMOTE_REPO_DIR` y `REMOTE_NODE_BINARY`. En EC2 se admiten `APP_ROOT`,
`BACKEND_ENV_FILE`, `CADDY_CONFIG`, `CADDY_CONTAINER` y `PUBLIC_API_URL`.
Readiness 200 no exige partida. `/estado` responde 503 GAME_NOT_STARTED sin
partida; una recuperación válida queda pausada y se reanuda explícitamente.

## Persistencia y recuperación

Cada commit y control publicado encola una referencia inmutable; JSON, gzip y la red se ejecutan después en la cola, sin await en el turno o `/paso`. Límite por defecto 32 checkpoints, escritura serial, cuatro intentos totales con backoff y jitter. En saturación se solicita pausa al cierre, se drena y se intenta guardar el estado pausado. Tras agotar reintentos se conserva la cola en memoria, se emite alarma y readiness pasa a 503; no se oculta una falla de DynamoDB con memoria. Investigar IAM, SCP, tabla y conectividad antes de reiniciar o reanudar.

Payloads gzip binarios, sin repetir el grafo, con SHA-256. Claves de manifiesto: `GAME#<gameId>` y `TURN#000001`; partes incluyen UUID de revisión. El manifiesto y `META#LATEST/SNAPSHOT` se publican juntos mediante transacción después de las partes. Un fragmento faltante/corrupto impide recuperar y servir un estado inconsistente. Referencias privadas del routing se descartan en recuperación; el siguiente sync se instala desde base 0 conservando turnId/worldVersion público. Si la última partida ya terminó, no se reanuda automáticamente. No reutilizar gameIds de partidas anteriores.

La cola se drena durante SIGTERM/SIGINT; PM2 permite 45 s de cierre. Si la red está caída y la cola es grande, ese plazo puede no alcanzar: mantener la partida pausada e investigar antes de matar el proceso. No hay garantía de persistencia sincrónica por turno. El checkpoint no incluye muestras privadas de la ventana de 1.000 rutas; tras reiniciar, esa ventana se reconstruye.

Retención: este cambio no borra datos. Conservar manifests y todas sus partes mientras se necesite recuperar la partida; nunca eliminar fragmentos de una revisión vigente. Revisar y limpiar revisiones huérfanas/partidas antiguas mediante un procedimiento de mantenimiento separado y permisos dedicados. El role de aplicación no tiene DeleteItem. El costo aumenta si no se aplica retención.

## Monitoreo y alertas

Readiness local exige grafo validado con manifiesto/checksum, motor inicializado, todos los workers listos, adaptador listo y cola saludable; no requiere partida ni sync previa. Liveness indica que el proceso HTTP responde. Cada 30 s se emite JSON `event=backend-metrics`: gameId, turno, versión, p95 de rutas, timeouts, clientes WS, RSS, salud de workers y profundidad/edad/fallos de cola. Cada turno publica progreso de persistencia en el siguiente snapshot. Los logs de alarma no contienen snapshots ni claves API.

Para enviar logs, instalar CloudWatch Agent y otorgarle permisos de escritura sobre el grupo del backend. La política mínima está en `infra/iam-policy-cloudwatch-agent.json` (renderizar la cuenta); la identidad de instalación debe crear previamente el grupo. Aplicar `infra/cloudwatch-agent.json` desde la instancia:

```bash
sudo dnf install -y amazon-cloudwatch-agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c file:infra/cloudwatch-agent.json
sudo systemctl enable amazon-cloudwatch-agent
# El script prepara el grupo con retención de 14 días antes de los filtros:
SNS_TOPIC_ARN=arn:aws:sns:us-east-2:CUENTA:TEMA bash infra/cloudwatch-alarms.sh
aws logs tail /spookython/backend --follow --region us-east-2
```

El script crea CPU >80% (dos periodos de 5 min), StatusCheckFailed ≥1 (dos de 60 s), p95 >150 ms y fallos de persistencia. Sin SNS crea alarmas sin notificación externa y lo indica. Los filtros de p95 son el máximo de percentiles de ventana ya calculados por el backend; no son un percentil CloudWatch sobre todas las peticiones. Vigilar además CPUCreditBalance/CPUSurplusCreditsCharged, memoria, disco y logs de PM2/Caddy. Configurar rotación local (PM2 logrotate y política Caddy) para no llenar EBS. Retención CloudWatch: 14 días.

Para configurar SNS de forma reproducible, usar una identidad con permisos de SNS y filtros de logs. El script conserva la política existente del tema, autoriza publicaciones solo desde las alarmas `spookython-*` de la cuenta/región y evita suscripciones duplicadas:

```bash
python3 infra/cloudwatch-notifications.py CORREO_DEL_OPERADOR
```

La suscripción requiere confirmación en el correo de AWS. `infra/iam-policy-cloudwatch-setup.json` contiene los permisos adicionales que faltaron al role real de EC2: `logs:PutMetricFilter`, lectura de filtros y lectura/edición de la política del tema del proyecto. Una identidad administradora debe adjuntarla antes de repetir la configuración; la instancia no puede modificar su propio role. No se requieren access keys.

Activación del 28 de octubre de 2026: CloudWatch Agent `1.300071.0` instalado y habilitado por systemd, con logs del backend enviados a `/spookython/backend`. Se crearon las cuatro alarmas, los filtros p95/persistencia y el tema `spookython-alerts` en Ohio, con suscripción de correo confirmada y política de publicación restringida a las alarmas del proyecto. El administrador agregó los permisos tras el rechazo IAM inicial. Consultar [la evidencia](evidence/cloudwatch-2026-10-28/README.md) para las mediciones y el estado observado. El archivo del agente instalado en EC2 es `/opt/aws/amazon-cloudwatch-agent/etc/spookython.json`.

La configuración activa recoge solo backend y errores de PM2. El access log de Caddy está dentro del contenedor y no tiene un bind mount al host; no se acredita su envío a CloudWatch. Para incorporarlo, preparar un volumen de logs en una ventana de despliegue y ampliar de forma explícita la configuración/permisos del agente.

## Rollback

```bash
export NODE_BINARY=/home/ec2-user/.local/node/node-v24.22.0-linux-x64/bin/node
export PATH="$(dirname "$NODE_BINARY"):$PATH"
bash /opt/spookython/current/infra/rollback-ec2.sh
curl --fail http://127.0.0.1:3001/health/ready
curl --fail https://3-128-78-190.sslip.io/ >/dev/null
```

El rollback toma el mismo lock, valida la pareja anterior, detiene al escritor,
restaura frontend/backend/Caddy y comprueba readiness y la web. Si el objetivo
no queda saludable, intenta recuperar la pareja que estaba activa. Intercambia
los manifests actual/anterior solo después del éxito; permite volver adelante.
No revierte DynamoDB, borra partidas ni cambia la API key. Antes de introducir
migraciones de checkpoints, debe comprobarse compatibilidad con la release
anterior; este cierre no modifica esos esquemas.

Para probar fallos sin afectar EC2: `npm run test:infra`. La suite usa dobles
de comandos y directorios temporales para checksums, grafo, Caddy, readiness,
rollback, repetición y exclusión de escritores; no necesita red ni credenciales.

## Alternativa Docker

```bash
docker build -f backend/Dockerfile -t spookython-backend:COMMIT_SHA .
# Detener PM2 antes de iniciar Docker.
docker run -d --name spookython-backend --restart unless-stopped \
  --stop-timeout 45 --env-file /etc/spookython/backend.env \
  -e HOST=0.0.0.0 -e NODE_ENV=production -p 127.0.0.1:3001:3001 \
  spookython-backend:COMMIT_SHA
```

Docker conserva Caddy en el host y ejecuta un único proceso Node como usuario no root. Con red bridge, validar acceso del SDK al IAM Role por IMDSv2 y el hop limit adecuado de EC2; no solucionar acceso copiando llaves al contenedor. El script PM2 de deploy/rollback no administra Docker. El Dockerfile usa Node 24.22.0 y dependencias bloqueadas; las actualizaciones requieren repetir typecheck, pruebas y build. En Podman construir con `--format=docker` para conservar HEALTHCHECK; el formato OCI puede omitirlo.


## Instalación observada y validada el 28 de octubre

El primer despliegue válido fue `4ab5e40`; la actualización de transporte se promovió como `a09f235` en `/opt/spookython/current`, mediante
`infra/deploy-ec2.sh`. Node de la aplicación: versión 24.22.0 instalada sin
reemplazar Node 22 del sistema en
`/home/ec2-user/.local/node/node-v24.22.0-linux-x64/bin/node`. Exportar esa ruta
en PATH y NODE_BINARY al desplegar. PM2 usa `src/start.ts`: PM2 importa su script
desde un contenedor y por ello la entrada debe arrancar explícitamente sin
suponer que `process.argv[1]` apunta al módulo importado.

En esta instancia Caddy está en Docker como `caddy-proxy`, red host, no como
servicio systemd. Conserva volúmenes `caddy_data` y `caddy_config`; el bind mount
lee `/home/ec2-user/Caddyfile`. Para cambiar su configuración, conservar una
copia del archivo, escribir sobre su inode existente y validar/recargar:

```bash
cp /home/ec2-user/Caddyfile /home/ec2-user/Caddyfile.backup
cat /opt/spookython/current/infra/Caddyfile > /home/ec2-user/Caddyfile
docker exec caddy-proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy-proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

No eliminar los volúmenes TLS. Los logs Caddy de este contenedor se consultan
dentro de él; para que CloudWatch Agent del host recoja ese archivo hay que
montar también el directorio de logs del host al crear el contenedor. Los logs
de backend sí están en `/var/log/spookython/` del host. El Agent y las alarmas
se activaron después de la aceptación de rondas; ver la sección de monitoreo.

Identidad AWS verificada: IAM Role `spookython-ec2-role`, región Ohio; sin llaves
AWS en el código o archivo env generado. Se comprobó recuperación real desde
DynamoDB tras reiniciar PM2, conservando turno 2, versión, sobrevivientes y
refugios de una partida pausada. El archivo de operador está en
`/etc/spookython/backend.env`, modo 600; nunca copiarlo a Git ni imprimirlo.

Para verificar las tres rondas completas en el escritor desplegado:

```bash
BACKEND_COMMIT=$(cat /opt/spookython/current/COMMIT) \
  /home/ec2-user/.local/node/node-v24.22.0-linux-x64/bin/node \
  --env-file=/etc/spookython/backend.env scripts/verify-ec2-rounds.mjs
```

La comprobación usa HTTPS/WSS públicos, registra 151 snapshots por ronda,
verifica igualdad GET/WS y capacidad, y confirma el puntero DynamoDB al turno
150. No reemplaza silenciosamente una partida en ejecución. Requiere unos
15 minutos y escribe evidencia en `/opt/spookython/evidence/rounds.json`.


### Continuar una verificación con incidentes

Por defecto el verificador se detiene al observar una pausa. Para continuar
explícitamente un intento ya registrado, conservar el archivo original y usar
`ACCEPTANCE_CONTINUE=true ACCEPTANCE_RESUME_ON_DEADLINE=true`. Solo reanuda ante
un nuevo deadline miss, readiness saludable y la misma identidad/semilla;
no reanuda una caída de persistencia o una pausa sin nuevo incumplimiento.
Las pausas se guardan en la evidencia y hacen que el criterio temporal no se
marque aprobado. `ACCEPTANCE_OUTPUT` permite conservar ciclos independientes.
No usar la reanudación para borrar fallos o presentar el tiempo pausado como
trabajo continuo. La t3.micro mostró cierres tardíos aislados aun con créditos
CPU disponibles; revisar siempre `deadlineMisses` además del p95.

Producción registra controles, errores, lentitud y métricas agregadas.
`LOG_HTTP_REQUESTS=true` activa trazas por petición para diagnóstico; el valor
normal es false. `ROUTING_HTTP_MAX_SOCKETS=8` es el ajuste medido en esta EC2;
la fábrica genérica mantiene su valor independiente. Un cambio de estos valores
requiere repetir las mediciones frías/calientes y las rondas completas.
