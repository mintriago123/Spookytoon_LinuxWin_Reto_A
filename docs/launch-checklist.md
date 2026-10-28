# Checklist de lanzamiento y demo

Estado revisado contra `EZMayk` en `05d6145`. Marcar una puerta como completada solo con evidencia reproducible; los presets generados actuales no equivalen a escenarios oficiales aprobados.

| Área | Responsable(s) | Estado actual | Próxima evidencia requerida |
|---|---|---|---|
| Grafo y routing Base | Michael | Implementados y conectados al servidor del simulador. El grafo versionado tiene 300 nodos, 736 aristas y cuatro refugios. El benchmark sintético documentado sigue siendo una medición del motor, no del escenario final. | Integrar la política `.gitattributes` propuesta en `origin/design` y verificar manifiesto/checksum en Windows; volver a ejecutar validación de grafo y pruebas afectadas. |
| Game loop, controles y realtime | Maykel | `SimulationRuntime`, coordinación HTTP con routing, controles, `GET /estado` y `WS /ws` están ensamblados en `backend/src/server.ts`. | Aceptación con configuraciones de ronda aprobadas y ejecución de 150 turnos con reloj real. |
| Presets R1/R2/R3 | Maykel + equipo | `backend/src/config/round-presets.ts` genera presets deterministas y el servidor los activa por defecto. Las cantidades zombie y la distribución son valores de implementación sin aprobación documentada ni fuente censal. | Confirmar/ajustar cantidades, composición, spawns y eventos; documentar fuente y aprobación antes de llamarlos oficiales. |
| Telemetría de turno | Michael + Maykel | `updateTurnMetrics()` y métricas de clientes WS están integradas. Backend registra pruebas para métricas y smoke tests; su resultado no acredita aún el SLA de producción. | Medir las rondas aprobadas en el entorno final, con muestras, timeouts y deadline misses. |
| Integración de backend | Michael + Maykel | `backend/tests/RESULTS.md` registra 12 pruebas aprobadas, incluyendo smoke tests HTTP/WS de tres turnos por ronda con reloj real. La Etapa 8 sintética anterior usa fixture de grafo ficticio. | Ejecutar aceptación completa con grafo validado, escenarios aprobados y 150 turnos; repetir en entorno de despliegue. |
| Frontend y demo | Kristhian + equipo | La rama revisada contiene el grafo público; la integración del frontend con los endpoints y los controles debe confirmarse en la rama de trabajo compartida. | Verificar mapa, reconciliación GET/WS, reconexión y controles con el backend actual; probar URL externa y preparar video de respaldo. |
| Persistencia y despliegue | Michael | Persistencia DynamoDB, recuperación pausada, presupuesto/alarma AWS y despliegue final siguen pendientes según el estado revisado. | Acordar región, configurar Budget/alarma, completar persistencia/telemetría de operación y documentar costos/rollback. |
| Datos demográficos de Manta | Equipo; coordinación de Maykel | No hay datos censales integrados al repo. | Investigar Censo 2022 INEC y documentos GAD para proponer distribución espacial de sobrevivientes. Tratar focos de infección como hipótesis narrativa separada. |

## Puertas de aceptación

1. No presentar los presets actuales como escenario oficial hasta que el equipo apruebe sus valores. SPEC §5.1 establece que las cantidades y posiciones del escenario no deben inventarse.
2. Verificar el grafo y el SHA-256 del manifiesto en el checkout de Windows antes de basar la aceptación en `createBackendApp()`.
3. Medir 20, 80 y 200 sobrevivientes con las configuraciones aprobadas. La evidencia actual de smoke tests cubre tres turnos reales por ronda, y las mediciones de fixtures sintéticas no prueban SLA ni cadencia real de cinco minutos.
4. Para declarar el objetivo de routing, medir p95 ≤150 ms con hasta 200 decisiones concurrentes y timeout individual de 500 ms en el entorno objetivo.
5. Confirmar que HTTP y WS publican el mismo snapshot comprometido, y que pausas/reanudaciones con igual turno y versión se reflejan correctamente.
6. Confirmar región, Budget y alarma antes de encender recursos ECS/ALB; probar URL pública desde una conexión externa.
7. La demo debe enseñar movimiento, eventos de ciudad, refugios, métricas y recuperación de WebSocket. El video debe cubrir la ruta crítica sin red.

## Bloqueos de decisión/datos

- Aprobación de cantidades y spawns de zombies/sobrevivientes y turnos de eventos para R1, R2 y R3.
- Fuentes espaciales oficiales para orientar la distribución de sobrevivientes; no inferir brotes únicamente desde densidad residencial.
- Integración y verificación de `.gitattributes` para evitar divergencia LF/CRLF y checksum en Windows.
- Región, límite de Budget y contacto de alertas AWS.
- Estado/URL del frontend integrado, dominio de API y responsable de la aprobación final del escenario.


## Actualización de integración — 28 de octubre de 2026

La [evidencia de integración](evidence/integracion-2026-10-28/README.md) actualiza
las observaciones históricas de la tabla anterior:

- Michael: persistencia DynamoDB real, recuperación pausada, workers de precompute,
  readiness previo a partida y OpenAPI implementados. Release `a09f235` desplegada
  por PM2/Node 24.22.0 en EC2 Ohio, un escritor online y sin reinicios durante el
  ciclo final. Caddy HTTPS/WSS operativo. Artefactos de CloudWatch versionados;
  Agent/alarmas no se instalaron durante esta aceptación.
- Maykel: rama integrada hasta `3972b8f`; fixtures adaptados al cálculo/publicación
  por ventanas absolutas. Suite de raíz 172/172 y backend 32/32, ambos typechecks
  aprobados. Tres rondas reales de 150 turnos completadas, eventos en vivo y
  manifiestos finales confirmados en DynamoDB.
- Kristhian: `origin/design@6afb9a1` probado en copia temporal: 11 tests, typecheck,
  build y Chromium con backend local/EC2; CORS y WSS reales. No se fusionó ni
  modificó frontend y no se publicó su build en EC2.
- SLA de rutas final: máximos p95 R1/R2/R3 26,4 / 50,1 / 89,3 ms, disponibilidad
  100 %. La regularidad estricta de cierre no queda certificada: un deadline miss
  en R2 turno 138, con pausa/reanudación conservada en la evidencia. No se relajó
  la tolerancia de 10 ms ni se descartaron muestras.
