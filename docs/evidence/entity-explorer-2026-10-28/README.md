# Explorador compacto de entidades

Revisión local del 28 de octubre de 2026. Rama `prueba`, HEAD `569d69e83676ad43d114ec3f51a85fb82e3c225f`. El árbol estaba limpio al empezar. No se encontró un `AGENTS.md` en el repositorio; se reutilizan los contratos y límites de frontend ya revisados en SPEC y la guía de ownership. Los cambios quedan sin commit.

## Problema y solución

`App.tsx` contenía un único select nativo con sobrevivientes, refugios y 368 segmentos. Su menú salía del panel y dificultaba buscar y distinguir entidades.

Se reemplazó exclusivamente esa sección por `EntityExplorer`: título **Explorar**, control segmentado de categorías, búsqueda contextual, filtro, conteo y lista de resultados dentro del panel. El detalle existente sigue debajo, sin recrearlo. El formulario de órdenes del operador permanece separado.

- Las categorías son radios nativos agrupados con fieldset/legend; tienen selección única y navegación de teclado por flechas. No se declaran roles de tabs/listbox incompletos.
- Cada categoría conserva su búsqueda. Buscar ignora mayúsculas, acentos y espacios externos; no modifica los identificadores originales. El botón de limpiar devuelve el foco al campo de búsqueda.
- Sobrevivientes: Todos/Vivos/Evacuados/Mordidos, orden estable por identificador, objetivo solo cuando existe. Ningún estado se oculta por defecto.
- Refugios: identificador, ocupantes, capacidad y reservas publicados. Antes de recibir snapshot se muestra la capacidad estática y **Ocupación y reservas: sin dato**; no se afirma accesibilidad ni se confunden reservas con plazas libres.
- Segmentos: una fila por segmentoId; nombre, zona y tramo de las etiquetas existentes, con orden natural. Se permite buscar por la etiqueta completa o el ID técnico y filtrar cierres activos. Sin snapshot se indica **Sin partida**; con snapshot se distingue **Cerrado** de **Sin cierre activo**.
- La lista muestra todos los resultados, sin paginación oculta ni virtualización. Tiene una altura máxima `clamp(144px, 28svh, 300px)`, scroll propio y contención del scroll al alcanzar el borde. El scroll general del panel existente permite llegar al detalle y a los controles; no se añadió otro contenedor desplazable al explorador.
- Filas con área táctil de al menos 64 px, texto completo que ajusta al ancho, badge textual, acción **Ver en mapa**, `aria-pressed` y marca textual **Seleccionado**. Las categorías tienen 44 px de altura.

## Selección y actualizaciones

Las filas invocan el `selectEntity` existente con `{kind, id}`. Se reutilizan `MapSelectionFocus`, `SelectedSegment` y `ContextPanel`. Seleccionar centra/resalta como antes; escribir, cambiar de categoría, filtrar o recibir snapshots no llama al centrado. Todas las direcciones de un segmento siguen resaltadas.

Cambiar categoría no selecciona el primer resultado ni borra la selección. Si la selección queda fuera de la categoría/filtro, se muestra una aclaración y se mantiene su detalle. Una entidad que desaparece produce un aviso, usando la reconciliación del store existente.

Los updates de la misma partida conservan búsqueda, filtro, foco, scroll y selección por identificador. Un cambio de gameId o graphVersion crea un nuevo ámbito de exploración y reinicia búsqueda/filtros. Se mantienen estados diferenciados de carga, ausencia de partida, lista vacía, búsqueda sin coincidencias y grafo incompatible. La incompatibilidad bloquea el explorador y conserva la comprobación existente del mapa.

La comprobación por teclado detectó que Enter sobre un marcador abría su popup sin seleccionar la entidad. Se añadió el mismo handler de selección a Enter para los marcadores de personas y refugios, manteniendo coherencia con las filas.

No se cambiaron el store, backend, routing, DTO, grafo, cámaras, presets, reglas, controles del operador ni dependencias. No se introdujeron nombres ni datos ilustrativos en la interfaz. Explorar no envía órdenes.

## Archivos

Modificados:

- `frontend/src/app/App.tsx`: reemplaza el select mixto por el nuevo componente.
- `frontend/src/components/LiveMap.tsx`: selección compartida al activar marcadores con Enter.
- `frontend/src/styles/index.css`: estilos acotados al explorador y retiro de la clase del antiguo select.

Nuevos:

- `frontend/src/components/EntityExplorer.tsx`: UI, estado local por categoría, avisos y ámbito de partida/grafo.
- `frontend/src/lib/entity-explorer.ts`: modelo de presentación, normalización, filtros y agrupación.
- `frontend/src/lib/entity-explorer.test.tsx`: 14 pruebas nuevas.
- Este informe y cuatro capturas locales.

Fuentes reutilizadas: `WorldSnapshot.survivors`, `shelters`, `blockedEdges`; `MantaGraph.refugios`; `useSegments` y su catálogo de nombres vinculado a graphVersion; `selection/selectEntity` del store. No se consulta ningún servicio de búsqueda externo. El ID técnico del segmento sigue en el detalle existente.

## Verificación

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
git diff --check
```

Resultado: typecheck, lint y build correctos; **41/41 pruebas** (27 anteriores y 14 nuevas). Las nuevas cubren categorías sin selección implícita, búsquedas independientes, mayúsculas/acentos, limpieza, ausencia de coincidencias, estados y filtros de personas, datos ausentes de refugios, agrupación de direcciones, cierres activos, selección compartida, cambio de partida, actualización de estado sin perder selección, carga y grafo incompatible.

Verificación visual real en `localhost:5173`, escritorio 1440×1000 y móvil 390×844:

- Los 368 segmentos son accesibles dentro de la lista; el menú anterior ya no existe.
- Buscar “universidad” encuentra seis segmentos reales; no cambia el mapa al escribir ni al cambiar categoría.
- Nombre largo del catálogo existente: “Avenida Jamie Hodges El Luchador”; no rompe el ancho.
- La búsqueda inexistente muestra un estado vacío y permite limpiar el campo.
- Filtro visible de Mordidos, restauración de búsqueda por categoría, y selección de refugio mediante Enter en el marcador reflejada en la fila y detalle.
- Móvil sin desbordamiento horizontal; categorías de 44 px y lista que no invade el mapa.
- Sin errores de JavaScript durante el recorrido de exploración. Se observaron cero solicitudes POST en el recorrido de búsqueda/filtros; la comprobación 401 de sesión sin autenticación sigue perteneciendo al flujo existente, fuera de este cambio.

Para comprobar updates sin modificar la partida del backend, se inyectaron snapshots de prueba **solo en el store del navegador**, y luego se recargó para volver al estado autoritativo. Se verificaron foco conservado, scroll de lista conservado en 400 px, reinicio de categoría/búsqueda/selección al cambiar gameId y aviso al desaparecer la entidad. Las capturas se tomaron después de recargar, con datos de la partida local real; los fixtures no se incluyen como datos de producto.

Capturas revisadas visualmente:

- [Escritorio: búsqueda y selección](desktop.png)
- [Escritorio: lista de 368 resultados](desktop-many-results.png)
- [Móvil: nombre largo y selección conservada](mobile.png)
- [Móvil: búsqueda sin coincidencias](mobile-no-results.png)

## Revisión manual

1. Recarga tu frontend local y abre el panel contextual.
2. En **Explorar**, cambia entre las tres categorías: el mapa debe conservar su vista.
3. Busca un identificador de persona; prueba Vivos/Evacuados/Mordidos y limpia la búsqueda.
4. En Segmentos, busca una calle, zona o ID. Selecciona una fila para ver su detalle y el tramo completo resaltado.
5. Cambia de categoría o escribe una búsqueda que excluya esa selección: el detalle debe conservarse con una aclaración.
6. Usa Tab, flechas en categorías y Enter en resultados o marcadores. Prueba un ancho móvil y el scroll de la lista.

Los resultados están limitados por lo publicado: no se infieren rutas, accesibilidad de refugios ni motivos de espera. No hay persistencia de búsqueda tras recarga; se conserva por categoría solo durante la partida abierta. No se hicieron commits, push ni despliegues.
