import { useEffect, useRef, useState } from "react";
import { loadGameConfiguration } from "../lib/game-configuration";
import { prepareGame, startPreparedGame } from "../lib/prepare-game";
import { OperatorControlError } from "../lib/operator-controls";
import { useWorldStore } from "../state/world-store";
import type { GameConfiguration, GameStatus, PreparationResponse } from "../types/contracts";

/** Consulta solo al abrir; el padre remonta este panel al cambiar la identidad. */
export function GameConfigurationDetails({ baseUrl, gameId, roundId, graphVersion, status, onUnauthorized }: {
  baseUrl: string;
  gameId: string;
  roundId: 1 | 2 | 3;
  graphVersion: string;
  status: GameStatus;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ data: GameConfiguration | null; error: string | null }>({ data: null, error: null });
  const [confirmation, setConfirmation] = useState<{ prepared: PreparationResponse; sourceVersion: number; sourceTurn: number } | null>(null);
  const [phase, setPhase] = useState<"preparing" | "starting" | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const pendingControl = useWorldStore(state => state.pendingControl);
  useEffect(() => () => { actionController.current?.abort(); }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    loadGameConfiguration(baseUrl, { gameId, roundId, graphVersion }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult({ data, error: null }); })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ data: null, error: "No se pudo consultar la configuración guardada de esta partida." });
      });
    return () => controller.abort();
  }, [baseUrl, gameId, roundId, graphVersion, open, attempt]);
  const data = result.data;
  const canReplace = status === "paused" || status === "completed";
  function sourceSnapshot() {
    const current = useWorldStore.getState().currentSnapshot;
    if (!current || current.gameId !== gameId || current.roundId !== roundId || current.graphVersion !== graphVersion ||
        !["paused", "completed"].includes(current.status)) {
      throw new Error("La partida cambió o está en curso. Revisa su estado antes de sustituirla.");
    }
    return current;
  }
  async function perform(nextPhase: "preparing" | "starting", action: (signal: AbortSignal) => Promise<void>) {
    const store = useWorldStore.getState();
    if (store.pendingControl) return;
    const controller = new AbortController();
    actionController.current = controller;
    store.setPendingControl("reiniciar");
    store.setLastError(null);
    setPhase(nextPhase);
    try { await action(controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) {
        setConfirmation(null);
        const failure = error instanceof OperatorControlError ? error : null;
        store.setLastError([error instanceof Error ? error.message : "No se pudo preparar el reemplazo",
          failure?.details.code, failure?.details.requestId].filter(Boolean).join(" · "));
        if (failure?.details.status === 401) onUnauthorized();
      }
    } finally {
      if (actionController.current === controller) {
        actionController.current = null;
        store.setPendingControl(null);
        if (!controller.signal.aborted) setPhase(null);
      }
    }
  }
  async function prepareReplacement(reuseSavedConfig: boolean) {
    if (!data) return;
    await perform("preparing", async signal => {
      const source = sourceSnapshot();
      const prepared = await prepareGame(baseUrl, { gameId: `game-${crypto.randomUUID()}`, roundId,
        seed: reuseSavedConfig ? data.random.seed : crypto.randomUUID(), graphVersion,
        restart: { sourceGameId: gameId, sourceConfigurationRevision: data.configurationIdentity.revision, reuseSavedConfig },
      }, signal);
      const latest = sourceSnapshot();
      if (latest.worldVersion !== source.worldVersion || latest.turnId !== source.turnId) {
        throw new Error("La partida cambió durante la preparación. Revisa el estado y prepara de nuevo.");
      }
      if (!signal.aborted) setConfirmation({ prepared, sourceVersion: source.worldVersion, sourceTurn: source.turnId });
    });
  }
  async function confirmReplacement() {
    if (!confirmation) return;
    await perform("starting", async signal => {
      const current = sourceSnapshot();
      if (current.worldVersion !== confirmation.sourceVersion || current.turnId !== confirmation.sourceTurn) {
        throw new Error("La partida cambió desde la confirmación. Prepara el reemplazo de nuevo.");
      }
      await startPreparedGame(baseUrl, confirmation.prepared, signal);
      if (!signal.aborted) setConfirmation(null);
    });
  }
  return (
    <details className="rounded border border-white/10 bg-night-700/50 p-2"
      onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold text-slate-200">Configuración guardada de la partida</summary>
      <div className="mt-3 flex flex-col gap-2 text-slate-300">
        {data ? <>
          <p>{data.round.survivorCount} sobrevivientes · {data.round.turnCount} turnos · {data.round.durationMs / 60000} minutos</p>
          <label className="flex flex-col gap-1">
            <span>Semilla guardada</span>
            <input readOnly value={data.random.seed} className="w-full rounded border border-white/10 bg-night-900 px-2 py-1" />
          </label>
          <p>Versión del grafo y la ronda:</p>
          <code className="break-all text-[10px]">{data.configurationIdentity.revision}</code>
          <p className="text-slate-400">Esta versión identifica el grafo y la ronda. La semilla se conserva por separado.</p>
          {data.configurationIdentity.provenance === "derived-from-legacy-checkpoint" && (
            <p className="text-accent-amber">Checkpoint anterior sin versión guardada: esta huella se calculó al recuperar; no verifica el grafo original.</p>
          )}
          <div className="flex flex-col gap-2 border-t border-white/10 pt-2">
            <p>Reiniciar usa el preset vigente y una semilla nueva. Repetir usa la ronda guardada y su semilla, desde las posiciones iniciales; no reproduce órdenes manuales.</p>
            {!canReplace && <p className="text-slate-400">Pausa la partida para preparar otra.</p>}
            <button type="button" disabled={!canReplace || pendingControl !== null}
              className="rounded border border-white/20 px-2 py-1 disabled:opacity-40" onClick={() => void prepareReplacement(false)}>
              Reiniciar con preset vigente
            </button>
            <button type="button" disabled={!canReplace || pendingControl !== null}
              className="rounded border border-white/20 px-2 py-1 disabled:opacity-40" onClick={() => void prepareReplacement(true)}>
              Repetir ronda guardada
            </button>
            {phase === "preparing" && <p role="status">Validando reemplazo…</p>}
            {confirmation && (
              <div className="flex flex-col gap-2 rounded border border-accent-amber/40 p-2">
                <p className="font-semibold">Confirmar {confirmation.prepared.restart?.reuseSavedConfig ? "repetición" : "reinicio"}</p>
                <p>Ronda {confirmation.prepared.roundId} · {confirmation.prepared.round.survivorCount} sobrevivientes · turno inicial 1</p>
                <p>Semilla: <span className="whitespace-pre-wrap break-all">{confirmation.prepared.seed}</span></p>
                <p>La partida actual será sustituida y no podrás reanudarla desde este panel.</p>
                <button type="button" disabled={!canReplace || pendingControl !== null}
                  className="rounded bg-accent-amber px-2 py-1 font-semibold text-night-900 disabled:opacity-40" onClick={() => void confirmReplacement()}>
                  {phase === "starting" ? "Iniciando…" : "Confirmar y crear otra partida"}
                </button>
                <button type="button" disabled={pendingControl !== null} className="self-start underline" onClick={() => setConfirmation(null)}>Cancelar</button>
              </div>
            )}
          </div>
        </> : <p role={result.error ? "alert" : "status"}>{result.error ?? "Consultando configuración guardada…"}</p>}
        {result.error && <button type="button" className="self-start underline" onClick={() => setAttempt(value => value + 1)}>Consultar de nuevo</button>}
      </div>
    </details>
  );
}
