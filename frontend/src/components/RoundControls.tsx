import { useState } from "react";
import { useWorldStore } from "../state/world-store";
import type {
  ApiErrorBody,
  IniciarRequest,
  IniciarResponse,
  PausarRequest,
  PausarResponse,
} from "../types/contracts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * SPEC.md §6: RoundControls es solo para operador autenticado y la API key
 * NUNCA va en el bundle. Aquí el operador la pega en memoria en tiempo de
 * ejecución (no hay .env ni build-time constant); se envía únicamente en el
 * header x-api-key de esta petición y no se persiste en storage. El
 * mecanismo final (proxy/sesión del Backend) puede sustituir este input por
 * algo más robusto sin cambiar el resto del componente.
 */
export function RoundControls() {
  const pendingControl = useWorldStore((s) => s.pendingControl);
  const setPendingControl = useWorldStore((s) => s.setPendingControl);
  const setLastError = useWorldStore((s) => s.setLastError);
  const status = useWorldStore((s) => s.currentSnapshot?.status ?? "idle");

  const [operatorKey, setOperatorKey] = useState("");
  const [gameId, setGameId] = useState("game-2026-001");
  const [roundId, setRoundId] = useState<1 | 2 | 3>(1);
  const [seed, setSeed] = useState("seed-001");

  const callControl = async <TReq, TRes>(
    path: string,
    body: TReq,
    control: NonNullable<typeof pendingControl>,
  ): Promise<TRes | null> => {
    setPendingControl(control);
    setLastError(null);
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": operatorKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(errorBody?.error.message ?? `${path} respondió ${res.status}`);
      }
      return (await res.json()) as TRes;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : `Fallo al llamar ${path}`);
      return null;
    } finally {
      setPendingControl(null);
    }
  };

  const iniciar = () =>
    callControl<IniciarRequest, IniciarResponse>(
      "/simulador/iniciar",
      { gameId, roundId, seed },
      "iniciar",
    );

  const pausar = () =>
    callControl<PausarRequest, PausarResponse>(
      "/simulador/pausar",
      { reason: "Pausa solicitada por operador" },
      "pausar",
    );

  const busy = pendingControl !== null;

  return (
    <form
      className="flex flex-col gap-3 rounded-lg bg-white/90 p-3 text-xs shadow-md dark:bg-slate-900/90 dark:text-slate-100"
      onSubmit={(e) => e.preventDefault()}
    >
      <label className="flex flex-col gap-1">
        <span>API key de operador (solo en memoria)</span>
        <input
          type="password"
          autoComplete="off"
          value={operatorKey}
          onChange={(e) => setOperatorKey(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span>gameId</span>
          <input
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Ronda</span>
          <select
            value={roundId}
            onChange={(e) => setRoundId(Number(e.target.value) as 1 | 2 | 3)}
            className="rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
          >
            <option value={1}>1 — Anochecer</option>
            <option value={2}>2 — Medianoche</option>
            <option value={3}>3 — Apocalipsis</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span>seed</span>
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={iniciar}
          disabled={busy || status === "running"}
          className="flex-1 rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
        >
          {pendingControl === "iniciar" ? "Iniciando…" : "Iniciar"}
        </button>
        <button
          type="button"
          onClick={pausar}
          disabled={busy || status !== "running"}
          className="flex-1 rounded bg-amber-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
        >
          {pendingControl === "pausar" ? "Pausando…" : "Pausar"}
        </button>
      </div>
    </form>
  );
}
