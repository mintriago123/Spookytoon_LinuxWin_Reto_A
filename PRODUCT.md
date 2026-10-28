# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Usuario principal: el operador del equipo (uno de los tres desarrolladores) que corre la simulación en vivo durante la presentación de SpookyThon 2026 — inicia/pausa rondas, bloquea/desbloquea segmentos de vía, y lee el estado del juego en tiempo real desde un navegador de escritorio o móvil. Pega su `x-api-key` en memoria para cada sesión; nunca se persiste ni viaja en el bundle.

Audiencia secundaria: los jueces de SpookyThon 2026 (Track A), que observan la pantalla del operador durante la demo para evaluar el sistema, sin tocar los controles directamente. El dashboard se diseña primero para el operador; la claridad para quien mira por encima del hombro es una consecuencia de esa precisión, no el objetivo primario.

## Product Purpose

Dashboard operativo en tiempo real de "Escape de Manta Zombie": visualiza y controla una simulación de evacuación ante un brote zombie sobre el grafo real de la ciudad de Manta (Ecuador). El Backend es la única autoridad sobre rutas, mordidas y evacuaciones; el Frontend nunca decide — solo refleja fielmente cada snapshot del motor de simulación y expone los controles de ronda que el SPEC.md autoriza al operador.

Éxito = demostrar, con datos reales y en vivo, que el sistema completo (grafo real + motor de rutas + simulador por turnos + frontend) cumple el contrato normativo de SPEC.md durante las tres rondas de la demo, sin estimaciones ni capturas ficticias como evidencia.

## Positioning

A diferencia de una animación guionizada o mockeada, cada movimiento, mordida y evacuación que se ve en el mapa proviene de un motor de rutas real (Dijkstra inverso por `worldVersion`, `bestMoveByNode` O(1)) corriendo sobre un grafo real de Manta extraído de OpenStreetMap (300 nodos, 736 aristas, un solo componente fuertemente conexo, cuatro refugios alcanzables desde cualquier nodo). El Frontend es deliberadamente "tonto": nunca calcula ni decide, solo visualiza con fidelidad el estado autoritativo del Backend — esa separación estricta es la garantía de que la demo no puede mentir.

## Operating Context

- Evento: SpookyThon 2026, Track A — hackathon con demo en vivo ante jueces; "la demo debe mostrar movimiento real, eventos de ciudad, refugios, métricas y recuperación de WebSocket" (docs/launch-checklist.md).
- Equipo de 3 con límites de ownership estrictos definidos en SPEC.md §7: Michael (graph/routing/infra AWS), Maykel (simulator/realtime), Kristhian (frontend/UI) — el dueño de este dashboard.
- SPEC.md es el contrato técnico canónico; OpenAPI, tipos y validadores son proyecciones de ese archivo, no al revés.
- Tres rondas con configuración fija y progresiva: R1 (20 sobrevivientes, solo zombies caminante), R2 (80 sobrevivientes, +corredor/horda, un puente colapsa en vivo), R3 (200 sobrevivientes, los cuatro tipos de zombie, dos calles se bloquean en vivo). 150 turnos de 2.000 ms cada uno, serializados.
- Despliegue objetivo: Frontend estático en S3 + CloudFront; Backend en ECS Fargate detrás de ALB con TLS; WSS y GET /estado son de solo lectura y CORS se limita al dominio configurado. Backend de producción ya operativo en `https://3-128-78-190.sslip.io` (HTTPS) / `wss://3-128-78-190.sslip.io/ws`.
- Repo monorepo con npm workspaces (`backend/`, `frontend/`); rama `design` es donde convergen los tres módulos antes de desplegar.

## Capabilities and Constraints

- El Frontend NUNCA decide rutas, mordidas ni evacuaciones — solo refleja el snapshot más reciente del Backend (restricción dura de SPEC.md §6, no negociable).
- La `x-api-key` del operador nunca se incluye ni se persiste en el bundle del navegador; vive solo en memoria de la sesión.
- Si `graphVersion` del snapshot no coincide con el grafo cargado, el Frontend no debe dibujar entidades y debe mostrar un error de recuperación explícito.
- Reconexión de WebSocket con backoff (1, 2, 4, 8, 16 s, máx. 30 s); al reconectar, reconciliar vía `GET /estado` antes de seguir interpolando.
- Interpolación visual entre snapshots dura 1.800 ms + 200 ms de pausa; nunca altera el estado lógico ni duplica movimientos ya aplicados.
- Accesibilidad funcional: la información nunca depende solo del color (cada tipo/estado de entidad tiene también una forma distinta); interfaz usable en escritorio y móvil.
- Componentes obligatorios por contrato: LiveMap, RoundControls, MetricsPanel, ConnectionStatus, EntityLegend (SPEC.md §6).
- Persistencia en DynamoDB todavía sin implementar en ninguna rama (fuera del alcance del Frontend, pero afecta qué tan "real" puede ser la recuperación ante caída que se demuestre).

## Evidence on Hand

- `SPEC.md` — especificación normativa v1.0, fuente de verdad técnica.
- `docs/team/kristhian/README.md` — alcance exacto asignado al dueño de este Frontend.
- `docs/launch-checklist.md` — prioridades y criterios de aceptación de la demo.
- `docs/Budget.png` — captura real de AWS Budget (zero-spend, $1); `docs/costos.md` aún sin conciliar región/horas/configuración.
- Boceto de diseño del equipo: export de artifact de claude.ai ("Manta Zombie Frontend.html") con 5 páginas de mockup; el equipo trabajó más la dirección "D" ("Navegación tipo Waze"). Decisión ya tomada esta sesión: aplicar solo el lenguaje visual de esa dirección (paleta nocturna, tipografía, iconografía) al dashboard operativo existente de "todas las entidades", no el concepto de navegación de un solo sobreviviente. El sistema visual resultante aún no está documentado en DESIGN.md.
- Grafo real de Manta ya publicado y validado (`backend/data/grafo_manta.json`, mismo `graphVersion`/SHA-256 también en `frontend/public/data/`).

## Product Principles

1. El Frontend es un espejo fiel del Backend, nunca un segundo árbitro: ante cualquier ambigüedad de diseño, gana la lectura literal de SPEC.md sobre la conveniencia visual.
2. La demo debe sostenerse con datos reales de principio a fin — ninguna pantalla, métrica o estado se simula o se maquilla para verse mejor ante el jurado.
3. El operador necesita confianza bajo presión de demo en vivo: estados de error, reconexión y desajuste de versión deben ser legibles de inmediato, no ambiguos.
4. La seguridad del operador es parte del producto: ninguna clave ni secreto puede llegar al bundle o persistirse fuera de la memoria de la sesión.
5. El progreso de las tres rondas (20 → 80 → 200 sobrevivientes, complejidad de zombies creciente) es la narrativa central que la interfaz debe dejar legible turno a turno.

## Accessibility & Inclusion

La información del mapa y los paneles nunca depende solo del color: cada tipo y estado de entidad (sobreviviente, zombie, refugio) tiene también una forma/glifo distinto. La interfaz debe ser utilizable tanto en escritorio como en móvil, dado que el operador puede correr la demo desde cualquiera de los dos.
