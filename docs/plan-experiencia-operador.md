# Experiencia del operador: revisión y plan incremental

## Base y alcance de esta ejecución

- Inicio: rama `prueba`, HEAD `0ca1c5093133439fc13104ef87ff2684b6bf623c`, árbol limpio.
- Commits recientes: `0ca1c50` nombres de calles, `a922a69` capa de cierres,
  `cb6e2b9` identidad automática, `5141c7b` reanudación sin reenviar semilla,
  `2928607` integración de sesión y `52488f1` protección de origen de cookies.
- El `main` local apunta a `3df3eed`, con la integración posterior de `design`
  (`11df866`, `68029de`). No se cambia de rama ni se importan esos cambios en esta tarea.
  En particular, el parser cerrado de login y los ajustes móviles de ese main
  no están en este HEAD de prueba. Esta distinción evita declarar su verificación aquí.
- Todas las 39 rutas enumeradas en la sección B de la solicitud existen.
  Se revisaron documentos, contratos, consumidores y pruebas representativas.
- No hay AGENTS.md dentro del repositorio. Existe `/home/mintriago/dev/AGENTS.md`:
  sus instrucciones se refieren a Next.js; este proyecto usa React/Vite y no contiene Next.js.
- Autorización: implementar solo etapa 1; sin commits, push, despliegues ni AWS.
  Los revisores propuestos abajo no equivalen a aprobaciones del equipo.
- El producto es una simulación. Los presets no necesitan datos censales para
  servir como escenarios sintéticos; eso no equivale a aprobación de escenarios oficiales.

## Matriz de capacidades inicial

Estado L = implementado y comprobado por lectura; P = parcial; F = faltante;
A = propuesta que requiere acuerdo. V se reserva para pruebas ejecutadas en esta entrega.
La evidencia de `docs/evidence/` es histórica y no certifica este HEAD ni producción.

| Capacidad / estado | Implementación | Contrato | Consumidor | Pruebas existentes | Brecha |
|---|---|---|---|---|---|
| Sesión / P | simulator/http-plugin.ts, operator-session.ts; CORS en server.ts | GET y POST /operador/sesion: 204; 401 si no autorizada | RoundControls | backend/tests/operator-session.test.ts | El cliente usa res.ok, que acepta HTML 200; falta regresión cliente |
| Identidad / L | simulation-runtime.ts, controls.ts; plugin completa seed omitida | ReanudarRequest: gameId, roundId, seed opcional | RoundControls usa identidad del snapshot | persistence.test.ts, simulator-runtime.test.ts | No rehacer la solución existente; documentación antigua aún describe semilla obligatoria |
| Programar cierre/apertura / P | scheduleEdge en turn-coordinator.ts, city-events.ts | BloquearAristaRequest/Response; 202 programado | RoundControls, LiveMap | simulator-events.test.ts, simulator-segments-e2e.test.ts | Recibo descartado; pausa no envía turno explícito |
| Observación de cierres / P | world-snapshot.ts; HTTP/WS desde commit | WorldSnapshot.blockedEdges sin eventId ni pendientes | world-store, LiveMap | realtime.test.ts, world-store.test.ts | No existe correlación pública exacta de evento; no confundir coincidencia con ejecución |
| Grafo/mapa / L-P | graph/, artefactos iguales; LiveMap usa bounds y Pane de cierres | Grafo cerrado con graphVersion/hash | mapa y catálogo de nombres por versión | graph.test.ts; sin pruebas DOM de mapa | Sin maxBounds/zoom mínimo/botón de recuperación; etapa 2 |
| Presets / L-P | round-presets.ts, round-validation.ts, world-state.ts | IniciarRequest solo identidad/ronda/seed | selector R1/R2/R3 | rounds-metrics.test.ts, simulator-state.test.ts | Sin consulta previa de configuración ni validación sin mutación; etapa 3 |
| Selección múltiple / F | Marcadores individuales en LiveMap | Sin grupo autoritativo | mapa | sin suite de selección | Etapa 4, solo selección visual |
| Orientar grupos / A | Reservas y reservedPlans ya existentes | Sin comando de grupo | routing y survivor-resolution | routing.test.ts, simulator-survivors.test.ts | Política completa/parcial y atomicidad requieren acuerdo; etapa 5 |
| Historial/explicación / P | Eventos internos y métricas; snapshots completos | Sin orden público, autor ni decisiones finales por entidad | paneles de métricas | simulator-events, routing-sync, realtime | Recibos locales no son auditoría del servidor; etapa 6 |
| Sincronización / L | routing-world.ts, routing-sync.ts; instalación y validación en escritores | WorldSyncRequest/PasoRequest | routing, turn-coordinator, survivor-resolution | simulator-routing-sync.test.ts, simulator-http-failures.test.ts | Mantener espera cuando sync no se confirma; sin cambios en etapa 1 |
| Cámaras actuales / L | camera-surveillance.ts tras movimiento zombie; routing evita observaciones vigentes | cameras/cameraObservations, TTL exclusivo | LiveMap, routing | backend/tests/cameras.test.ts | No modificar detector, cobertura, TTL ni efectos actuales |
| Persistencia/recuperación / L-P | persistence/, cola asíncrona y recovery.ts | StoredGame y checkpoint interno | runtime/servidor | backend/tests/persistence.test.ts | 202 no acredita durabilidad; recovery sustituye catálogo de cámaras por fixture actual: revisar en etapa 7 |
| Proxy/configuración / L-P | infra/Caddyfile incluye /operador/*; Vite sin proxy | cookies, CORS, URL API/WS del cliente | navegador | infra/tests/test_release.py; evidencia histórica | En desarrollo hay que suministrar URLs API/WS; esta lectura no prueba proxy real |

## Inconsistencias y límites encontrados

1. Al inicio RoundControls reconocía cualquier res.ok como sesión válida; contrato exige 204.
   Corregido en esta entrega.
2. Al inicio el cierre retornaba 202 con eventId/segmento/turno, pero el cliente descartaba
   el recibo. Corregido en esta entrega; el mundo aún puede no haber alcanzado ese turno.
3. En pausa scheduleEdge exige effectiveTurnId. El formulario ofrece cerrar/abrir,
   pero no lo envía. El mínimo del servidor depende además de si hay un turno ocupado:
   committed.turnId + 1 o + 2. El cliente solo puede sugerir; no conocer esa fase privada.
4. La lista de cierres está dentro de controles autenticados y desaparece en completed.
   El mapa sí tiene capa independiente de auth; no se atribuye ausencia visual al mismo motivo.
5. blockedEdges contiene un intervalo por segmento; un nuevo bloqueo puede reemplazar
   el intervalo anterior. pendingCityEvents no forma parte del snapshot público.
6. La API de cierre no incluye gameId. Se pueden aislar respuestas y recibos en el
   cliente, pero no garantizar que el servidor no cambió de partida durante el transporte.
   Resolver esa carrera en servidor requeriría un acuerdo contractual posterior.
7. Los textos de contexto/ownership conservan referencias antiguas a recuperación no
   implementada, censos, comandos y métricas pendientes. El código y la evidencia posterior
   muestran implementaciones. No se reescriben las fuentes normativas en esta entrega.
8. Los tipos frontend conservan comentarios de métricas no integradas y campos opcionales
   que el backend actual publica. Se registra la divergencia sin ampliar el alcance.
9. Simulator/realtime pertenecen a Maykel; frontend a Kristhian; contratos, routing,
   grafo, persistencia, telemetría e infraestructura a Michael. server.ts, presets,
   artefactos y SPEC requieren coordinación; ownership de composición es compartido.
10. El parser inicial de POST `/operador/sesion` extraía `password` e ignoraba propiedades
    adicionales, aunque `OperadorSesionRequest` define `additionalProperties: false`. Corregido
    en esta entrega con validación HTTP 400; no se cambió OpenAPI.

## Plan completo antes de implementar

### Etapa 1: controles existentes claros y correctos (única autorizada)

- Objetivo/alcance: validar sesión por 204; recibos locales para cierres/aperturas;
  turno explícito en pausa; observación por snapshot de la misma partida. Alinea además el
  parser de login con el schema cerrado que ya existe.
  Excluye cambios de dominio, grafo, cámaras y durabilidad; no cambia el mecanismo de sesión.
- Situación: sesión, cookies, reanudación, nombres de calles y capas de cierres ya existen.
- Pasos: 1) validar el cuerpo de login como `{password}` exacto y verificar GET por 204;
  2) extraer frontera HTTP comprobable; 3) modelo local acotado de recibos;
  4) observar solo snapshots aceptados por el store; 5) integrar turno de pausa y estados
  visibles; 6) probar respuestas tardías, cambios de partida y errores; 7) documentar revisión.
- Archivos existentes: RoundControls.tsx, world-store.ts, simulator/http-plugin.ts,
  backend/tests/operator-session.test.ts. Archivos nuevos propuestos:
  frontend/src/lib/operator-controls.ts, frontend/src/lib/operator-controls.test.ts,
  frontend/src/state/operator-receipts.ts, frontend/src/state/operator-receipts.test.ts
  y este documento. Los recibos son estado de presentación, no DTO de dominio.
- Responsable/revisor propuesto: Kristhian; Michael revisa interpretación contractual;
  Maykel revisa semántica de turno. Sin dependencia nueva en otros módulos.
- Contratos reutilizados: 204 de sesión; BloquearAristaRequest/Response; WorldSnapshot.
  Ningún cambio de payload, endpoint o SPEC.
- Dependencias: snapshot recibido, grafo compatible, sesión vigente y API configurada.
- Aceptación: HTML nunca autentica; 202 solo programa; se ve identidad/acción/turno;
  pausa envía turno entero futuro 1..150; errores/conflictos visibles; recibos separados
  por partida y época local, incluyendo respuestas tardías A→B→A.
- Riesgos: pérdida de mensajes/observaciones, cierres previos coincidentes, órdenes
  superpuestas, carrera servidor/partida y recibos volátiles. No afirmar causalidad.
- Commit sugerido (no crearlo): fix(frontend): aclara recibos y turnos de controles de segmento.

### Etapa 2: escenario de simulación de Manta (implementada; validación visual pendiente)

- Objetivo: mantener contexto del mapa. Incluye navegación/encuadre y recuperación de vista;
  excluye frontera municipal, modificación de coordenadas y eliminación de referencias externas.
- Base leída antes de los cambios: 300 nodos, 736 aristas, 4 refugios; extremos de nodos
  [-0.9653992, -80.7478661] a [-0.9481941, -80.6914799]. Las copias del grafo son iguales.
  Hay 4 referencias de cámara (3 habilitadas); el encuadre se calculaba con nodos, no cámaras,
  pero no restringía la navegación. En App, escritorio usa panel lateral de 320 px y móvil apila
  controles; el mapa móvil tiene `min-height: 50vh`.
- Implementado ahora: bounds reales desde `graph.nodos`, margen visual proporcional del 8%,
  `maxBounds` con viscosidad completa, zoom mínimo calculado con el tamaño actual del mapa y
  `noWrap` para no repetir tiles. Un `ResizeObserver` mide el contenedor real tras cambios de
  tamaño/orientación; el padding de fit usa 4% del viewport hasta 24 px por eje. Se nombra el
  área “Escenario de simulación de Manta”; esos bounds no son una frontera municipal.
- Implementado en esta continuación: el botón “Ver escenario” encuadra los bounds actuales solo
  por acción del operador. Snapshots no llaman `fitBounds`; al cambiar bounds del grafo se
  actualizan maxBounds/minZoom sin reiniciar el encuadre por un recommit normal.
- Pendiente: revisar manualmente escritorio/móvil, demostrar refugios y todos los nodos accesibles
  con proveedor real, cierres visibles y el clic del botón. No se modifica el grafo ni se usa
  cámara externa para ampliar bounds.
- Archivos: `frontend/src/components/LiveMap.tsx`, `frontend/src/app/App.tsx`,
  `frontend/src/styles/index.css`, nuevos `frontend/src/lib/map-bounds.ts` y
  `frontend/src/lib/map-bounds.test.ts`. Responsable/revisor propuesto Kristhian; Michael revisa
  anomalías del grafo. La medición dinámica está implementada, pero no se declara una prueba
  visual satisfactoria por viewport.
- Contratos: reutilizar grafo, sin cambios. Dependencia: revisión de etapa 1 y autorización nueva.
- Aceptación/pruebas restantes: comprobación visual de todos los nodos/refugios, límites,
  cierres, respuesta WS y tamaños móvil/escritorio. Requiere navegador; aún no comprobado.
- Riesgos/acuerdos: las dimensiones y minZoom varían con viewport y proveedor; el margen se deriva
  matemáticamente del grafo, no define cobertura ni límite administrativo.
- Commit sugerido: feat(frontend): delimita la vista al escenario de simulación de Manta.

### Etapa 3: preparación y configuración (3A, 3B, 3D y 3E locales; 3C pendiente)

- Objetivo: entender/validar antes de crear partida. Incluye resumen del preset, semilla explícita
  opcional y repetición con identidad nueva; excluye cantidades/tiempos libres y edición de cámaras.
- Situación: presets deterministas y validadores existen; API no expone consulta/prevalidación.
- Pasos: 1) inventariar configuración; 2) acordar DTO de lectura/prevalidación sin mutación;
  3) presentar parámetros normativos; 4) semilla opcional conservando generación automática;
  5) proponer personalización acotada; 6) congelar/versionar configuración; 7) diferenciar reiniciar,
  repetir y reanudar.
- Archivos: RoundControls, round-presets, round-validation, controls, http-plugin,
  world-state, SPEC/OpenAPI/tipos. Revisores: Kristhian, Maykel y Michael conjuntamente.
- Contratos: propuestas nuevas requieren acuerdo antes de código. Dependencia: etapa 2 revisada.
- Aceptación: prevalidar no crea mundo/reloj; spawns legales; rondas normativas sin cambios;
  repetir conserva escenario/semilla con gameId nuevo; recuperar usa configuración congelada.
- Riesgos: divergencia entre resumen frontend y configuración efectiva; no llamar aprobado a un preset sintético.
- Commit sugerido: feat(operador): prepara partidas con configuración validada.
- Diseño concreto tras la indicación de avanzar a fase 3: véase
  `docs/diseno-preparacion-partidas.md` (archivo nuevo). Incluye diferencias del código actual,
  entregas pequeñas, propuestas contractuales y criterios de aceptación. Las indicaciones
  posteriores de continuar autorizan 3A y 3B: desplegable opcional, semilla, catálogo efectivo
  GET `/simulador/rondas` y POST `/simulador/prevalidar`, enlazado con iniciar mediante huella.
  3D agrega identidad persistida de grafo+ronda y GET `/simulador/configuracion/{gameId}`,
  con consulta en desplegable. 3E distingue reanudar, nueva partida, reiniciar con preset
  vigente y repetir la ronda guardada mediante `/simulador/reiniciar`, con confirmación.
  3C conserva su estado de diseño por falta de definición de parámetros permitidos.

### Etapa 4: grupos visuales (solo plan)

- Objetivo: seleccionar/seguir varios sobrevivientes. Excluye órdenes, prioridades y mutaciones.
- Situación: marcadores individuales y snapshots; no selección persistente ni grupos.
- Pasos: 1) selección individual; 2) múltiple/filtros; 3) estados y objetivos individuales;
  4) conservar IDs al actualizar; 5) limpiar al cambiar partida; 6) accesibilidad/móvil.
- Archivos: LiveMap, store UI de selección nuevo propuesto, panel de selección nuevo propuesto.
  Responsable Kristhian; contratos existentes WorldSnapshot/Survivor, sin groupId en routing.
- Dependencia: etapa 3 revisada. Aceptación: selección no envía comandos ni cambia snapshots;
  eliminados/evacuados siguen identificables; WS no pierde selección válida.
- Riesgos: coste de renders y ambigüedad visual entre seleccionado y amenaza.
- Commit sugerido: feat(frontend): selecciona grupos visuales de sobrevivientes.

### Etapa 5: orientación a refugios (solo diseño, acuerdo obligatorio)

- Objetivo: solicitar refugio/reservas a vivos mediante reglas existentes; no mover posiciones,
  agrupar físicamente ni conceder paso por peligros. Situación: planes de reservas existen, sin comando.
- Pasos: 1) acordar significado de guiar; 2) elegir asignación completa o parcial y exclusiones;
  3) diseñar comando idempotente/turno efectivo; 4) ordenar competidores determinísticamente;
  5) validar traslado antes de liberar reservas; 6) integrar con sync existente y reservedPlans;
  7) tratar bajas, refugio lleno, sin ruta, cambio de objetivo y sync fallida.
- Archivos: simulator/turn-coordinator y survivor-resolution (Maykel), routing/contratos
  (Michael), panel de selección (Kristhian), SPEC/OpenAPI compartidos. Archivos nuevos solo tras diseño.
- Contratos: propuesta de comando/resultado, sin introducir groupId al motor innecesariamente.
- Dependencia: selección visual y acuerdo de capacidad/orden. Aceptación: reservas atómicas,
  cupos respetados, empates deterministas, ninguna posición editada; sin ruta segura se espera.
- Riesgos: targetShelterId no fuerza por sí solo el plan general; preservar reservas durante cambios.
- Commit sugerido: feat(simulator): solicita refugios para grupos con reservas atomicas.

### Etapa 6: historial, explicación y demo (solo plan)

- Objetivo: explicar ejecución y repetir escenario lógico. Excluye reconstruir rutas futuras,
  inventar causalidad y prometer durabilidad de 202.
- Situación: métricas/eventos internos/checkpoints; falta contrato público de auditoría y decisiones finales.
- Pasos: 1) acordar orden de servidor y autor soportado; 2) registrar turnos solicitado/efectivo/resultados;
  3) exponer movimiento/espera realmente ejecutados; 4) línea temporal; 5) versión del grafo,
  software, configuración, algoritmo/semilla y comandos; 6) demo comparativa con/sin evento;
  7) resumen con métricas existentes separando disponibilidad de evacuación.
- Archivos: turn-coordinator, survivor-resolution/realtime (Maykel); persistence/telemetry/contratos
  (Michael); timeline/panel nuevos propuestos (Kristhian); SPEC/OpenAPI compartidos.
- Dependencias: decisiones de etapa 5 y diseño de auditoría/persistencia. Cambios contractuales pendientes.
- Aceptación: decisiones finales diferenciadas de routing, reproducción lógica verificable;
  fallos/latencias externos separados; evento afecta decisión real y hay alternativa segura comprobada.
- Riesgos: tamaño/durabilidad/retención del historial y pérdida de ventanas entre snapshots.
- Commit sugerido: feat(operador): explica turnos y registra demo reproducible.

### Etapa 7: ampliación Ojos de Águila simulados (última prioridad, solo plan)

- Objetivo: ampliar configuración y enlazar evidencia con cierres manuales trazables.
  Excluye video real, uso municipal, amenazas manuales y automatización autónoma.
- Situación: detector posterior a zombies; renovación por cámara/zombie; TTL exclusivo;
  nodo observado bloquea temporalmente routing. Todo esto se conserva durante etapas 1–6.
- Pasos: 1) verificar comportamiento vigente; 2) catálogo previo con IDs/coordenadas/nodo/radio/TTL
  validados; 3) diferenciar coordenada de referencia y centro efectivo; 4) versionar catálogo por
  partida y conservarlo en recuperación; 5) identidad de revisión de observación respaldada por
  servidor; 6) selección explícita de segmento y reutilizar cierre existente con evidencia/autor;
  7) separar expirar alerta, descartar visualmente, cancelar pendiente y abrir cierre; 8) integración.
- Archivos: camera-surveillance/types/turn-coordinator (Maykel), persistence/routing/contratos y fixture
  (Michael), mapa/paneles (Kristhian); configuración/SPEC con revisión conjunta.
- Contratos: versión de catálogo y evidencia/autor propuestos, sin duplicar detector/sync/endpoint.
- Dependencia: etapas previas y aprobación explícita. Aceptación: catálogo recuperado idéntico,
  TTL continuo, cierre en turno permitido, routing actualizado sin planes obsoletos, igualdad HTTP/WS;
  expirar evidencia no abre calles y sin ruta se espera.
- Riesgos: observaciones se renuevan; cámara-zombie no identifica revisión; no ajustar geografía silenciosamente.
- Commit sugerido: feat(cameras): vincula alertas simuladas con cierres trazables.

## Verificación de esta entrega

### Etapa 1 implementada

- `RoundControls` exige `204` tanto para revisar la sesión como para completar el login;
  `401` en GET significa sesión ausente y otros códigos (incluido HTML `200`) quedan visibles
  como error de verificación. Se conservan cookies y credenciales `include`.
- POST `/operador/sesion` valida que el cuerpo contenga únicamente una contraseña de 1 a 256
  caracteres; cuerpos inválidos/extras responden `400 VALIDATION_ERROR`, conforme al schema
  OpenAPI existente. Una contraseña incorrecta sigue respondiendo 401.
- Cierre/apertura usa el contrato `202` + JSON. Cada recibo local muestra eventId, nombre/id
  de segmento, acción, turno efectivo, motivo y estado. `202` queda programado y pendiente,
  no aplicado.
- `world-store` observa recibos solo después de aceptar un snapshot. El recibo debe coincidir
  con gameId/ronda; la observación exige turno del snapshot ≥ effectiveTurnId. Al cambiar la
  partida se descartan recibos; una respuesta tardía de A se ignora aunque el operador haya
  pasado por B y vuelva a A. Se conservan hasta 20 recibos de la partida actual en memoria.
- La observación expresa únicamente que el segmento muestra el estado esperado. Se avisa si
  ese estado ya existía antes de solicitarlo o si hay órdenes superpuestas; no se atribuye el
  resultado al eventId. Rechazos, aceptación incierta y estado no observado al terminar la
  partida se mantienen explícitos. Recargar la página elimina los recibos.
- En pausa aparece un turno efectivo editable, sugerido como snapshot.turnId + 1. Si la partida
  corre, el cliente omite ese campo y el servidor asigna el turno. En ambos casos el servidor
  decide si el turno sigue disponible; conflictos/errores se conservan en el recibo.
- La reanudación conserva el flujo existente basado en gameId/roundId del snapshot y la semilla
  guardada por el servidor. En backend solo se alineó el validador de login con el schema
  existente; no se cambiaron contratos, OpenAPI, SPEC, grafo, cámaras, persistencia ni proxy.

Archivos modificados:

- `frontend/src/components/RoundControls.tsx` — integración visual y turno al pausar. Revisor
  propuesto: Kristhian.
- `frontend/src/state/world-store.ts` — notificación de snapshots aceptados al store de recibos.
  Revisores propuestos: Kristhian y Michael por la frontera de snapshot.
- `backend/src/modules/simulator/http-plugin.ts` y `backend/tests/operator-session.test.ts` —
  validador estricto del cuerpo de login según el contrato existente. Revisor propuesto: Maykel
  por ownership de simulator; Michael revisa conformidad con OpenAPI.
- Nuevos: `frontend/src/lib/operator-controls.ts` y `.test.ts` — HTTP/validación local;
  `frontend/src/state/operator-receipts.ts` y `.test.ts` — ciclo de vida visual del recibo.
  Revisor propuesto: Kristhian; interpretación contractual para Michael y semántica de turnos
  para Maykel. Son revisores propuestos, no aprobaciones.
- `docs/plan-experiencia-operador.md` — auditoría, matriz, plan y esta entrega. Revisión conjunta
  propuesta por tratarse de documentación compartida.

### Etapa 2 implementada en código

- `LiveMap` limita la navegación a una caja derivada de los nodos del grafo, con 8% de margen
  relativo por eje. Las cámaras no participan en el cálculo; las referencias del snapshot no se
  eliminan. El mapa muestra el rótulo “Escenario de simulación de Manta”.
- `ResizeObserver` mide el ancho/alto efectivo del contenedor después de cambios de layout u
  orientación. En esa medida, Leaflet recalcula el zoom mínimo que mantiene visibles todos los
  bounds del grafo, con padding de 4% hasta 24 px. El mapa acerca si el nuevo viewport ya no cabe;
  no recentra por snapshots. `maxBoundsViscosity=1` limita el arrastre y `noWrap` evita repetir
  tiles del mundo.
- “Ver escenario” llama `fitBounds` explícitamente usando el grafo y el viewport actual. El
  control recibe los bounds nuevos si cambia la geometría; cambios de snapshot no disparan ese
  ajuste. Los cambios reales de grafo actualizan restricciones y minZoom, sin recalcular datos.
- Pruebas cubren bounds de nodos del grafo real y pertenencia de refugios/extremos de aristas,
  margen proporcional, padding móvil/escritorio y la petición de encuadre con medidas actuales.
  No sustituyen la inspección real del mapa en navegador.

Contratos modificados en etapas 1 y 2: ninguno. Se consumen sin alteración GET/POST `/operador/sesion`,
POST `/simulador/bloquear-arista` y `WorldSnapshot`. El contrato del cierre no publica gameId;
la interfaz protege la asociación con la identidad local observada, pero no puede impedir que
el servidor cambie de partida durante el transporte. La correlación exacta entre eventId y
BlockedEdge sigue sin estar disponible.

### Verificaciones ejecutadas en esta entrega

- Frontend: `npm --prefix frontend test` — 31 pruebas pasan (11 existentes y 20 nuevas: sesión/recibos y mapa responsive).
- Frontend: `npm --prefix frontend run lint` — pasa.
- Frontend: `npm --prefix frontend run build` — pasa; incluye `tsc -b` y build de Vite.
- Backend/servidor: `node --test backend/tests/operator-session.test.ts backend/tests/persistence.test.ts tests/simulator-events.test.ts tests/simulator-segments-e2e.test.ts tests/simulator-runtime.test.ts` — 50 pruebas pasan. Incluyen autenticación (incluido el nuevo caso de propiedades extra), pausa/reanudación con identidad y semilla, conflictos/eventos, recuperación y consistencia HTTP/WS. Estas pruebas de integración abren sockets locales; el primer intento dentro del sandbox terminó por la restricción de loopback y la repetición autorizada con loopback pasó.
- Backend/OpenAPI: `node --test backend/tests/openapi.test.ts` — 1 prueba pasa; confirma que la especificación sigue consistente.
- `git diff --check` — pasa.
- No se ejecutaron tests de rendimiento ni se alteraron las pruebas de SLA: la implementación solo agrega presentación/estado local y no trabajo en el turno.

### Limitaciones y revisión manual

- No se completó verificación en navegador, Caddy/proxy ni producción. Los tests frontend ejercitan funciones HTTP con respuestas simuladas y stores; no prueban cookies reales del navegador, layout móvil ni el despliegue. La evidencia histórica no sustituye esas comprobaciones.
- Se intentó una captura local con Firefox headless para escritorio; el renderer reportó fallo de framebuffer y no produjo imagen. No se declara verificación visual ni móvil.
- El recibo no sobrevive a recarga y no es auditoría. Los estados de rechazo son contractuales; para un fallo de red/servidor se conserva “aceptación no confirmada” porque el resultado remoto podría ser ambiguo.
- La detección de superposición solo conoce órdenes recibidas en esta pestaña. Un cambio externo puede producir el mismo estado; por eso ninguna observación se atribuye a un eventId.
- La UI sugiere el siguiente turno en pausa, pero el servidor puede rechazarlo si el estado cambió o el turno ya no está disponible. El operador ve el código/mensaje y el requestId cuando el backend lo proporciona.
- No hay evidencia actual de que este HEAD coincida con producción.

Pasos manuales propuestos para revisión en local:

1. Iniciar frontend y backend con las URLs/API y cookie/origen descritos por la configuración local; comprobar GET `/operador/sesion` con cookie válida (`204`) y sin cookie (`401`). Probar una respuesta HTML `200` de fallback: no debe autenticar.
2. Iniciar una ronda y pausarla. Confirmar que el campo sugiere turno actual + 1, permite editarlo y que una solicitud de cierre/apertura lo envía como `effectiveTurnId`. Reanudar desde la misma partida debe conservar identidad y semilla.
3. Programar un cierre. Verificar que se muestra `eventId`, segmento, acción y turno como programado mientras el snapshot aún muestra el estado anterior; cuando llegue un snapshot de esa misma partida con turno suficiente, debe mostrar el estado observado sin atribuir causalidad al eventId.
4. Provocar un `409` de segmento/turno y confirmar que el recibo conserva rechazo, código, mensaje y requestId. Repetir solicitudes del mismo segmento antes de observarlas para ver el estado de superposición.
5. Cambiar a otra partida con un recibo pendiente y comprobar que desaparece. Volver al identificador anterior o completar la partida antes de la observación debe ignorar respuestas tardías o mostrar que no se observó antes del fin.
6. Recargar y comprobar que no se promete recuperar los recibos locales.
7. Abrir el mapa en móvil y escritorio; cambiar orientación/tamaño, comprobar que el zoom mínimo
   conserva todos los nodos/refugios, se restringe el arrastre con margen y el rótulo no sugiere
   una frontera municipal. Confirmar que el cierre continúa visible.

Estos pasos manuales quedan pendientes; no se declara verificación visual.

### Pendiente de verificación visual de etapa 2

La implementación de etapa 2 está completa. Falta revisar visualmente en un navegador normal los
encuadres escritorio/móvil, el botón “Ver escenario”, tiles, todos los refugios, cierres y cámaras,
y confirmar manualmente que WS conserva la vista durante navegación. Responsable/revisor propuesto:
Kristhian; Michael revisa anomalías de datos. No se comenzó la etapa 3 ni las posteriores.
