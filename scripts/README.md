# Scripts de datos geográficos

Estos scripts producen y validan el artefacto consumido por Backend y Frontend. El contrato está en [SPEC.md](../SPEC.md), secciones 1 y 2.

## Flujo

1. **extract-manta-osm.ts** obtiene las vías configuradas para Manta, conserva atribución OSM/ODbL y ajusta cada refugio al nodo vial más cercano a su acceso.
2. **normalize-graph.ts** crea nodos, arcos dirigidos, segmentoId, zonas e IDs estables.
3. **validate-graph.ts** valida JSON Schema e invariantes semánticas, incluidos cuatro refugios y sus capacidades.
4. **publish-graph.ts** copia el mismo artefacto a **backend/data/** y **frontend/public/data/**; comprueba graphVersion y SHA-256.

## Ejecución

Requiere Node.js 24.12 o superior de la serie 24 y npm. Los scripts TypeScript
se ejecutan con el soporte nativo de Node; `typecheck` verifica sus tipos.

```bash
npm ci
npm run graph:extract -- scripts/manta.config.json scripts/data/manta.osm.json
npm run graph:normalize -- scripts/data/manta.osm.json scripts/manta.config.json scripts/data/grafo_manta.json
npm run graph:validate -- scripts/data/grafo_manta.json
npm run graph:publish -- scripts/data/grafo_manta.json
npm test
npm run typecheck
```

Si Overpass está saturado, el extractor también admite la API de mapa OSM 0.6,
divide el bbox en teselas y las subdivide ante el límite de 50.000 nodos:

```bash
npm run graph:extract -- scripts/manta.config.json scripts/data/manta.osm.json https://www.openstreetmap.org/api/0.6/map
```

La configuración concreta está en `scripts/manta.config.json`; la plantilla
`scripts/manta.config.example.json` muestra la estructura. `bbox` usa `[sur,
oeste, norte, este]`; cada polígono usa coordenadas `[longitud, latitud]` y
repite el primer punto al final. Cada refugio declara `zona`, coordenadas de
`acceso` y capacidad; no hace falta conocer el ID OSM antes de extraer:

```json
{
  "id": "R-TARQUI", "zona": "Tarqui",
  "acceso": { "lat": -0.9502, "lng": -80.7165 }, "capacidad": 60
}
```

El extractor identifica nodos presentes en vías OSM admitidas, elige el más
cercano geodésicamente al acceso dentro de su zona y registra `nodoId`,
coordenadas del snap y distancia en el archivo `.source.json`. Si el snap supera
`shelterSnapLimitM` (750 m en la configuración actual), el flujo se detiene para
evitar enlazar una entrada a una calle lejana. Los límites compartidos se
resuelven por cercanía a los anclajes de refugio, con desempate estable por nombre
de zona.

## Selección y trazabilidad

- La consulta trae vías y sus nodos desde Overpass. Se conservan el JSON original
  y un archivo `.source.json` con consulta, endpoint, bbox, fecha OSM, fecha de
  extracción, atribución, licencia y SHA-256. Archivar ambos para reproducir la
  fuente. `scripts/data/` se excluye de Git por su tamaño.
- Se retienen nodos dentro del bbox y de las zonas configuradas. Los polígonos
  actuales son particiones operativas de Voronoi recortadas al bbox y ancladas en
  las cuatro entradas; no son límites administrativos oficiales. `targetGraphNodes`
  fija el tamaño objetivo (300 en la configuración actual): el extractor
  conserva todos los caminos disponibles entre refugios, mantiene
  los accesos con catchment pequeño y completa con intersecciones conectadas.
  Los nodos de acceso se conservan aunque no sean intersecciones. Así se evita
  que el recorte pierda una ruta de refugio que sí existe en OSM.
  `selectedNodeIds` sigue disponible para una selección manual explícita.
- Con `compactIntersections: true`, el grafo conserva intersecciones y accesos
  seleccionados; cada arista compactada sigue una sola vía OSM y su distancia es
  la suma de los tramos originales, respetando sentidos y etiquetas. El contrato
  no almacena la geometría intermedia, así que un consumidor que dibuje líneas
  rectas entre nodos mostrará cuerdas aproximadas en vez de las curvas de la vía.
  No se agregan conexiones por cercanía ni se inventan puentes.
- `directionMode: "pedestrian"` crea ambos arcos para cada segmento y omite las
  restricciones vehiculares `oneway` de OSM; es el modo de `manta.config.json`
  porque las entidades del juego caminan. `directionMode: "vehicle"` mantiene
  sentidos OSM para usos que modelen tráfico motorizado. Cada par de sentidos
  comparte `segmentoId`.
- `bridge` genera `puente`; `service=alley`, `callejon`; vías primary/secondary/
  tertiary/trunk/motorway y sus enlaces, `avenida`; las demás vías admitidas,
  `calle`. Los factores son exactamente los de SPEC.md. Se excluyen áreas y
  accesos `no/private`.
- `generatedAt` conserva la marca de tiempo de Overpass; para la API de mapa se
  usa la marca más reciente entre los elementos OSM devueltos. El `.source.json`
  registra cuál de las dos marcas se usó y la fecha de extracción. `graphVersion`
  combina esa marca con un digest del contenido normalizado; repetir la
  normalización de la misma entrada produce los mismos bytes.

`targetGraphNodes` cuenta los vértices seleccionados. El resumen de selección en
`.source.json` registra cuántos son intersecciones según uso por varias vías o
grado vial igual o mayor que tres; los restantes pueden ser nodos de acceso de
refugio.

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

El backend carga `loadGraph(path, manifest)` al arrancar: rechaza el archivo si
falla su validación o no coincide con el manifiesto, congela el contenido y
genera índices enteros con adyacencia entrante y saliente. `/health/ready`
permanece en 503 hasta instalar el primer plan sincronizado.

Las pruebas combinan geometría sintética, el grafo real publicado, contratos HTTP
y publicación en directorios temporales; el benchmark local de 200 peticiones se
ejecuta con `npm run benchmark:routing`.

Fuentes: [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL),
[oneway](https://wiki.openstreetmap.org/wiki/Key:oneway),
[licencia y atribución OSM](https://www.openstreetmap.org/copyright).

No guardar credenciales ni asumir coordenadas/capacidades de refugios. El grafo
de Manta tiene validación fuerte y copias publicadas iguales; los datos OSM y su
licencia quedan registrados en el archivo `.source.json` local.
