import { loadGraph } from "../backend/src/modules/graph/load-graph.ts";
import { isMain, fail } from "./graph-config.ts";

if (isMain(import.meta.url)) {
  const path = process.argv[2];
  if (!path) fail(new Error("Uso: npm run graph:validate -- grafo.json"));
  else loadGraph(path).then(({ graph, sha256 }) => console.log(JSON.stringify({
    graphVersion: graph.metadata.graphVersion, sha256,
    nodos: graph.nodos.length, aristas: graph.aristas.length, refugios: graph.refugios.length,
  }, null, 2))).catch(fail);
}
