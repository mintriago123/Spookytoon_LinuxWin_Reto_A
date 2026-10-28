import { describe, expect, it, vi } from "vitest";
import { loadGameConfiguration } from "./game-configuration";

const expected = { gameId: "game/one", roundId: 1 as const, graphVersion: "manta-v1" };
function config() {
  return { ...expected, configurationIdentity: { format: "spookython-round-configuration-v1", graphVersion: "manta-v1",
    revision: "a".repeat(64), provenance: "recorded-at-start" },
  random: { seed: " exact seed ", algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" },
  round: { roundId: 1, survivorCount: 20, durationMs: 300000, turnIntervalMs: 2000, turnCount: 150,
    zombieCounts: { caminante: 8, corredor: 0, horda: 0, dormido: 0 }, eventPlan: [] } };
}

describe("configuración guardada", () => {
  it("consulta autenticada sin caché y conserva identidad, semilla y procedencia", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(config()));
    const signal = new AbortController().signal;
    expect(await loadGameConfiguration("/api", expected, signal, fetcher)).toEqual(config());
    expect(fetcher).toHaveBeenCalledWith("/api/simulador/configuracion/game%2Fone", {
      credentials: "include", cache: "no-store", signal,
    });
    const legacy = config();
    legacy.configurationIdentity.provenance = "derived-from-legacy-checkpoint";
    fetcher.mockResolvedValue(Response.json(legacy));
    expect((await loadGameConfiguration("", expected, signal, fetcher)).configurationIdentity.provenance).toBe("derived-from-legacy-checkpoint");
  });

  it.each([{ gameId: "another" }, { roundId: 2 }, { graphVersion: "another" }, { random: {} },
    { configurationIdentity: {} }])("rechaza datos incompatibles con la partida: %j", async difference => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...config(), ...difference }));
    await expect(loadGameConfiguration("", expected, new AbortController().signal, fetcher)).rejects.toThrow("no corresponde");
  });

  it("no acepta HTML ni un error 404 como configuración", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<!doctype html>"));
    await expect(loadGameConfiguration("", expected, new AbortController().signal, fetcher)).rejects.toThrow();
    fetcher.mockResolvedValue(Response.json({ error: { message: "Otra partida", code: "GAME_NOT_FOUND", requestId: "r1" } }, { status: 404 }));
    await expect(loadGameConfiguration("", expected, new AbortController().signal, fetcher)).rejects.toMatchObject({ details: { code: "GAME_NOT_FOUND" } });
  });
});
