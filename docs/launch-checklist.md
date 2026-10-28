# Checklist de lanzamiento y cierre

Estado vigente: cierre integrado del 28 de octubre de 2026. Rama final de
integración: `prueba`; destino aprobado: `main`.

| Área | Evidencia | Estado |
|---|---|---|
| Grafo y routing | 300 nodos, 736 aristas, cuatro refugios; SHA-256 compartido; lookup local y precompute en workers | Verificado |
| Backend, contratos y readiness | 38 pruebas en EC2, typechecks y OpenAPI | Aprobado |
| Frontend | Web HTTPS publicada, 11 tests, typecheck/build/lint y Chromium escritorio/móvil | Aprobado |
| Rondas | R1/R2/R3 de 150 turnos; p95 máximo 37,2 / 50,3 / 85 ms; disponibilidad 100 %; cero deadline misses | Aprobado |
| HTTP y WS | 453 snapshots coincidentes, controles y reconexión | Verificado |
| Eventos y cámaras | Un puente en R2, dos calles en R3; tres sensores simulados habilitados de cuatro referencias | Verificado |
| Persistencia | Turno 150 de las tres rondas confirmado en DynamoDB; recuperación pausada | Verificado |
| Despliegue y rollback | Artefactos por commit/checksum, validación previa al corte y restauración conjunta; 12 pruebas de fallos | Implementado y probado |
| Observabilidad | CloudWatch Agent, cuatro alarmas y SNS con suscripción confirmada | Operativo |
| Costos | EBS real medido y estimación reproducible; Billing/Budget denegados por IAM | Conciliación financiera pendiente |

Ver [evidencia completa](evidence/cierre-prueba-2026-10-28/README.md).

Los presets son escenarios versionados de simulación: no equivalen a datos
censales oficiales. Las ubicaciones/coberturas de cámaras son aproximadas y
no representan una conexión a video real. La aprobación de esas fuentes como
datos oficiales no se infiere de las pruebas técnicas.

El video, presentación, formulario y publicación pública de `/paso` quedaron
fuera de este cierre. `/paso` permanece autenticado y accesible por loopback;
no debe entregarse como endpoint público sin configurar su exposición.

Las evidencias históricas de integración y despliegue se conservan por separado.
El cierre no borra sus fallos: documenta una aceptación posterior del código integrado.
