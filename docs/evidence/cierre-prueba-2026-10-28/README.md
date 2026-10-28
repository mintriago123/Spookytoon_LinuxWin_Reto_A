# Cierre integrado de prueba — 2026-10-28

Web: https://3-128-78-190.sslip.io

Fuente de aceptación: `ef8cf79dab18f782d00329cd52611986608b343b`.
Frontend y backend se desplegaron juntos mediante el nuevo comando
`bash infra/deploy-release.sh COMMIT`, con build web local, artefactos por
SHA-256/commit, grafo idéntico y pruebas de backend previas al corte.
Los cambios posteriores al ensayo son de infraestructura, pruebas y documentación;
no cambian código del simulador, routing, frontend ni sus dependencias.
El informe de recuperación final identifica el commit de release activo.

## Pruebas y comportamiento

- Raíz: 177/177; backend en EC2: 38/38; frontend: 11/11.
- Typechecks raíz/backend/frontend, build y lint del frontend aprobados.
- Infraestructura: 12/12 casos sin red ni credenciales: corrupción, commit/grafo
  incompatibles, rutas/enlaces inválidos, fallos antes del corte, readiness,
  recarga Caddy, HTML público inválido, rollback fallido, repetición, lock y Node incompatible.
- Chromium comprobó escritorio/móvil, mapa, cámaras y actualizaciones WS, sin errores JavaScript.

## Rondas completas por HTTPS/WSS

| Ronda | Sobrevivientes | Turnos | Tiempo observado ms | Máximo p95 ms | Disponibilidad | Deadline misses | Bloqueos | DynamoDB turno 150 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 20 | 150 | 299999 | 37.2 | 100 % | 0 | 0 | Sí |
| 2 | 80 | 150 | 300005 | 50.3 | 100 % | 0 | 1 | Sí |
| 3 | 200 | 150 | 300008 | 85 | 100 % | 0 | 2 | Sí |

Los 453 snapshots HTTP/WS coincidieron. Las tres rondas terminaron con cero
timeouts, respuestas inválidas y errores de routing. Se verificaron capacidad
de refugios, movimientos, objetivos y cuatro referencias de cámara (tres habilitadas).
R2 aplicó un colapso de puente; R3 dos bloqueos de calles. El reloj mantuvo
sus parámetros existentes: no se relajó la tolerancia de cierre ni se modificó
el simulador. No hicieron falta reanudaciones durante esta aceptación.

`cierre-rounds.json` conserva las 453 observaciones; `cierre-rounds.log` los hitos.
`summary.json` contiene el resumen verificable. Las evidencias anteriores con
incidencias permanecen en los directorios históricos; no se sobrescribieron.

## Operación y costos

Despliegue/rollback conserva pares frontend/backend/Caddy mediante manifests,
con un solo escritor. El frontend estático se monta de solo lectura; certificados,
API key y tabla DynamoDB se conservan. Los filtros/alarmas de CloudWatch permanecen
configurados. `/paso`, `/motor/*` y `/health/*` siguen internos.

EBS real: 8 GiB gp3, 3.000 IOPS, 125 MiB/s. La estimación base de 730 horas,
IPv4, EBS, cuatro alarmas y dos métricas es US$12,882/mes antes de servicios
variables y créditos; ver CSV y `docs/costos.md`. No es una factura ni una
exportación de Pricing Calculator. El role no puede leer Billing/Budget:
importe facturado y destinatarios del Budget quedan pendientes de conciliación
por una identidad de facturación. No se ampliaron permisos del role en esta entrega.

La documentación operativa contiene los comandos de despliegue, rollback y
consultas financieras. No se incluyen claves AWS ni la API key en estos artefactos.
