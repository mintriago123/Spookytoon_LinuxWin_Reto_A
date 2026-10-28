import { describe, expect, it, vi } from "vitest";
import { prepareAndStartGame, prepareGame, startPreparedGame } from "./prepare-game";

const command = { gameId: "game-new", roundId: 1 as const, seed: " exact seed ", graphVersion: "manta-v1" };
const revision = "a".repeat(64);
const prepared = () => ({ ...command, preparationRevision: revision,
  round: { roundId: 1, survivorCount: 20, durationMs: 300000, turnIntervalMs: 2000, turnCount: 150,
    zombieCounts: { caminante: 8, corredor: 0, horda: 0, dormido: 0 }, eventPlan: [] } });
const started = () => ({ gameId: command.gameId, roundId: 1, status: "running", nextTurnId: 1 });
const signal = () => new AbortController().signal;

describe("preparación antes de iniciar", () => {
  it("prepara un reemplazo sin ejecutarlo y solo confirma contra el endpoint de reinicio", async () => {
    const restart = { sourceGameId: "source", sourceConfigurationRevision: "b".repeat(64), reuseSavedConfig: true };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...prepared(), restart }))
      .mockResolvedValueOnce(Response.json(started(), { status: 202 }));
    const preview = await prepareGame("/api", { ...command, restart }, signal(), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(preview.restart).toEqual(restart);
    await startPreparedGame("/api", preview, signal(), fetcher);
    expect(fetcher.mock.calls[1][0]).toBe("/api/simulador/reiniciar");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ gameId: command.gameId, roundId: 1,
      seed: command.seed, preparationRevision: revision, restart });
  });

  it.each([undefined, { sourceGameId: "other", sourceConfigurationRevision: "b".repeat(64), reuseSavedConfig: true },
    { sourceGameId: "source", sourceConfigurationRevision: "b".repeat(64), reuseSavedConfig: false }])(
    "no confirma una preparación con origen o modo de reinicio diferente: %j", async responseSource => {
      const restart = { sourceGameId: "source", sourceConfigurationRevision: "b".repeat(64), reuseSavedConfig: true };
      const fetcher = vi.fn().mockResolvedValue(Response.json({ ...prepared(), restart: responseSource }));
      await expect(prepareGame("", { ...command, restart }, signal(), fetcher)).rejects.toThrow("reinicio");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  it("usa exactamente la misma identidad y semilla y adjunta la revisión del servidor", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(prepared()))
      .mockResolvedValueOnce(Response.json(started(), { status: 202 }));
    const onPrepared = vi.fn();
    expect(await prepareAndStartGame("/api", command, onPrepared, signal(), fetcher)).toEqual(started());
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("/api/simulador/prevalidar");
    expect(options.credentials).toBe("include");
    expect(JSON.parse(options.body)).toEqual(command);
    expect(fetcher.mock.calls[1][0]).toBe("/api/simulador/iniciar");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ gameId: command.gameId,
      roundId: command.roundId, seed: command.seed, preparationRevision: revision });
    expect(onPrepared).toHaveBeenCalledOnce();
    expect(onPrepared).toHaveBeenCalledWith(prepared());
  });

  it.each([
    { gameId: "other" }, { roundId: 2 }, { seed: "changed" }, { graphVersion: "other" },
    { preparationRevision: "invalid" }, { round: {} },
  ])("no inicia si la preparación no corresponde: %j", async difference => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...prepared(), ...difference }));
    await expect(prepareAndStartGame("", command, vi.fn(), signal(), fetcher)).rejects.toThrow("preparación");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("HTML de fallback o error de validación nunca producen un inicio", async () => {
    for (const response of [new Response("<!doctype html>"), Response.json({
      error: { code: "GRAPH_VERSION_CONFLICT", message: "Grafo distinto", requestId: "request-1" },
    }, { status: 409 })]) {
      const fetcher = vi.fn().mockResolvedValue(response);
      await expect(prepareAndStartGame("", command, vi.fn(), signal(), fetcher)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("no inicia si cambia el estado local durante la preparación", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(prepared()));
    await expect(prepareAndStartGame("", command, () => { throw new Error("Partida cambió"); },
      signal(), fetcher)).rejects.toThrow("Partida cambió");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("no inicia si se cancela después de validar", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementationOnce(async () => {
      controller.abort();
      return Response.json(prepared());
    });
    await expect(prepareAndStartGame("", command, vi.fn(), controller.signal, fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("un conflicto en iniciar conserva el error contractual y nunca se reintenta", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(prepared())).mockResolvedValueOnce(Response.json({
      error: { code: "PREPARATION_CONFLICT", message: "Configuración cambió", requestId: "r2" },
    }, { status: 409 }));
    await expect(prepareAndStartGame("", command, vi.fn(), signal(), fetcher)).rejects.toMatchObject({
      details: { code: "PREPARATION_CONFLICT", requestId: "r2", status: 409 },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("una respuesta de inicio de otra partida no se asocia a la solicitada", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(prepared()))
      .mockResolvedValueOnce(Response.json({ ...started(), gameId: "another" }, { status: 202 }));
    await expect(prepareAndStartGame("", command, vi.fn(), signal(), fetcher)).rejects.toMatchObject({ kind: "uncertain" });
  });
});
