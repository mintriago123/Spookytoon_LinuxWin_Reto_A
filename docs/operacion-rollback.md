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

## Desplegar una release

Desde un checkout que contenga el commit deseado, con árbol de backend preparado y cambios ya versionados:

```bash
bash infra/deploy-ec2.sh COMMIT_SHA
curl --fail http://127.0.0.1:3001/health/ready
pm2 status
curl -i https://3-128-78-190.sslip.io/estado
```

El script extrae solo `backend/`, `infra/` y `tsconfig.json` del commit; no modifica el frontend. Instala mediante lockfile, ejecuta typecheck y pruebas de backend en la release nueva mientras la anterior sigue sirviendo. Un fallo previo al corte no detiene producción. Después detiene/elimina al proceso PM2 anterior antes de iniciar el nuevo, espera readiness y promueve `/opt/spookython/current`. Esto implica una interrupción breve y reconexión WS; evita dos escritores simultáneos. No usar reload de cluster para buscar cero interrupción.

El checkout puede estar en otra ruta usando `REPO_DIR`; `APP_ROOT` y `BACKEND_ENV_FILE` son configurables. La release previa se guarda en `previous-release`; el lock de despliegue también lo toma rollback. Caddy se valida/instala en la preparación; si su archivo cambia, validar, instalar y recargar explícitamente como arriba. Verificar `/estado` tras el corte: 503 GAME_NOT_STARTED es normal si no existe checkpoint ni partida, aun con readiness 200. Si había partida incompleta, debe aparecer `paused`, con el último turno completamente persistido. Reanudar explícitamente con misma identidad/semilla. No esperar que una cola asíncrona sobreviva a SIGKILL o a pérdida de la máquina.

## Persistencia y recuperación

Cada commit y control publicado encola una referencia inmutable; JSON, gzip y la red se ejecutan después en la cola, sin await en el turno o `/paso`. Límite por defecto 32 checkpoints, escritura serial, cuatro intentos totales con backoff y jitter. En saturación se solicita pausa al cierre, se drena y se intenta guardar el estado pausado. Tras agotar reintentos se conserva la cola en memoria, se emite alarma y readiness pasa a 503; no se oculta una falla de DynamoDB con memoria. Investigar IAM, SCP, tabla y conectividad antes de reiniciar o reanudar.

Payloads gzip binarios, sin repetir el grafo, con SHA-256. Claves de manifiesto: `GAME#<gameId>` y `TURN#000001`; partes incluyen UUID de revisión. El manifiesto y `META#LATEST/SNAPSHOT` se publican juntos mediante transacción después de las partes. Un fragmento faltante/corrupto impide recuperar y servir un estado inconsistente. Referencias privadas del routing se descartan en recuperación; el siguiente sync se instala desde base 0 conservando turnId/worldVersion público. Si la última partida ya terminó, no se reanuda automáticamente. No reutilizar gameIds de partidas anteriores.

La cola se drena durante SIGTERM/SIGINT; PM2 permite 45 s de cierre. Si la red está caída y la cola es grande, ese plazo puede no alcanzar: mantener la partida pausada e investigar antes de matar el proceso. No hay garantía de persistencia sincrónica por turno. El checkpoint no incluye muestras privadas de la ventana de 1.000 rutas; tras reiniciar, esa ventana se reconstruye.

Retención: este cambio no borra datos. Conservar manifests y todas sus partes mientras se necesite recuperar la partida; nunca eliminar fragmentos de una revisión vigente. Revisar y limpiar revisiones huérfanas/partidas antiguas mediante un procedimiento de mantenimiento separado y permisos dedicados. El role de aplicación no tiene DeleteItem. El costo aumenta si no se aplica retención.

## Monitoreo y alertas

Readiness local exige grafo validado con manifiesto/checksum, motor inicializado, todos los workers listos, adaptador listo y cola saludable; no requiere partida ni sync previa. Liveness indica que el proceso HTTP responde. Cada 30 s se emite JSON `event=backend-metrics`: gameId, turno, versión, p95 de rutas, timeouts, clientes WS, RSS, salud de workers y profundidad/edad/fallos de cola. Cada turno publica progreso de persistencia en el siguiente snapshot. Los logs de alarma no contienen snapshots ni claves API.

Para enviar logs, instalar CloudWatch Agent, otorgarle permisos de escritura de logs (por ejemplo CloudWatchAgentServerPolicy, revisada para el entorno) y aplicar `infra/cloudwatch-agent.json` desde la instancia:

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c file:infra/cloudwatch-agent.json
# Con los grupos de logs creados por el agente:
SNS_TOPIC_ARN=arn:aws:sns:us-east-2:CUENTA:TEMA bash infra/cloudwatch-alarms.sh
aws logs tail /spookython/backend --follow --region us-east-2
```

El script crea CPU >80% (dos periodos de 5 min), StatusCheckFailed ≥1 (dos de 60 s), p95 >150 ms y fallos de persistencia. Sin SNS crea alarmas sin notificación externa y lo indica. Los filtros de p95 son el máximo de percentiles de ventana ya calculados por el backend; no son un percentil CloudWatch sobre todas las peticiones. No se crearon alarmas ni tópicos desde esta sesión. Vigilar además CPUCreditBalance/CPUSurplusCreditsCharged, memoria, disco y logs de PM2/Caddy. Configurar rotación local (PM2 logrotate y política Caddy) para no llenar EBS. Retención CloudWatch: 14 días.

## Rollback

```bash
bash infra/rollback-ec2.sh
curl --fail http://127.0.0.1:3001/health/ready
curl -i https://3-128-78-190.sslip.io/estado
pm2 logs spookython-backend --lines 50 --nostream
```

Rollback utiliza la release previa ya instalada; detiene al escritor actual, inicia el anterior, comprueba readiness y cambia el symlink. Si falla, intenta restablecer el proceso que estaba activo. No elimina releases ni revierte datos en DynamoDB. Probar compatibilidad del esquema de checkpoint y graphVersion antes de migrar formatos; un binario anterior que no pueda leer el último checkpoint debe fallar cerrado. Conservar una copia/backup antes de una migración de formato. Este rollback de código no es restauración a un turno histórico.

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
de backend sí están en `/var/log/spookython/` del host. Este cambio no afirma
haber instalado el Agent ni aplicado las alarmas en AWS.

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
