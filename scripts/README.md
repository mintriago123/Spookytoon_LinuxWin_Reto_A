# Scripts de datos geográficos

Estos scripts producen y validan el artefacto consumido por Backend y Frontend. El contrato está en [SPEC.md](../SPEC.md), secciones 1 y 2.

## Flujo

1. **extract-manta-osm.ts** obtiene las vías/intersecciones configuradas para Manta y conserva atribución OpenStreetMap/ODbL.
2. **normalize-graph.ts** crea nodos, arcos dirigidos, segmentoId, zonas e IDs estables.
3. **validate-graph.ts** valida JSON Schema e invariantes semánticas, incluidos cuatro refugios y sus capacidades.
4. **publish-graph.ts** copia el mismo artefacto a **backend/data/** y **frontend/public/data/**; comprueba graphVersion y SHA-256.

No guardar credenciales ni asumir coordenadas/capacidades de refugios. El grafo no se considera listo hasta pasar validación y revisión del equipo.
