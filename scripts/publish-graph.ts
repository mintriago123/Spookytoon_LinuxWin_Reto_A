import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGraph } from "../backend/src/modules/graph/validate-graph.ts";
import { isMain, fail } from "./graph-config.ts";

export async function publish(input: string, root = fileURLToPath(new URL("../", import.meta.url))) {
  const bytes = await readFile(input);
  const graph: unknown = JSON.parse(bytes.toString("utf8"));
  validateGraph(graph);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = Buffer.from(JSON.stringify({ graphVersion: graph.metadata.graphVersion, sha256 }, null, 2) + "\n");
  const directories = ["backend/data", "frontend/public/data"].map(dir => join(root, dir));
  // Validar antes de escribir. Renombrar cada archivo evita lecturas parciales.
  // Publicación para builds detenidos: no es una transacción entre directorios.
  for (const directory of directories) {
    for (const [name, content] of [["grafo_manta.json", bytes], ["graph-manifest.json", manifest]] as const) {
      const target = join(directory, name);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, content);
      await rename(temporary, target);
    }
  }
  for (const directory of directories) {
    if (!(await readFile(join(directory, "grafo_manta.json"))).equals(bytes) ||
      !(await readFile(join(directory, "graph-manifest.json"))).equals(manifest)) throw new Error("Las copias publicadas difieren");
  }
  console.log(`Publicado ${graph.metadata.graphVersion}; SHA-256 ${sha256}`);
}
if (isMain(import.meta.url)) {
  if (!process.argv[2]) fail(new Error("Uso: npm run graph:publish -- grafo.json"));
  else publish(process.argv[2]).catch(fail);
}
