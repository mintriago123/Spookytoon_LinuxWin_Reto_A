# Fase 3: preparación y configuración de partidas

Estado: entregas 3A, 3B, 3D y 3E implementadas localmente, rama `prueba`, HEAD `0ca1c50`.
Existen cambios locales de fases 1 y 2. La verificación visual de fase 2 sigue pendiente.
Las indicaciones posteriores de continuar autorizan estas entregas de fase 3.
GET `/simulador/rondas` y POST `/simulador/prevalidar` están implementados y documentados
en OpenAPI. La versión guardada de 3D y su consulta también están implementadas.
3E reutiliza el reinicio existente para distinguir preset vigente de ronda guardada.
3C sigue pendiente de parámetros permitidos; se mantienen presets y semilla como únicas opciones.

## Diferencias comprobadas

| Capacidad | Implementación actual | Brecha |
| --- | --- | --- |
| Presets | `backend/src/config/round-presets.ts` construye y valida tres configuraciones deterministas | Frontend solo ofrece nombres de ronda; no consulta la configuración efectiva |
| Cantidades y tiempo | 20/80/200 sobrevivientes; 150 turnos, 2.000 ms, 300.000 ms | Falta resumen antes de iniciar |
| Composición del preset por defecto | R1: 8 caminantes; R2: 12 caminantes, 4 corredores y 2 hordas; R3: 16 caminantes, 6 corredores, 2 hordas y 4 dormidos | No copiar estos valores al frontend: el servidor admite overrides de configuración |
| Eventos por defecto | R1: ninguno; R2: puente en turno 75; R3: calles en turnos 60 y 105 | Mostrar el plan efectivo del servidor; no atribuirlo a cualquier configuración personalizada |
| Semilla | POST iniciar la exige; la UI genera UUID; reanudar la omite para conservarla | Falta opción explícita antes de iniciar y referencia recuperable para repetir |
| Validación | `round-validation.ts` comprueba campos, cantidades, composición, nodos, peligros y eventos | No existe endpoint público de prevalidación |
| Configuración inmutable | `world-state.ts` valida, clona y congela `roundConfig` | Falta una revisión estable que la UI pueda vincular con su preparación |
| Recuperación | El adapter persiste `roundConfig` y estado aleatorio; recovery los reutiliza | No rediseñar recuperación ni reemplazar su configuración por presets nuevos |
| Reinicio | Existe POST `/simulador/reiniciar` con `IniciarRequest` | La UI no distingue reinicio de repetición reproducible; repetir requiere configuración y semilla anteriores |

La tabla describe la base anterior a 3A, comprobada por lectura. Los resultados de pruebas
de las entregas implementadas aparecen al final; no verifican propuestas de 3C.

## Entregas propuestas

Preferencia de interfaz confirmada: configuración en un apartado desplegable cerrado
inicialmente. Sin cambios del operador se conserva ronda 1 y semilla automática.
Cerrar el apartado no restablece opciones ya elegidas.

Primer ajuste local de 3A: `RoundControls.tsx` agrupa ronda y semilla opcional en
ese desplegable. La semilla explícita usa el contrato de inicio existente, sin recortarla;
vacía genera UUID como antes. Reanudar conserva su flujo actual. La entrega siguiente de
3A incorpora el resumen efectivo descrito al final. Inicialmente no había Node/npm en el
entorno; se obtuvo Node 24.12.0 en `/tmp` para ejecutar las comprobaciones.

### 3A — Resumen efectivo y semilla explícita (pasos 3.1 y 3.2)

Objetivo: que el operador conozca la ronda y la semilla antes de crearla.

1. Acordar una consulta autenticada de presets efectivos, sin crear mundo ni reloj.
   Debe leer la misma configuración resuelta por `server.ts`, incluidos overrides,
   y pasar por `validateRoundConfig`; no reconstruir el preset en frontend.
2. Presentar cantidades, duración, intervalo, turnos, composición y eventos del preset seleccionado.
3. Añadir elección de semilla automática o explícita. La explícita debe satisfacer
   el contrato existente: texto no vacío de hasta 256 caracteres. No recortar ni transformar
   silenciosamente la semilla; generar la automática una vez para la preparación confirmada.
4. Conservar `gameId` automático y enviar la semilla mediante el POST iniciar existente.
   Reanudar sigue usando la identidad del snapshot y conserva la semilla del servidor.

Contrato implementado en esta entrega: GET `/simulador/rondas`, con `RoundCatalog` y
`RoundPresetSummary` en OpenAPI. Identifica las rondas mediante roundId y el grafo mediante
graphVersion; la revisión de configuración queda para 3D. No añade campos al snapshot.

Archivos existentes: `backend/src/server.ts`, `backend/src/modules/simulator/http-plugin.ts`,
`backend/openapi/openapi.yaml`, `frontend/src/components/RoundControls.tsx`,
`frontend/src/types/contracts.ts`. Archivo nuevo propuesto: un cliente frontend de catálogo,
cuya ruta se decidirá al implementar; no se declara existente.

Aceptación: seleccionar ronda cambia el resumen correcto; un override del servidor aparece
en el resumen; semilla explícita se envía exactamente; automática se conserva durante la
preparación; reanudar mantiene gameId, roundId y seed. Un error de catálogo impide afirmar
que la configuración fue verificada.

Revisores propuestos: Kristhian (interfaz), Maykel (simulator), Michael (contratos e integración).
Commit sugerido: `feat(operador): muestra presets efectivos y semilla de partida`.

### 3B — Prevalidación sin mutación (paso 3.3)

Objetivo: comprobar una preparación sin iniciar, pausar, reiniciar ni persistir una partida.

1. Acordar DTO con identidad propuesta, semilla, preset y revisión del grafo/configuración.
2. Resolver en servidor el preset efectivo y reutilizar los validadores existentes.
3. Devolver errores de campos y el resumen normalizado que se iniciaría. No reservar capacidad,
   consumir RNG, abrir temporizadores, publicar WS ni escribir persistencia.
4. Invalidar la validación visual al editar ronda/semilla o recibir una revisión distinta.
5. Revalidar atómicamente al iniciar: la prevalidación no garantiza que el estado del servidor
   siga permitiendo el arranque. Mostrar conflictos y exigir revisión de la preparación.

Contrato implementado tras las indicaciones de continuar: POST `/simulador/prevalidar`
con PreparationRequest/Response y `preparationRevision` opcional en IniciarRequest.
El frontend usa siempre la huella para iniciar; el campo opcional conserva compatibilidad
con clientes anteriores. Las reglas de configuración se validan con `validateRoundConfig`.

Archivos existentes: controls, round-validation, simulation-runtime, http-plugin, OpenAPI
y RoundControls. Pruebas nuevas propuestas en `backend/tests/` para ausencia de efectos y
conflictos entre validación e inicio; el nombre se fijará al implementar.

Aceptación: estado, reloj, contador RNG, persistencia y publicaciones permanecen iguales tras
validar; solicitudes inválidas producen errores útiles; una configuración obsoleta se detecta
en el arranque. Responsable Maykel; revisión Michael y Kristhian.
Commit sugerido: `feat(simulator): prevalida la preparación sin modificar la partida`.

### 3C — Personalización acotada (paso 3.4)

Pendiente de acuerdo conjunto sobre qué parámetros se editan y sus límites.
Hasta entonces, ofrecer solo los presets existentes. No añadir un selector de dificultad
que modifique cantidades o amenazas sin explicar parámetros.

Los escenarios futuros deben pasar por `validateRoundConfig`: cantidades normativas,
tiempos fijos, composición y eventos por ronda, nodos válidos, sobrevivientes fuera de
refugios/zombies/zona de horda. La política de cantidades de zombies y ubicaciones adicionales
requiere acuerdo explícito; no endurecer o relajar el validador para obtener un editor cómodo.
No incluir editor de cámaras.

Dependencia: 3B y parámetros aprobados. Responsables conjuntos; pruebas de límites y spawns
ilegales antes de UI de edición. Commit sugerido: `feat(operador): configura escenarios dentro de límites acordados`.

### 3D — Revisión congelada y recuperación (paso 3.5, implementado localmente)

Se reutiliza la copia inmutable y persistencia existentes. La revisión identifica el grafo completo
y RoundConfig mediante el formato `spookython-round-configuration-v1`. La canonicalización
ordena claves de objetos y conserva arrays; el hash es SHA-256 sobre JSON UTF-8 sin espacios.
La semilla y su algoritmo/versión permanecen separados en randomState. No sustituye el preset
guardado al recuperar. El alcance detallado y los checkpoints antiguos se explican al final.

Archivos existentes: world-state, persistence/adapter, persistence/recovery, tipos y OpenAPI.
Revisión Michael (persistencia/contratos), Maykel (mundo), Kristhian (presentación).
Aceptación: mutar una preparación externa no cambia el mundo iniciado; recuperar después de
cambiar presets del proceso conserva la configuración guardada y el estado RNG.
Commit sugerido: `feat(persistence): identifica la configuración congelada de partida`.

### 3E — Nueva partida, reinicio y repetición (paso 3.6, implementado localmente)

Definir tres acciones de interfaz: iniciar preparación nueva; reiniciar según el contrato
existente; repetir la configuración congelada y semilla anteriores con un gameId nuevo.
Reanudar conserva la partida actual y no crea una preparación nueva.

La fuente es la partida comprometida actual del servidor, incluida la recuperada desde checkpoint.
La consulta de 3D permite mostrar su semilla y versión; el servidor resuelve directamente
la configuración guardada sin confiar en spawns enviados por el frontend. POST `/simulador/reiniciar`
se reutiliza con una referencia de origen y selección explícita del modo. No se añade otro endpoint.

Dependencia: 3D y acuerdo sobre reinicio de una partida activa y conservación de evidencia anterior.
Pruebas: identidad nueva al repetir; misma configuración/semilla; no se alteran posiciones ni
reservas mediante la UI; la recuperación y reanudación originales continúan pasando.
Responsables Maykel, Michael y Kristhian. Commit sugerido: `feat(operador): diferencia repetir reiniciar y reanudar`.

## Orden y revisión

3A, 3B, 3D y 3E quedan locales para revisión. 3D y 3E no requieren personalización y se
implementan con rondas guardadas y presets actuales. Mantener 3C pendiente de parámetros permitidos.
Los responsables anteriores son revisores propuestos; este documento no implica aprobación
de Michael ni Kristhian. No se comenzó la fase 4.

## Entrega local 3A: resultado y revisión

- GET `/simulador/rondas`: lectura autenticada por las mismas credenciales de los controles,
  con `Cache-Control: no-store`. Devuelve graphVersion y las tres rondas: población, tiempos,
  composición y eventos. Lee `options.rounds` del runtime, valida con el validador existente
  y respeta overrides; no reconstruye presets, no crea mundo ni cliente de routing.
- El desplegable consulta ese catálogo y muestra únicamente el resumen correspondiente
  al grafo del mapa. Si falla, permite reconsultar y explica que iniciar usa el preset vigente
  del servidor. La falta de resumen no bloquea el flujo actual de inicio por defecto.
- Semilla vacía mantiene generación automática; explícita se envía intacta y se valida contra
  el contrato actual. No cambia la reanudación ni las reglas del simulador.
- Esta consulta no es prevalidación ni garantiza configuración congelada entre consulta e
  inicio. El nuevo enlace temporal de 3B se describe abajo; la revisión persistida sigue en 3D. Los spawns
  no se envían al frontend. Las cámaras existentes siguen fuera del alcance de edición.

Archivos: `backend/src/modules/simulator/simulation-runtime.ts`, `http-plugin.ts`,
`backend/openapi/openapi.yaml`, `frontend/src/types/contracts.ts`, `RoundControls.tsx`.
Archivos nuevos: `frontend/src/lib/round-catalog.ts`, `round-catalog.test.ts`,
`backend/tests/round-catalog.test.ts`. Se adapta `backend/tests/openapi.test.ts` para
comprobar la seguridad y la respuesta del endpoint real contra su esquema.
Revisores propuestos: Maykel, Michael y Kristhian según los ownerships anteriores.

Comprobaciones con Node 24.12.0 temporal (sin instalar dependencias nuevas): frontend
34 pruebas, lint y build pasan; backend typecheck pasa. Las 8 pruebas backend de sesión,
OpenAPI y catálogo pasan con `--test-isolation=none` para mostrar los casos internos
en este entorno. La comprobación de whitespace se realiza con `git diff --check`.

Revisión manual pendiente: iniciar con el desplegable cerrado; abrir y seleccionar cada ronda;
contrastar cantidades/eventos con `/simulador/rondas`; probar semilla explícita y automática;
provocar error de consulta o grafo distinto y revisar el mensaje; pausar/reanudar conservando
identidad. No se declara prueba de navegador, proxy ni producción. No se hicieron commits,
push ni despliegues.

## Entrega local 3B: prevalidación antes del inicio

Al pulsar Iniciar se genera una sola identidad y una sola semilla, se muestra “Validando…”
y se llama a POST `/simulador/prevalidar`. Una respuesta 200 permite intentar iniciar;
no crea la partida. Después se muestra “Iniciando…” y se envía la misma identidad/semilla
con la huella devuelta. El éxito de inicio exige 202 y una respuesta de esa partida.
El snapshot sigue siendo la fuente del mundo; no se fabrica estado local en ninguno de los pasos.

La preparación contiene gameId, roundId, seed y graphVersion. El servidor valida el esquema,
la disponibilidad de una partida nueva, el grafo y el preset vigente. Devuelve el resumen
validado y preparationRevision. Reutiliza el mismo resolvedor de configuración que el catálogo
y el arranque. No crea mundo, cliente de routing, publicaciones, escrituras o temporizadores;
no llama al generador de métricas ni consume RNG o identificadores.

La huella es SHA-256 de JSON UTF-8 sin espacios: claves de objetos ordenadas por código,
arrays en su orden original. Incluye un identificador de formato v1, gameId, roundId, seed,
grafo completo, configuración validada, catálogo vigente de cámaras y descriptor RNG
(algoritmo, versión y estrategia). Solo se calcula en estos controles, fuera del turno.
No configura ni cambia cámaras. Es una comprobación de concurrencia, no autenticación,
recibo durable ni versión persistida para reproducción.

Antes de crear el mundo, iniciar vuelve a comprobar estado, identidad disponible y huella.
Configuración o preparación distintas producen 409 PREPARATION_CONFLICT. Una partida activa
produce GAME_STATE_CONFLICT. Reiniciar, si recibe la huella opcional, la comprueba antes de
sustituir el mundo, incluida la espera de cierre. Clientes anteriores que omiten la huella
conservan su contrato previo; no obtienen esa protección adicional.

El frontend exige que la respuesta de preparación corresponda exactamente a identidad,
semilla, ronda y grafo solicitados. No inicia ante HTML, payload incompleto, cancelación o
cambio local de snapshot/grafo. Si el resumen visible cambió, actualiza la consulta y pide
revisarlo antes de iniciar. Durante ambas solicitudes las opciones quedan deshabilitadas.
Una validación no se guarda ni se reutiliza después de editar opciones; cada clic prepara
de nuevo. No hay reintento automático del POST iniciar, ni siquiera ante un fallo de red.

Archivos añadidos: `backend/src/modules/simulator/preparation.ts`,
`backend/tests/preparation.test.ts`, `frontend/src/lib/prepare-game.ts` y su prueba.
Archivos adaptados: controls, simulation-runtime, http-plugin, OpenAPI y su prueba;
tipos frontend, RoundControls, operator-controls y round-catalog con su prueba.
Revisores propuestos: Maykel (simulator), Michael (contratos/integración), Kristhian (frontend).
Commit sugerido, sin crear: `feat(operador): prevalida partidas antes del inicio`.

Verificaciones de esta entrega con Node 24.12.0:

- Frontend: 47 pruebas, lint y build (incluye typecheck) pasan.
- Backend: typecheck y las 49 pruebas de `backend/tests/*.test.ts` pasan.
  El primer intento tuvo 9 fallos EPERM por sockets bloqueados por sandbox; la repetición
  autorizada fuera del sandbox pasó, con HTTP/WS locales, recuperación y cámaras existentes.
- También pasaron 39 pruebas dirigidas de preparación, catálogo, OpenAPI, sesión y runtime;
  27 corresponden al runtime de `tests/simulator-runtime.test.ts`. La suite completa backend
  volvió a ejecutar las de preparación después de ampliar los casos de concurrencia.
- Node se ejecuta con `--test-isolation=none` para observar los casos internos del entorno.
  `git diff --check` pasa. No se declara revisión de navegador ni de producción.

Revisión manual pendiente:

1. Iniciar con el desplegable cerrado: la red debe mostrar prevalidar 200 y luego iniciar 202,
   con la misma identidad/semilla; sigue utilizando ronda 1 y semilla automática.
2. Abrir el desplegable, cambiar ronda/semilla e iniciar: la semilla explícita se envía intacta.
3. Ejecutar solo prevalidar con sesión válida: el snapshot o la ausencia de partida deben
   permanecer iguales. Campos adicionales o semilla vacía se rechazan con 400.
4. Entre preparar e iniciar, cambiar la preparación o usar una huella anterior: esperar 409;
   comprobar que no se creó ni sustituyó un mundo por ese intento.
5. Crear una partida desde otro cliente entre ambas solicitudes: comprobar el conflicto visible.
   Pausar y reanudar conserva identidad/semilla y no pasa por la preparación de partida nueva.

Pendientes después de 3B: 3C exige definir parámetros personalizables; la entrega 3D se
describe abajo; 3E necesita el acuerdo de reinicio/repetición y su fuente de datos.
No se editaron reglas, grafo ni datos de cámaras; no se hicieron commits, push o despliegues.

## Entrega local 3D: identidad guardada de grafo y ronda

Al crear el mundo se calcula una identidad inmutable de su grafo completo y su RoundConfig
validada, incluidos spawns y eventos originales. Se conserva en el estado interno y los
checkpoints. No se recalcula en cada turno ni se añade al snapshot HTTP/WS. La semilla y el
descriptor RNG mantienen su almacenamiento separado; cambiar solo seed o gameId no cambia
la versión de grafo+ronda. Este identificador no acredita versión de software ni catálogo de
cámaras. La configuración de cámaras y su recuperación mantienen el comportamiento vigente;
su versionado permanece en la etapa 7.

La canonicalización se comparte con la preparación mediante el nuevo helper puro de contratos
`canonical-json.ts`. Los dos hashes tienen formatos y alcances distintos: preparationRevision
vincula una solicitud de inicio; configurationIdentity identifica grafo+ronda guardados.

Al recuperar, la identidad guardada se compara con el grafo cargado y el RoundConfig persistido;
no se usa el preset actual del proceso. Se rechaza una huella incompatible, incluso si alguien
alteró el grafo manteniendo graphVersion. También se rechaza una identidad de ronda distinta
de su configuración. La recuperación vuelve a congelar copias de grafo, configuración e identidad,
y deja de compartir referencias mutables con el checkpoint recibido.

Compatibilidad: un checkpoint anterior sin configurationIdentity puede recuperarse con las
validaciones existentes. Se calcula una huella y se marca `derived-from-legacy-checkpoint`;
no se presenta como una prueba del contenido original del grafo. Esa procedencia se conserva
al volver a guardar y recuperar. Un campo presente pero inválido se rechaza; no se degrada a legacy.

GET `/simulador/configuracion/{gameId}` devuelve la versión, resumen de ronda y descriptor RNG
con semilla de la partida actual. Exige autenticación y gameId exacto; otra partida da 404.
Se sirve con no-store y sin modificar el mundo. OpenAPI define GameConfiguration y
ConfigurationIdentity. No se agregó semilla ni metadata al WorldSnapshot público.

La interfaz ofrece un desplegable cerrado “Configuración guardada de la partida”. Consulta
solo al abrirlo y conserva la vista entre snapshots. Al cambiar identidad/ronda/grafo se remonta
y cancela solicitudes anteriores. El cliente verifica identidad y graphVersion antes de mostrar
datos. Muestra semilla exacta, versión de grafo+ronda y aviso para checkpoints legacy.
La preparación de una partida nueva sigue usando los valores por defecto si no se editan.

Archivos nuevos: `backend/src/contracts/canonical-json.ts`,
`backend/src/modules/simulator/configuration-identity.ts`,
`backend/tests/configuration-identity.test.ts`,
`frontend/src/components/GameConfigurationDetails.tsx`,
`frontend/src/lib/game-configuration.ts` y su prueba.
Adaptados: tipos y construcción del mundo, preparación (helper compartido), adapter/recovery,
runtime/http-plugin, OpenAPI y su prueba; tipos frontend y RoundControls.
Revisores propuestos: Maykel (mundo), Michael (contratos/persistencia), Kristhian (interfaz).
No se presupone aprobación de ninguno. Commit sugerido sin crear:
`feat(simulator): conserva la identidad de configuración al recuperar partidas`.

Verificación de 3D: frontend 54 pruebas, lint y build pasan; backend typecheck pasa.
Las 53 pruebas dirigidas de identidad, preparación, OpenAPI, cámaras, estado y runtime pasan.
La suite backend completa también pasa: 53 pruebas, ejecutadas fuera del sandbox por
sus sockets locales. `git diff --check` pasa.
Los adaptadores DynamoDB de las pruebas utilizan transportes simulados; no se modifica AWS.

Revisión manual pendiente: iniciar, abrir el desplegable y copiar semilla/versión; pausar y
recuperar desde checkpoint, comparar ambas; repetir con preset de proceso distinto y comprobar
que se muestra la ronda guardada; cambiar de partida mientras se consulta para verificar que
no se mezcla información; revisar el aviso de recuperación legacy. No se declara revisión
de navegador o producción. La entrega 3E se detalla abajo; no se comenzó la etapa 4.

## Entrega local 3E: reanudar, nueva partida, reiniciar y repetir

Las acciones tienen significados separados:

| Acción | Identidad | Configuración | Semilla | Estado inicial |
| --- | --- | --- | --- | --- |
| Reanudar | La actual | La guardada | La guardada | Continúa desde el último estado comprometido |
| Iniciar / Nueva partida | Nueva | Preset seleccionado vigente | Automática o explícita | Entidades y reservas iniciales |
| Reiniciar con preset vigente | Nueva | Preset vigente de la misma ronda | Nueva automática, mostrada al confirmar | Entidades y reservas iniciales |
| Repetir ronda guardada | Nueva | RoundConfig guardado de la partida actual | La guardada | Spawns y eventos originales de esa ronda |

Reiniciar y repetir aparecen dentro del desplegable opcional de configuración guardada.
Exigen partida pausada o completada. El primer clic solo prevalidará y mostrará ronda,
población y semilla para confirmar o cancelar. Confirmar sustituye la partida actual;
la interfaz avisa que ya no podrá reanudarse desde ese panel. No se bloquea la reanudación
durante la revisión: si el estado cambia, confirmar falla y pide preparar de nuevo.
El flujo por defecto conserva su comportamiento y solo cambia el rótulo a “Nueva partida”
cuando la anterior está completada.

PreparationRequest/Response admiten `restart` opcional, con sourceGameId,
sourceConfigurationRevision y reuseSavedConfig. RestartRequest, documentado en OpenAPI,
extiende los campos de arranque con esa misma referencia. Se reutilizan `/simulador/prevalidar`
y `/simulador/reiniciar`. El modo y origen participan en la huella de preparación; cambiar
de repetir a preset, o cambiar el origen, no conserva una autorización de preparación válida.
La huella es comprobación de concurrencia, no un mecanismo de autenticación.

El backend verifica identidad de origen, versión de configuración, disponibilidad de identidad
nueva y estado pausado/completado. Repetir exige la misma ronda y semilla guardadas y usa
su RoundConfig completo, aunque el preset del proceso haya cambiado. El grafo cargado debe
seguir coincidiendo con la versión guardada. El arranque usa el catálogo efectivo de cámaras
de esa partida, sin cambiar detector, cobertura o TTL. No se versiona otro catálogo ni se
afirma una reproducción del catálogo original anterior a recuperación; ese alcance sigue en etapa 7.

Cada reemplazo reconstruye el mundo mediante createWorldState y el simulador normal. No se
trasladan posiciones, ocupaciones, reservas, cierres manuales, observaciones temporales ni comandos
de la partida anterior. El eventPlan original de la ronda sí se programa de nuevo. “Repetir”
identifica la preparación lógica; no reproduce órdenes manuales, latencias o fallos externos,
ni constituye la reproducción completa de la etapa 6.

El runtime construye el nuevo mundo, métricas, cliente y coordinador antes de sustituir el
anterior. Si falla la construcción, conserva el mundo y snapshot anteriores. Serializa los
reinicios y revalida después de esperar el cierre para evitar que dos solicitudes sustituyan
partidas distintas. La publicación del nuevo mundo se hace tras instalarlo, manteniendo la
fuente común HTTP/WS. La factoría de métricas admite el RoundConfig resuelto como segundo
argumento opcional; el composition root lo utiliza para que repetir no consulte otro preset.

La confirmación del frontend retiene la misma identidad y semilla prevalidada; comprueba modo,
origen, ronda y grafo de la respuesta. También comprueba el snapshot local antes de preparar
y confirmar. Nunca reintenta automáticamente el POST de reemplazo. Cancelar solo descarta
la preparación local: no había una orden de reinicio programada en el servidor.

Retención: no se borra historial persistido existente, pero no se añade un archivo histórico
ni una API para reanudar partidas anteriores. El adaptador de memoria conserva solo la última
partida; DynamoDB retiene registros según su implementación vigente. Un 202 no promete que
la nueva partida ya esté persistida. La referencia de repetición es siempre la partida actual
del servidor; no se promete recuperar una anterior por guardar una semilla en el navegador.

Archivos adaptados: controls, preparation, runtime, http-plugin y OpenAPI; integración server.ts
para métricas; tipos frontend, prepare-game y su prueba, GameConfigurationDetails,
RoundControls y el estado de control pendiente. Archivo nuevo: `backend/tests/restart.test.ts`.
Se amplía la prueba OpenAPI para validar prevalidación y reinicio reales con origen guardado.
Revisores propuestos: Maykel, Michael y Kristhian; no se atribuye aprobación a ninguno.
Commit sugerido sin crear: `feat(operador): distingue reiniciar y repetir rondas guardadas`.

Pruebas de 3E: frontend 58 pruebas, lint y build pasan; backend typecheck pasa con
Node 24.12.0 temporal. La última suite backend completa pasa 56/56. Los casos nuevos prueban preset cambiado frente a configuración
guardada, semilla/identidad, reservas y posiciones iniciales, exclusión de órdenes manuales,
referencias obsoletas, cambio de modo, reinicios competidores y fallos de construcción.
La suite backend completa se ejecuta con sockets locales fuera del sandbox. La primera pasada
completa tuvo 55/56: R2 incumplió el deadline al cerrar la pausa. La misma prueba aislada y la
repetición completa pasaron, sin cambiar tolerancia, SLA ni assertions. La causa del primer
fallo no queda establecida; no se afirma ausencia de variabilidad temporal. Evidencia y logs:
`docs/evidence/fase3e-local-2026-10-28/README.md`. La revisión visual
de botones, confirmación y cancelación sigue pendiente; no se declara navegador o producción.

Pasos manuales: iniciar, pausar, abrir la configuración guardada; preparar y cancelar un reinicio
y comprobar que la partida continúa intacta; preparar y confirmar una repetición y comprobar
gameId nuevo, semilla/versión iguales y turno inicial; cambiar el estado desde otra pestaña
durante la confirmación y comprobar el conflicto; terminar y usar Nueva partida con otro preset.
No hay commits, push, despliegues ni cambios en AWS. 3C continúa pendiente de límites aprobados.
