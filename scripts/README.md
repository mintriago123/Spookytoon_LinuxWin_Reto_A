# Scripts de datos geográficos

Estos scripts producen y validan el artefacto consumido por Backend y Frontend. El contrato está en [SPEC.md](../SPEC.md), secciones 1 y 2.

## Flujo

1. **extract-manta-osm.ts** obtiene las vías/intersecciones configuradas para Manta y conserva atribución OpenStreetMap/ODbL.
2. **normalize-graph.ts** crea nodos, arcos dirigidos, segmentoId, zonas e IDs estables.
3. **validate-graph.ts** valida JSON Schema e invariantes semánticas, incluidos cuatro refugios y sus capacidades.
4. **publish-graph.ts** copia el mismo artefacto a **backend/data/** y **frontend/public/data/**; comprueba graphVersion y SHA-256.

## Ejecución

Requiere Node.js 24.12 o superior de la serie 24 y npm. Los scripts TypeScript
se ejecutan con el soporte nativo de Node; `typecheck` verifica sus tipos.

```bash
npm ci
cp scripts/manta.config.example.json scripts/manta.config.json
# Completar bbox, polígonos y refugios revisados antes de normalizar.
npm run graph:extract -- scripts/manta.config.json scripts/data/manta.osm.json
npm run graph:normalize -- scripts/data/manta.osm.json scripts/manta.config.json scripts/data/grafo_manta.json
npm run graph:validate -- scripts/data/grafo_manta.json
npm run graph:publish -- scripts/data/grafo_manta.json
npm test
npm run typecheck
```

La plantilla está incompleta intencionalmente: aún no existen ubicaciones,
capacidades ni límites de zonas revisados. `bbox` usa `[sur, oeste, norte, este]`;
cada polígono usa coordenadas `[longitud, latitud]` y repite el primer punto al
final. Debe haber exactamente cuatro zonas y cuatro refugios distintos:

```json
{ "id": "identificador-revisado", "nodoId": "osm-node-ID_REAL", "capacidad": 0 }
```

Ese ejemplo describe los campos; **no es una configuración válida**. Sustituir
el ID por un nodo presente en la extracción y la capacidad por un entero
positivo confirmado por el equipo. No se asignan refugios automáticamente.
La extracción solo requiere `bbox`; los polígonos y refugios se exigen al
normalizar. Un nodo sobre límites compartidos o polígonos superpuestos causa
error: revisar los polígonos, sin asignar una zona arbitraria.

## Selección y trazabilidad

- La consulta trae vías y sus nodos desde Overpass. Se conservan el JSON original
  y un archivo `.source.json` con consulta, endpoint, bbox, fecha OSM, fecha de
  extracción, atribución, licencia y SHA-256. Archivar ambos para reproducir la
  fuente. `scripts/data/` se excluye de Git por su tamaño.
- Se retienen nodos dentro del bbox y de las zonas configuradas. Opcionalmente,
  `selectedNodeIds` limita la selección a una lista revisada de IDs
  `osm-node-123`. No se recorta automáticamente a 300 nodos: ajustar la selección
  hasta obtener 250–350 nodos, las cuatro zonas y caminos dirigidos a refugios.
- Cada par consecutivo de nodos OSM genera un segmento. No se saltan puntos
  intermedios, no se agregan conexiones por cercanía y no se inventan puentes.
  Puntos de curvas también cuentan como nodos, conservando la geometría fuente.
- Los IDs dependen de la vía y sus nodos OSM. Ambos sentidos comparten
  `segmentoId`; se respeta `oneway=yes/no/-1` y el sentido implícito de rotondas
  y autopistas. Valores reversibles y restricciones condicionales requieren
  revisión y detienen la normalización. Este artefacto representa el grafo de
  simulación de SPEC.md, no un navegador vial con restricciones de giro.
- `bridge` genera `puente`; `service=alley`, `callejon`; vías primary/secondary/
  tertiary/trunk/motorway y sus enlaces, `avenida`; las demás vías admitidas,
  `calle`. Los factores son exactamente los de SPEC.md. Se excluyen áreas y
  accesos `no/private`.
- `generatedAt` conserva la fecha de la base OSM. `graphVersion` combina esa
  fecha con un digest del contenido normalizado; repetir la normalización de
  la misma entrada produce los mismos bytes.

## Validación, publicación y carga

`backend/src/contracts/graph.schema.json` proyecta el JSON Schema de SPEC.md
§2.1. El validador añade unicidad de IDs, referencias, coherencia de segmentos,
factores, cuatro zonas, refugios distintos y alcanzabilidad dirigida de cada
nodo hacia un refugio. Un grafo inválido no se escribe ni publica.

`graph:publish` copia los mismos bytes a `backend/data/grafo_manta.json` y
`frontend/public/data/grafo_manta.json`, además de un `graph-manifest.json` en
cada ubicación con `graphVersion` y SHA-256 **externo** al grafo. Comprueba
igualdad de ambas copias. Ejecutarlo antes de los builds, con consumidores
detenidos: cada archivo se reemplaza mediante rename, pero no hay transacción
entre los dos directorios. Si se interrumpe, repetir y verificar antes de construir.

El backend puede usar `loadGraph(path, manifest)`: rechaza el archivo si falla
su validación o no coincide con el manifiesto, congela el contenido y genera
índices enteros con adyacencia entrante y saliente. La integración de readiness
con el servidor se hará al implementar el arranque del backend.

Las pruebas usan únicamente datos sintéticos y publican en directorios temporales;
no se presentan como un grafo real de Manta. No hay todavía artefacto desplegable.

Fuentes: [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL),
[oneway](https://wiki.openstreetmap.org/wiki/Key:oneway),
[licencia y atribución OSM](https://www.openstreetmap.org/copyright).

No guardar credenciales ni asumir coordenadas/capacidades de refugios. El grafo
no se considera listo hasta pasar validación y revisión del equipo.
