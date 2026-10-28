import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRoundCatalog, sameRoundSummary } from "./round-catalog";
import type { RoundCatalog } from "../types/contracts";

function catalog() {
  return { graphVersion: "manta-v1", rounds: [1, 2, 3].map((roundId, index) => ({
    roundId, durationMs: 300000, turnIntervalMs: 2000, turnCount: 150,
    survivorCount: [20, 80, 200][index], zombieCounts: { caminante: 8, corredor: 0, horda: 0, dormido: 0 },
    eventPlan: [],
  })) };
}

afterEach(() => vi.unstubAllGlobals());

describe("catálogo efectivo de rondas", () => {
  it("detecta cambios del resumen sin depender del orden de las claves JSON", () => {
    const round = catalog().rounds[0] as RoundCatalog["rounds"][number];
    expect(sameRoundSummary(round, { ...round, zombieCounts: { dormido: 0, horda: 0, corredor: 0, caminante: 8 } })).toBe(true);
    expect(sameRoundSummary(round, { ...round, zombieCounts: { ...round.zombieCounts, caminante: 9 } })).toBe(false);
    expect(sameRoundSummary(round, { ...round, eventPlan: [{ eventId: "E1", edgeId: "edge-1",
      effectiveTurnId: 50, reason: "bloqueo-calle" }] })).toBe(false);
  });
  it("consulta con cookie, sin caché, conserva overrides y permite cancelar", async () => {
    const data = catalog();
    data.rounds[0].zombieCounts.caminante = 11;
    const fetcher = vi.fn().mockResolvedValue(Response.json(data));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect(await loadRoundCatalog("/api", signal)).toEqual(data);
    expect(fetcher).toHaveBeenCalledWith("/api/simulador/rondas", {
      credentials: "include", cache: "no-store", signal,
    });
  });

  it("rechaza HTML de fallback y errores de autenticación", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html>")));
    await expect(loadRoundCatalog("", new AbortController().signal)).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(loadRoundCatalog("", new AbortController().signal)).rejects.toThrow("HTTP 401");
  });

  it("rechaza rondas duplicadas y cantidades incompatibles con la ronda", async () => {
    const duplicate = catalog();
    duplicate.rounds[1] = duplicate.rounds[0];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(duplicate)));
    await expect(loadRoundCatalog("", new AbortController().signal)).rejects.toThrow("catálogo");
    const invalid = catalog();
    invalid.rounds[0].survivorCount = 80;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(invalid)));
    await expect(loadRoundCatalog("", new AbortController().signal)).rejects.toThrow("catálogo");
  });
});
