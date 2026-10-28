# Centro de mando: rediseño local para revisión

Fecha: 28 de octubre de 2026. Rama revisada: `prueba`. HEAD al inicio y al cierre: `c7afe382400e2ee30d97460ac4c0b063cf91f3d7`.

## Auditoría y alcance

La referencia histórica `main / 1ef3804` ya no representa este checkout. Los cinco commits revisados fueron `c7afe38`, `1622bb4`, `9be82a0`, `3df3eed` y `68029de`. No se encontró `AGENTS.md` en el repositorio. Se consultaron SPEC §§2.2, 3.3–3.4 y 6, `docs/team/contexto_equipo.md`, la guía de ownership de Kristhian, los DTO públicos, los controles y las pruebas existentes. Algunas notas históricas de ownership aún describen `/estado` como 503; la implementación y SPEC vigentes ya usan 200 idle.

El HTML proporcionado se leyó y visualizó como referencia. Se adaptó la propuesta 01 (mapa despejado) y la barra de estado y pausa de la 03. La propuesta 02 queda como referencia futura; no se implementó una bandeja avanzada de incidentes ni se copiaron nombres, cifras o geometrías ilustrativos.

Ya existían: cookie httpOnly de operador, inicio con gameId/semilla automáticos, reanudación sin semilla en el request, capas de cierres por segmento, catálogo de nombres OSM vinculado a graphVersion, resaltado de selección, 200 idle y WebSocket con reconexión. `LiveMap.tsx` y el nuevo archivo aún sin seguimiento `MantaMapArea.tsx` contenían los límites locales de la tarea anterior: se conservaron y completaron. Los logs y capturas previos de `.playwright-mcp` no se tomaron como cambios de producto.

No se modificaron backend, DTO públicos, datos, reglas, presets, tiempos, dependencias ni infraestructura. No se hicieron commits, push o despliegues. Esta revisión no acredita el estado de producción.

## Implementación por pasos

1. Auditoría: contratos, ownership, árbol de Git, HTML y grafo.
2. Estructura responsive: barra compacta, mapa principal, tres indicadores visibles y panel plegable. En móvil, el panel aparece debajo del mapa y se abre con un botón, sin exigir arrastre.
3. Mapa: se completó la adaptación a cambios de tamaño del contenedor; se corrigió la altura de Leaflet en móvil y el recálculo de zoom mínimo al pasar de escritorio a móvil.
4. Selección: un único identificador compartido entre mapa, explorador accesible, detalle y gestión de segmentos. Se conserva al actualizar turnos y se reconcilia al cambiar de partida/grafo o desaparecer la entidad.
5. Eventos y métricas: recibos locales, cierres observados, detecciones simuladas y detalles técnicos plegables. Se retiró la aproximación local de disponibilidad de routing.
6. Verificación: pruebas automatizadas, navegador en escritorio/móvil, teclado, controles reales contra un backend local aislado, capturas y revisión del resultado.

## Datos que utiliza la interfaz

| Área | Fuente y tratamiento |
|---|---|
| Barra superior | `roundId`, `turnId`, `status`; total normativo 150. La conexión usa `socketStatus`, de forma independiente al estado de partida. |
| Indicadores principales | `metrics.activeSurvivors`, `evacuatedSurvivors`, `bittenSurvivors`. Sin snapshot, “Sin dato”. |
| Sobreviviente | `id`, `estado`, `targetShelterId`, `nodeId`. Desplazamiento lógico solo entre turnos consecutivos de la misma partida/grafo y con la entidad en ambos; no se infiere arista, ruta futura ni motivo de espera. |
| Segmento | Aristas de `graph.aristas` agrupadas por `segmentoId`, nombres del catálogo existente únicamente si coincide graphVersion, zonas de ambos extremos. `blockedEdges` aporta estado, motivo y turno del cierre activo. ID técnico accesible. |
| Refugio | Ocupantes, capacidad y reservas del snapshot; cupos sin reservar = capacidad − ocupantes − reservas. Sin snapshot no se inventa ocupación. La capacidad estática del grafo se puede mostrar antes de iniciar. |
| Eventos | Solicitudes locales y respuesta contractual 202, cierres del snapshot, `cameraObservations` con cámara/nodo/turno de detección/vencimiento exclusivo. |
| Métricas secundarias | Percentil p95, disponibilidad, timeouts, rutas inválidas, zombies activos, duración y deadlines publicados por el backend, además de identificadores/versiones. Si falta un valor o no es finito, “Sin dato”; no se aproxima. |

La sesión y handlers se extrajeron a `useOperatorControls`: la barra superior y el panel usan la misma instancia. Solo hay un botón de Pausar/Reanudar y se ofrece según el estado y autorización. Reanudar envía `{gameId, roundId}`; no solicita ni publica la semilla conservada por el servidor. Se conserva el mecanismo de acceso de demostración preexistente; no se agrega ninguna x-api-key al frontend.

El cierre/apertura mantiene el endpoint existente `/simulador/bloquear-arista`. En pausa, ese contrato exige `effectiveTurnId`: se envía el siguiente turno y se explica que espera a la reanudación. Una selección no envía controles. Un 202 queda **Programado**, no “aplicado”. Al observar el estado esperado a partir del turno objetivo, el recibo indica **Estado esperado observado**, con una aclaración de que el snapshot no publica eventId. Esto no atribuye causalidad a ese comando. Los errores/conflictos se conservan en el recibo; no se convierten en observación.

Los recibos son RAM local del navegador: hasta 50 por partida, sin persistencia tras recarga. Se limpian al cambiar de partida o grafo; respuestas tardías de otra partida no recrean recibos. Una observación ya registrada conserva su turno como evidencia histórica aunque después cambie el estado del segmento.

Las alertas de cámaras se identifican como simuladas, no video. Se conserva la cobertura simulada existente; el nodo observado se marca como un punto, sin dibujar un radio bloqueado. Plegar paneles no modifica observaciones ni cámara alguna.

## Diagnóstico y límites del mapa

Artefacto: `frontend/public/data/grafo_manta.json`, igual al de backend. SHA-256 en ambos:
`7c010a06aef690403e9578cdbfc7cddafcac2102e9dc88a2dc28a03f33ce3b73`.

Validación existente del grafo: 300 nodos, 736 aristas, cuatro refugios, capacidad total 240, un componente fuertemente conectado y acceso a todos los refugios desde todos los nodos.

Extensión por mínimos/máximos de los **300 nodos**, sin excluir coordenadas:

| Límite | Coordenada |
|---|---:|
| Sur | −0.9653992 |
| Norte | −0.9481941 |
| Oeste | −80.7478661 |
| Este | −80.6914799 |

| Refugio | Latitud | Longitud |
|---|---:|---:|
| R-BARBASQUILLO | −0.9531202 | −80.7458938 |
| R-ESTEROS | −0.9558038 | −80.6934617 |
| R-JOCAY | −0.9628602 | −80.7147381 |
| R-TARQUI | −0.9507028 | −80.7162290 |

Las tres cámaras habilitadas (Inepaca, calle 113/avenida 108 y J16/J11) tienen nodos asociados del grafo. La referencia de Paquisha está deshabilitada, en −0.98971, −80.70633, sin nodo asociado; no amplía el encuadre. No se detectaron coordenadas no finitas ni refugios con referencias inexistentes. Esta comprobación no inventa una delimitación administrativa ni cambia la interpretación aproximada de las cámaras.

Se utiliza la extensión del grafo para el encuadre, con 24 px de margen; `maxBounds` añade 8 % por lado y `maxBoundsViscosity=1`. El zoom mínimo se calcula para el tamaño real con 48 px totales de holgura; se descartan tamaños cero y se elimina el límite mínimo anterior antes de recalcularlo para una pantalla más estrecha. El máximo se fija en 19 tanto en mapa como capa OSM; `noWrap` evita copias del mundo. La etiqueta dice **Escenario de simulación de Manta** y se mantiene la atribución.

Un `ResizeObserver` actualiza el tamaño de Leaflet al abrir/cerrar paneles o cambiar la pantalla. No se vuelve a encuadrar con cada snapshot. el botón de encuadre **Mostrar todo el escenario de Manta** restaura la vista general. La selección puede acercar la vista una sola vez; el resaltado sigue actualizándose sin recentrar en cada turno. Se conserva la comprobación de graphVersion.

## Archivos

Modificados:

- `frontend/src/app/App.tsx`: composición, panel plegable, explorador y errores.
- `frontend/src/components/ConnectionStatus.tsx`: conexión compacta, independiente de partida.
- `frontend/src/components/EntityLegend.tsx`: acceso compacto y preferencia de plegado existente.
- `frontend/src/components/LiveMap.tsx`: selección de entidades/aristas, punto observado y límites/capas.
- `frontend/src/components/SelectedSegment.tsx`: etiqueta legible del tramo.
- `frontend/src/components/MetricsPanel.tsx`: indicadores principales y métricas secundarias sin estimaciones.
- `frontend/src/components/RoundControls.tsx`: presentación de los controles compartidos y acción de segmento.
- `frontend/src/components/ShelterOccupancy.tsx`: selección y ocupación desconocida explícita.
- `frontend/src/state/world-store.ts`: selección, reconciliación y recibos por partida.
- `frontend/src/state/world-store.test.ts`: conserva las once pruebas existentes y comparte fixtures.
- `frontend/src/styles/index.css`: estructura responsive y estilos reutilizando la paleta y Manrope existentes.

Nuevos (incluye el archivo que ya estaba pendiente de seguimiento al iniciar):

- `frontend/src/components/CommandBar.tsx`
- `frontend/src/components/ContextPanel.tsx`
- `frontend/src/components/EventTray.tsx`
- `frontend/src/components/MantaMapArea.tsx`
- `frontend/src/components/MapSelectionFocus.tsx`
- `frontend/src/hooks/useOperatorControls.ts`
- `frontend/src/hooks/useSegments.ts`
- `frontend/src/lib/command-center.ts`
- `frontend/src/lib/command-center.test.tsx`
- `frontend/src/test/fixtures.ts`
- Este informe y sus cuatro capturas.

Se revisaron sin modificar los contratos públicos, `useTurnSocket`, `useInterpolatedWorld`, `entity-icons` y `tailwind.config.ts`. No se añadió una librería de interfaz ni un servicio de mapas.

## Verificación

Comandos locales completados:

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
npm run graph:validate -- frontend/public/data/grafo_manta.json
git diff --check
```

Resultado: **27/27 pruebas**, typecheck, lint y build correctos. Once pruebas nuevas cubren preservación/limpieza de selección, segmento cerrado seleccionado, recibos programados/observados/errores, respuesta tardía de otra partida, límite de retención, desplazamientos consecutivos, datos faltantes, conexión independiente de partida y acciones de operador según estado.

Pruebas de navegador contra `localhost:5180` → backend `localhost:3010`, persistencia en memoria, origen local explícito; no se usó producción:

- Escritorio 1440×1000 y móvil 390×844, panel abierto/cerrado, mapa visible y sin desbordamiento horizontal móvil.
- Mínimo de zoom y restauración; recálculo al pasar entre escritorio y móvil.
- Selección de persona por marcador y explorador, refugio con 4 ocupantes/60 plazas/0 reservas/56 cupos en el snapshot de prueba, segmento sincronizado con su control.
- Misma selección y geometría/tiles de vista antes/después de un nuevo turno; sin reinicio de zoom.
- Una sola acción de pausa/reanudación; reanudación conserva gameId y no envía seed.
- Cierre programado desde pausa, estado esperado observado al reanudar y apertura posterior por el mismo endpoint; cierres rojos destacados y selección cian.
- Detección simulada real del backend local con nodo y vencimiento visible en la bandeja.
- Apertura/cierre del panel con Enter y `aria-expanded` correcto, controles etiquetados y foco visible; selección no fuerza foco al recibir snapshots.
- Cero errores de consola/runtime y cero respuestas HTTP fallidas en el recorrido corregido autenticado. Durante la auditoría se reprodujo un 400 al omitir el turno efectivo en pausa; se corrigió y se repitió el recorrido con éxito. Sin sesión, el GET de comprobación sigue respondiendo 401 por diseño; no se ha ocultado ni relajado la autenticación.

Capturas locales revisadas visualmente:

- [Escritorio con panel y señales](desktop-panel.png)
- [Escritorio con mapa despejado](desktop-map.png)
- [Móvil con mapa despejado](mobile-map.png)
- [Móvil con panel inferior](mobile-panel.png)

Las capturas muestran únicamente la partida local de prueba. Tras recargar, los recibos locales desaparecen y permanecen los cierres/observaciones que sí publica el snapshot.

## Limitaciones y pendientes

- El snapshot no identifica el eventId causante de un cierre ni publica la cola completa de eventos programados. La UI solo puede observar coincidencia de estado; la correlación causal requeriría un contrato futuro explícito y queda fuera de este cambio.
- No se publica ruta futura ni explicación individual de espera. Se muestra posición y, cuando procede, diferencia lógica entre dos turnos consecutivos.
- El escenario es la extensión del grafo actual, no toda la superficie municipal. Puede verse contexto cartográfico alrededor por la relación de aspecto; todos los nodos y refugios permanecen en el mundo y accesibles.
- Los recibos no son un historial persistente de servidor. La propuesta 02, edición de cámaras/coberturas y trazabilidad alerta→cierre siguen pendientes.
- Se conserva la interpolación existente; el detalle del sobreviviente aplica la regla más restrictiva de turnos consecutivos para describir movimientos, sin alterar simulación o cadencia.
- Las comprobaciones de teclado son básicas; no equivalen a una auditoría completa con lector de pantalla.

## Revisión manual

En la ejecución local habitual, conserva el backend y las URLs que ya configuraste. El rediseño no requiere cambiar puertos. Recarga el frontend; si lo habías detenido, ejecuta `npm --prefix frontend run dev -- --strictPort` con las variables de URL locales correspondientes.

1. Comprueba que **Conectado** puede coexistir con **Sin iniciar** o **Pausada**.
2. Abre el panel, accede como operador e inicia una ronda local.
3. Selecciona una persona/refugio en el mapa o mediante **Explorar en el mapa**.
4. Selecciona un segmento, revisa el detalle y el resaltado cian, escribe un motivo y solicita un cierre.
5. Abre **Eventos y señales**; distingue programado de observado. En pausa, reanuda para que avance el turno efectivo.
6. Comprueba la apertura del mismo segmento y que reanudar conserva la partida.
7. Pliega el panel y usa el botón de encuadre **Mostrar todo el escenario de Manta**. Repite en una pantalla estrecha y con teclado.

Los cambios quedan sin commit para revisión.

## Ajuste posterior: control de encuadre compacto

Se sustituyó el botón textual inferior por un control de 44×44 px, con icono de encuadre, justo debajo de +/−. Mantiene la restauración de bounds, título explicativo, nombre accesible y activación con Enter/Espacio. Typecheck y lint correctos; se comprobó en navegador que restaura la vista y no duplica controles. Las cuatro capturas anteriores documentan la primera iteración del rediseño, previa a este ajuste.
