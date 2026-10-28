import { makeSnapshot as baseSnapshot } from "../test/fixtures";
import { describe, expect, it, vi } from "vitest";
import {
  checkOperatorSession,
  createSegmentCommand,
  loginOperator,
  OperatorControlError,
  scheduleSegmentCommand,
} from "./operator-controls";
import type { WorldSnapshot } from "../types/contracts";

function snapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    schemaVersion: "1.0.0",
    gameId: "game-a",
    roundId: 1,
    status: "running",
    turnId: 4,
    worldVersion: 4,
    graphVersion: "graph-v1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    zombies: [],
    survivors: [],
    shelters: [],
    blockedEdges: [],
    cameras: [],
    cameraObservations: [],
    metrics: baseSnapshot().metrics,
    ...overrides,
  };
}

describe("operator session and segment controls", () => {
  it("solo considera válida la sesión con el 204 contractual", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(checkOperatorSession("/api", fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/api/operador/sesion", {
      credentials: "include",
      cache: "no-store",
    });
  });

  it("no acepta HTML 200 como sesión y trata 401 como sesión ausente", async () => {
    await expect(checkOperatorSession("", async () => new Response("<html>frontend</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }))).rejects.toMatchObject({ details: { status: 200 } });
    await expect(checkOperatorSession("", async () => new Response(null, { status: 401 }))).resolves.toBe(false);
  });

  it("el login requiere 204 y conserva las cookies de sesión", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>fallback</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    await expect(loginOperator("/api", "secret", fetcher)).rejects.toBeInstanceOf(OperatorControlError);
    expect(fetcher).toHaveBeenCalledWith("/api/operador/sesion", expect.objectContaining({ credentials: "include" }));
  });

  it("propone el siguiente turno en pausa y deja el turno a cargo del servidor mientras corre", () => {
    const paused = createSegmentCommand({
      snapshot: snapshot({ status: "paused", turnId: 10 }),
      eventId: "event-1",
      edgeId: "edge-1",
      bloqueada: true,
      motivo: "prueba",
    });
    expect(paused.effectiveTurnId).toBe(11);

    const pausedExplicit = createSegmentCommand({
      snapshot: snapshot({ status: "paused", turnId: 10 }),
      eventId: "event-2",
      edgeId: "edge-1",
      bloqueada: false,
      motivo: "prueba",
      pausedEffectiveTurn: "12",
    });
    expect(pausedExplicit.effectiveTurnId).toBe(12);

    const running = createSegmentCommand({
      snapshot: snapshot({ status: "running", turnId: 10 }),
      eventId: "event-3",
      edgeId: "edge-1",
      bloqueada: true,
      motivo: "prueba",
      pausedEffectiveTurn: "12",
    });
    expect(running).not.toHaveProperty("effectiveTurnId");
  });

  it("rechaza localmente turnos pausados no enteros, pasados o fuera del máximo", () => {
    for (const pausedEffectiveTurn of ["4", "5.5", "151", "abc"]) {
      expect(() => createSegmentCommand({
        snapshot: snapshot({ status: "paused", turnId: 4 }),
        eventId: "event-1",
        edgeId: "edge-1",
        bloqueada: true,
        motivo: "prueba",
        pausedEffectiveTurn,
      })).toThrow();
    }
  });

  it("solo interpreta un 202 JSON coherente como recibo programado", async () => {
    const command = { eventId: "event-1", edgeId: "edge-1", bloqueada: true, motivo: "prueba" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      eventId: "event-1",
      segmentoId: "segment-1",
      effectiveTurnId: 8,
      status: "programado",
    }), { status: 202, headers: { "content-type": "application/json" } }));
    await expect(scheduleSegmentCommand("/api", command, "segment-1", fetcher)).resolves.toMatchObject({
      eventId: "event-1",
      segmentoId: "segment-1",
      effectiveTurnId: 8,
      status: "programado",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/simulador/bloquear-arista", expect.objectContaining({
      credentials: "include",
      body: JSON.stringify(command),
    }));
  });

  it("conserva un conflicto HTTP como rechazo con código e identificador", async () => {
    const fetcher = async () => Response.json({
      error: { code: "TURN_CONFLICT", message: "El turno cambió", requestId: "req-42" },
    }, { status: 409 });
    await expect(scheduleSegmentCommand("", {
      eventId: "event-1", edgeId: "edge-1", bloqueada: true, motivo: "prueba",
    }, "segment-1", fetcher)).rejects.toMatchObject({
      kind: "rejected",
      message: "El turno cambió",
      details: { code: "TURN_CONFLICT", requestId: "req-42", status: 409 },
    });
  });

  it("marca como inciertos el HTML de fallback, un recibo inválido y un fallo de red", async () => {
    const command = { eventId: "event-1", edgeId: "edge-1", bloqueada: true, motivo: "prueba" };
    const htmlFetcher = async () => new Response("<html>frontend</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    await expect(scheduleSegmentCommand("", command, "segment-1", htmlFetcher)).rejects.toMatchObject({ kind: "uncertain" });

    const malformedFetcher = async () => new Response("{}", {
      status: 202,
      headers: { "content-type": "application/json" },
    });
    await expect(scheduleSegmentCommand("", command, "segment-1", malformedFetcher)).rejects.toMatchObject({ kind: "uncertain" });

    const offlineFetcher = async () => { throw new TypeError("offline"); };
    await expect(scheduleSegmentCommand("", command, "segment-1", offlineFetcher)).rejects.toMatchObject({ kind: "uncertain" });
  });
});
