import { createHash } from "node:crypto";
import { canonicalJson } from "../../contracts/canonical-json.ts";
import type { MantaGraph } from "../../contracts/types.ts";
import type { ConfigurationIdentity, Immutable, RoundConfig } from "./types.ts";

/** Identifica grafo y ronda; semilla/descriptor RNG se conservan por separado. */
export function createConfigurationIdentity(graph: Immutable<MantaGraph>, config: Immutable<RoundConfig>): ConfigurationIdentity {
  const format = "spookython-round-configuration-v1" as const;
  return { format, graphVersion: graph.metadata.graphVersion,
    revision: createHash("sha256").update(canonicalJson({ format, graph, config }), "utf8").digest("hex"),
    provenance: "recorded-at-start" };
}
