# Barra lateral unificada y gestión de calles

Revisión local del 28 de octubre de 2026, rama `prueba`, base actual `4bbfd74` (el explorador previo ya está integrado). Se conservó ese trabajo y se dejó esta mejora sin commit.

## Problemas corregidos

- Había dos mecanismos para elegir el mismo segmento: el explorador y el select de “Segmento a gestionar”. Se eliminó el segundo.
- El detalle y la operación estaban separados por bloques, textos y campos redundantes; cerrar una calle requería recorrer la barra.
- La ocupación de refugios y las métricas útiles estaban al fondo, ocultas en desplegables.
- El acceso mostraba una contraseña de demostración fija que el usuario no podía editar.
- En alturas pequeñas algunos bloques podían superponerse. El contenido central ahora mantiene su altura mínima y permite scroll sin mezclar controles.

## Organización

1. Arriba: modo consulta/acceso o sesión de operador activa, con salida de sesión. Se mantiene el mismo controlador, contraseña de demostración y cookie del backend; se retira únicamente el campo fijo de la presentación.
2. Siempre visibles: p95 de routing, disponibilidad y timeouts; cuatro refugios con ocupantes/capacidad y total de reservas publicado. Al seleccionar un refugio se ven sus reservas y cupos en el detalle.
3. Centro: único explorador por categorías, con búsqueda y filtro en una misma fila. Los filtros usan etiquetas breves para evitar texto truncado. La lista conserva su propio scroll; en pantallas bajas también se puede recorrer el contenido central. Los detalles completos de rendimiento siguen disponibles en **Más métricas y versiones**.
4. Zona inferior: selección actual y su acción, sin repetir el selector. Para una calle: nombre, estado observado, motivo del cierre si lo hay, campo de motivo y un único botón **Cerrar calle** o **Abrir calle**. **Cambiar** limpia la selección y libera espacio para buscar otra. **Datos** conserva el ID técnico y el número de aristas, debajo de la acción.

Se retiraron textos repetidos de pausa/reanudación y el falso motivo “Sin cierre activo”. La información técnica queda separada de la acción principal. En móvil el panel sigue debajo del mapa, con altura limitada y sin desbordamiento horizontal.

## Comportamiento

La selección sigue en `world-store`: se elige una sola vez desde el mapa o el explorador. El cierre/apertura utiliza `useOperatorControls.bloquearSegmento` y el mismo endpoint existente, con la arista representativa del segmento. No hay un segundo mecanismo de cierre.

La tarjeta muestra el turno programado, la necesidad de reanudar y el estado esperado observado. Un 202 no se presenta como cierre ya aplicado. Durante una solicitud o una programación pendiente se impide duplicarla. Los errores se muestran junto a la acción. Sin autorización o sin partida activa se explica lo necesario para operar.

No se alteraron backend, contratos, routing, grafo, cámaras, presets, semillas o reglas. La selección no envía órdenes. No se hicieron commits, push ni despliegues.

## Archivos

- `frontend/src/app/App.tsx`: organiza zona superior, explorador y tarjeta de selección.
- `frontend/src/components/RoundControls.tsx`: separa presentación de sesión y acción sobre la selección; elimina el select duplicado.
- `frontend/src/components/ContextPanel.tsx`: integra la acción de calle con el detalle compacto y mantiene datos técnicos accesibles.
- `frontend/src/components/EntityExplorer.tsx`: búsqueda/filtro compactos y textos breves.
- `frontend/src/components/ShelterOccupancy.tsx`: resumen visible de los cuatro refugios.
- `frontend/src/components/MetricsPanel.tsx`: resumen compacto de routing con datos del snapshot.
- `frontend/src/styles/index.css`: distribución y tamaños adaptables de la barra.
- Nuevo `frontend/src/lib/sidebar-controls.test.tsx`: ocho pruebas de comportamiento/presentación.

## Validación

Typecheck, lint, build y `git diff --check` correctos. **49/49 pruebas**, incluidas ocho nuevas que comprueban selección única, acción de apertura según estado, autorización, partida finalizada, acceso compacto, solicitudes programadas/errores y datos visibles sin inventar valores ausentes.

Se ensayó el flujo real en un backend local aislado `localhost:3010`, con persistencia en memoria, y frontend `localhost:5180`. No se enviaron controles al backend habitual ni a producción:

- Acceder, iniciar y pausar una partida de prueba.
- Seleccionar desde el único explorador, escribir motivo y programar cierre.
- Ver el turno programado en la tarjeta; reanudar y observar el cierre.
- Abrir el mismo segmento, reanudar y observar la apertura.
- Volver a cerrar y comprobar el estado autoritativo y el cambio del botón a **Abrir calle**.
- Cero errores de JavaScript en el recorrido de cierre/apertura. La comprobación inicial 401 de sesión sin autenticar pertenece al comportamiento existente.

Verificación visual en escritorio 1440×1000 y 1366×768 y móvil 390×844. Se comprobó una sola acción de calle, ausencia del select anterior, campo/botón dentro de la zona de selección, datos técnicos accesibles y móvil sin desbordamiento horizontal. En pantallas bajas el explorador puede necesitar scroll; la tarjeta de acción permanece separada.

Capturas locales revisadas:

- [Escritorio: selección y cierre](desktop.png)
- [Escritorio: calle cerrada y acción de apertura](desktop-calle-cerrada.png)
- [Móvil](mobile.png)

Para revisar: recarga el frontend habitual, entra como operador, selecciona **Segmentos**, busca una calle y pulsa una fila. Escribe el motivo en la tarjeta inferior y usa **Cerrar calle**. Si está pausada, reanuda para que avance el turno efectivo. Usa la misma tarjeta para abrirla. **Cambiar** permite elegir otra calle sin un segundo selector.


## Ajuste posterior: gestión dentro de la fila

Se eliminó el bloque fijo inferior porque recortaba la lista al seleccionar una calle. Ahora el detalle y las acciones se muestran en una sección nativa plegable **Gestionar calle**, dentro de la fila seleccionada. Empieza cerrada y no ocupa espacio permanente. El contenido abierto participa en el scroll normal de la lista; no se superpone a las otras filas. Para personas y refugios se utiliza **Ver detalle**.

Si la selección queda fuera de la categoría o del filtro, **Mostrar selección** la recupera en la lista sin seleccionar otra entidad ni mover el mapa. Se mantienen el mismo detalle y el mismo controlador de cierre/apertura.

Validación del ajuste: **51/51 pruebas**, typecheck, lint y build correctos. Se añadieron dos comprobaciones de revelado de selección e inspector único/plegado. En navegador se midió la misma altura de lista antes y después de abrir la gestión: 169 px en escritorio 1366×768 y 352 px en móvil 390×844. La siguiente fila comienza justo después de la seleccionada, sin superposición. Se comprobó que puede seleccionarse otra calle con la gestión abierta y que no hay desbordamiento horizontal móvil. Se comprobó el estado de partida finalizada y se capturó posteriormente una ronda 3 pausada del entorno local. No se enviaron órdenes para probar este ajuste visual.

Estas capturas corresponden a la revisión actual; las anteriores documentan la iteración con tarjeta fija:

- [Escritorio: gestión plegable dentro de la fila](gestion-inline-desktop.png)
- [Móvil: gestión plegable](gestion-inline-mobile.png)

Archivos de este ajuste: App.tsx, EntityExplorer.tsx, entity-explorer.ts, entity-explorer.test.tsx y estilos. Sin cambios en backend, contratos ni reglas.
