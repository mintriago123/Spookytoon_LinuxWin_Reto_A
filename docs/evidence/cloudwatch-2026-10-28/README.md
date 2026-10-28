# Activación CloudWatch — 2026-10-28

Instancia `i-010f44e5ec891fc73`, región `us-east-2`.

- CloudWatch Agent `1.300071.0` instalado, activo y habilitado en systemd.
- Grupo `/spookython/backend`, retención 14 días, stream de backend con eventos recibidos. El stream de errores se crea al recibir datos.
- Tema SNS `spookython-alerts`, suscripción email confirmada. La evidencia no almacena la dirección.
- Política de publicación SNS restringida a CloudWatch y las alarmas `spookython-*` de esta cuenta/región; se conservó la política anterior del tema.
- Cuatro alarmas configuradas con acciones SNS para estados ALARM/OK: CPU >80% durante dos ventanas de cinco minutos; StatusCheckFailed ≥1 durante dos ventanas de un minuto; p95 >150 ms; fallos de persistencia ≥1.
- Filtros reales sobre eventos JSON `backend-metrics` y `persistence-alarm`; métricas `Spookython/RouteP95Ms` y `Spookython/PersistenceFailures`.
- El historial registra acciones SNS exitosas y SNS registra notificaciones entregadas. No se indujeron fallos del servidor ni se alteraron estados de alarmas para esta comprobación.
- Readiness sigue en `ready`; no se reinició el backend ni se cambió su release.

`status.json` contiene el estado observado y las muestras reales. El p95 de CloudWatch es el máximo por periodo del p95 de ventana que calcula el backend; no es un percentil de todas las solicitudes calculado por CloudWatch.

## Reproducibilidad

El administrador adjuntó `SpookythonObservabilitySetup` al role después del rechazo IAM inicial. La política acotada está en `infra/iam-policy-cloudwatch-setup.json`; la política de entrega de logs del agente está en `infra/iam-policy-cloudwatch-agent.json`.

Configuración del agente: `/opt/aws/amazon-cloudwatch-agent/etc/spookython.json`.
Para repetir la configuración: `python3 infra/cloudwatch-notifications.py CORREO_DEL_OPERADOR`.
El script evita crear otra suscripción para el mismo correo y conserva las demás reglas de la política del tema.

Los access logs de Caddy permanecen dentro del contenedor y no están incluidos en el agente del host.

Verificación final: las cuatro alarmas estaban en `OK`; p95 publicado de 72 ms y fallos de persistencia 0. CPU y salud tenían muestras reales. SNS registraba tres notificaciones entregadas en los periodos observados. Estos valores describen la telemetría vigente; no representan una nueva prueba de carga.
