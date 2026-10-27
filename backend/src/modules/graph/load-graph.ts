import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MantaGraph } from "../../contracts/types.ts";
import { validateGraph } from "./validate-graph.ts";
import { buildAdjacency } from "./adjacency.ts";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function loadGraph(
  path: string | URL = new URL("../../../data/grafo_manta.json", import.meta.url),
  expected?: { graphVersion: string; sha256: string },
) {
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const graph: unknown = JSON.parse(bytes.toString("utf8"));
  validateGraph(graph);
  if (expected && (expected.sha256 !== sha256 || expected.graphVersion !== graph.metadata.graphVersion)) {
    throw new Error("El grafo no coincide con el manifiesto de build");
  }
  deepFreeze<MantaGraph>(graph);
  return { graph, sha256, ...buildAdjacency(graph) };
}
