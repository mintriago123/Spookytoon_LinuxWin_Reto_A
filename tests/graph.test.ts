import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { normalize } from "../scripts/normalize-graph.ts";
import type { OsmData } from "../scripts/normalize-graph.ts";
import type { GraphConfig } from "../scripts/graph-config.ts";
import { parseConfig } from "../scripts/graph-config.ts";
import { buildQuery, extract } from "../scripts/extract-manta-osm.ts";
import { publish } from "../scripts/publish-graph.ts";
import { validateGraph } from "../backend/src/modules/graph/validate-graph.ts";
import { loadGraph } from "../backend/src/modules/graph/load-graph.ts";
import type { MantaGraph } from "../backend/src/contracts/types.ts";

// Geometría sintética exclusivamente para pruebas; no representa Manta.
function fixture(tags: Record<string, string> = {}) {
  const zones: GraphConfig["zones"] = ["Tarqui", "Los Esteros", "Barbasquillo", "Jocay"].map((name, i) => {
    const left = i === 0 ? -0.01 : (i * 64 - 0.5) / 1000;
    const right = ((i + 1) * 64 - 0.5) / 1000;
    return { name: name as GraphConfig["zones"][number]["name"], polygon: [[left, -1], [right, -1], [right, 1], [left, 1], [left, -1]] };
  });
  const config: GraphConfig = {
    bbox: [-1, -1, 1, 1], zones,
    refugios: [1, 85, 170, 256].map((node, i) => ({ id: `s${i}`, nodoId: `osm-node-${node}`, capacidad: 10 })),
  };
  const osm: OsmData = {
    osm3s: { timestamp_osm_base: "2026-10-26T00:00:00Z" },
    elements: [
      ...Array.from({ length: 256 }, (_, i) => ({ type: "node" as const, id: i + 1, lat: 0, lon: i / 1000 })),
      { type: "way", id: 100, nodes: Array.from({ length: 256 }, (_, i) => i + 1), tags: { highway: "residential", ...tags } },
    ],
  };
  return { config, osm };
}
function graph() { const { config, osm } = fixture(); return normalize(osm, config); }

test("normalización reproducible: orden OSM no cambia bytes ni versión, sentidos comparten segmento", () => {
  const { config, osm } = fixture();
  const first = normalize(osm, config);
  const second = normalize({ ...osm, elements: [...osm.elements].reverse() }, config);
  assert.deepEqual(first, second);
  assert.equal(first.nodos.length, 256);
  assert.equal(first.aristas.length, 510);
  const edge = first.aristas[0];
  assert(first.aristas.some(e => e.segmentoId === edge.segmentoId && e.origen === edge.destino && e.destino === edge.origen));
  assert(first.aristas.every(e => e.distancia_m > 110 && e.distancia_m < 112));
  assert.match(first.metadata.osmAttribution, /OpenStreetMap/);
});

for (const oneway of ["yes", "-1", "no"]) {
  test(`respeta oneway=${oneway}`, () => {
    const { config, osm } = fixture({ oneway });
    const result = normalize(osm, config);
    assert.equal(result.aristas.length, oneway === "no" ? 510 : 255);
    if (oneway !== "no") assert(result.aristas.every(e => {
      const from = Number(e.origen.slice(9)); const to = Number(e.destino.slice(9));
      return oneway === "yes" ? to > from : to < from;
    }));
  });
}

test("rotondas son dirigidas por defecto y oneway=no revoca la regla", () => {
  for (const [tags, count] of [[{ junction: "roundabout" }, 255], [{ junction: "roundabout", oneway: "no" }, 510]] as const) {
    const { config, osm } = fixture(tags);
    assert.equal(normalize(osm, config).aristas.length, count);
  }
});

test("el modo peatonal genera ambos sentidos e ignora oneway vehicular", () => {
  const { config, osm } = fixture({ oneway: "yes", junction: "roundabout" });
  config.directionMode = "pedestrian";
  const result = normalize(osm, config);
  assert.equal(result.aristas.length, 510);
  assert(result.aristas.every(edge => result.aristas.some(reverse => reverse.segmentoId === edge.segmentoId &&
    reverse.origen === edge.destino && reverse.destino === edge.origen)));
});

test("clasifica avenidas, callejones y puentes con factores contractuales", () => {
  for (const [tags, type, factor] of [
    [{ highway: "primary" }, "avenida", 1],
    [{ highway: "service", service: "alley" }, "callejon", 0.55],
    [{ bridge: "yes" }, "puente", 0.9],
  ] as const) {
    const { config, osm } = fixture(tags);
    const result = normalize(osm, config);
    assert(result.aristas.every(e => e.tipo === type && e.factor_velocidad === factor));
  }
});

test("cambiar capacidad cambia graphVersion", () => {
  const { config, osm } = fixture();
  const first = normalize(osm, config);
  config.refugios[0].capacidad++;
  assert.notEqual(normalize(osm, config).metadata.graphVersion, first.metadata.graphVersion);
});

const invalidCases: [string, (g: MantaGraph) => void, RegExp][] = [
  ["IDs duplicados", g => { g.nodos[1].id = g.nodos[0].id; }, /duplicado/],
  ["referencias ausentes", g => { g.aristas[0].destino = "missing"; }, /Referencia inválida/],
  ["auto-bucles", g => { g.aristas[0].destino = g.aristas[0].origen; }, /Auto-bucle/],
  ["factor incorrecto", g => { g.aristas[0].factor_velocidad = 0.3; }, /Factor incoherente/],
  ["refugios repetidos", g => { g.refugios[1].nodoId = g.refugios[0].nodoId; }, /mismo nodo/],
  ["capacidad cero", g => { g.refugios[0].capacidad = 0; }, /Grafo inválido/],
  ["menos de 250 nodos", g => { g.nodos.splice(249); }, /Grafo inválido/],
  ["más de 350 nodos", g => { while (g.nodos.length < 351) g.nodos.push({ ...g.nodos[0], id: `extra-${g.nodos.length}` }); }, /Grafo inválido/],
  ["coordenadas inválidas", g => { g.nodos[0].lat = 91; }, /Grafo inválido/],
  ["fecha inválida", g => { g.metadata.generatedAt = "ayer"; }, /Grafo inválido/],
  ["campos extra", g => { Object.assign(g, { secret: true }); }, /Grafo inválido/],
  ["zona faltante", g => { for (const n of g.nodos) if (n.zona === "Jocay") n.zona = "Tarqui"; }, /cuatro zonas/],
  ["segmento en nodos distintos", g => { g.aristas[0].segmentoId = g.aristas.at(-1)!.segmentoId; }, /Segmento incoherente/],
  ["sin camino dirigido a refugio", g => { g.aristas = g.aristas.filter(e => e.origen !== "osm-node-2"); }, /sin camino dirigido/],
];
for (const [name, mutate, message] of invalidCases) test(`rechaza ${name}`, () => {
  const value = graph(); mutate(value);
  assert.throws(() => validateGraph(value), message);
});

test("rechaza datos incompletos y zonas ambiguas sin inventar información", () => {
  assert.throws(() => parseConfig({ bbox: null }), /bbox/);
  const { osm, config } = fixture();
  assert.throws(() => normalize(osm, { ...config, refugios: [] }), /cuatro refugios/);
  config.zones[1].polygon = config.zones[0].polygon;
  assert.throws(() => normalize(osm, config), /ambiguas/);
  const other = fixture(); other.osm.elements.shift();
  assert.throws(() => normalize(other.osm, other.config), /nodoId.*no corresponde/);
  const reversible = fixture({ oneway: "reversible" });
  assert.throws(() => normalize(reversible.osm, reversible.config), /oneway requiere revisión/);
});

test("no conecta nodos saltándose puntos OSM excluidos", () => {
  const { osm, config } = fixture();
  config.selectedNodeIds = Array.from({ length: 256 }, (_, i) => `osm-node-${i + 1}`).filter(id => id !== "osm-node-100");
  const result = normalize(osm, config);
  assert.equal(result.nodos.length, 255);
  assert(!result.aristas.some(e => [e.origen, e.destino].includes("osm-node-100")));
  assert(!result.aristas.some(e => e.origen === "osm-node-99" && e.destino === "osm-node-101"));
});

test("consulta Overpass incluye geometría de nodos y restringe bbox", () => {
  const query = buildQuery([-1, -81, 0, -80]);
  assert.match(query, /\(-1,-81,0,-80\)/);
  assert.match(query, /out body;>;out skel qt;/);
});

test("JSON Schema coincide con la fuente canónica de SPEC.md", async () => {
  const spec = await readFile(new URL("../SPEC.md", import.meta.url), "utf8");
  const block = spec.match(/### 2\.1[\s\S]*?```json\n([\s\S]*?)\n```/);
  assert(block);
  const schema = JSON.parse(await readFile(new URL("../backend/src/contracts/graph.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(schema, JSON.parse(block[1]));
});

test("extracción conserva fuente y checksum y rechaza respuestas parciales", async t => {
  const root = await mkdtemp(join(tmpdir(), "spooky-extract-"));
  try {
    const config = join(root, "config.json"); const output = join(root, "osm.json");
    await writeFile(config, JSON.stringify({ bbox: [-1, -81, 0, -80] }));
    const { osm } = fixture();
    const mock = t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      assert.equal(init.method, "POST");
      assert.match(String(init.body), /data=/);
      return new Response(JSON.stringify(osm), { status: 200 });
    });
    await extract(config, output);
    const bytes = await readFile(output);
    const source = JSON.parse(await readFile(`${output}.source.json`, "utf8"));
    assert.equal(source.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(source.osmBaseTimestamp, osm.osm3s.timestamp_osm_base);
    assert.equal(source.license, "ODbL-1.0");
    mock.mock.mockImplementation(async () => new Response(JSON.stringify({ ...osm, remark: "runtime error: timeout" })));
    await assert.rejects(extract(config, output), /Extracción incompleta/);
    assert.deepEqual(await readFile(output), bytes);
    mock.mock.mockImplementation(async () => new Response("overloaded", { status: 429 }));
    await assert.rejects(extract(config, output), /HTTP 429/);
    await assert.rejects(extract(config, output, "http://example.com"), /HTTPS/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("publicación, manifiesto, carga inmutable e índices de adyacencia", async () => {
  const root = await mkdtemp(join(tmpdir(), "spooky-graph-"));
  try {
    const source = join(root, "input.json");
    const bytes = JSON.stringify(graph());
    await writeFile(source, bytes);
    await publish(source, root);
    const backendPath = join(root, "backend/data/grafo_manta.json");
    assert.deepEqual(await readFile(backendPath), await readFile(join(root, "frontend/public/data/grafo_manta.json")));
    const manifest = JSON.parse(await readFile(join(root, "backend/data/graph-manifest.json"), "utf8"));
    assert.equal(manifest.sha256, createHash("sha256").update(bytes).digest("hex"));
    const loaded = await loadGraph(backendPath, manifest);
    assert.equal(loaded.nodeIndex.size, 256);
    assert.equal(loaded.edgeIndex.size, 510);
    assert.equal(loaded.outEdges[loaded.nodeIndex.get("osm-node-1")!].length, 1);
    assert.equal(loaded.inEdges[loaded.nodeIndex.get("osm-node-1")!].length, 1);
    assert.throws(() => { loaded.graph.nodos[0].lat = 45; }, TypeError);
    await assert.rejects(loadGraph(backendPath, { ...manifest, sha256: "incorrecto" }), /manifiesto/);
    await assert.rejects(loadGraph(backendPath, { ...manifest, graphVersion: "incorrecta" }), /manifiesto/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("publicar artefacto inválido conserva archivos existentes", async () => {
  const root = await mkdtemp(join(tmpdir(), "spooky-invalid-"));
  try {
    const directory = join(root, "backend/data"); await mkdir(directory, { recursive: true });
    const target = join(directory, "grafo_manta.json"); await writeFile(target, "existing");
    const source = join(root, "invalid.json"); await writeFile(source, "{}");
    await assert.rejects(publish(source, root), /Grafo inválido/);
    assert.equal(await readFile(target, "utf8"), "existing");
  } finally { await rm(root, { recursive: true, force: true }); }
});
