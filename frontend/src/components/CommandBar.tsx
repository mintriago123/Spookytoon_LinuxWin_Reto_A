import { useWorldStore } from "../state/world-store";
import { GAME_LABELS, ROUND_TURNS } from "../lib/command-center";
import type { OperatorControls } from "../hooks/useOperatorControls";
import { ConnectionStatus } from "./ConnectionStatus";

export function CommandBar({ operator, panelOpen, onTogglePanel }: {
  operator: OperatorControls; panelOpen: boolean; onTogglePanel: () => void;
}) {
  const snapshot = useWorldStore(s => s.currentSnapshot);
  const gameStatus = snapshot?.status ?? "idle";
  return (
    <header className="command-bar">
      <div className="command-brand">
        <span className="brand-radar" aria-hidden>◉</span>
        <div><h1>Escape de Manta Zombie</h1><span className="command-subtitle">Centro de mando · SpookyThon 2026</span></div>
      </div>
      <div className="round-status" aria-label="Estado de partida">
        <span>Ronda <b>{snapshot?.roundId ?? "—"}</b></span>
        <span>Turno <b className="tabular-nums">{snapshot?.turnId ?? 0}/{ROUND_TURNS}</b></span>
        <span className={`game-state game-state-${gameStatus}`}>{GAME_LABELS[gameStatus]}</span>
      </div>
      <div className="command-actions">
        <ConnectionStatus />
        {operator.authState === "in" && (gameStatus === "running" || gameStatus === "paused") && (
          <button type="button" className={`command-button ${gameStatus === "running" ? "button-amber" : "button-green"}`}
            disabled={operator.busy} onClick={gameStatus === "running" ? operator.pausar : operator.reanudar}>
            {operator.busy ? "Procesando…" : gameStatus === "running" ? "Pausar" : "Reanudar"}
          </button>
        )}
        <button type="button" className="command-button" aria-controls="context-panel" aria-expanded={panelOpen} onClick={onTogglePanel}>
          {panelOpen ? "Ocultar panel" : "Abrir panel"}
        </button>
      </div>
    </header>
  );
}
