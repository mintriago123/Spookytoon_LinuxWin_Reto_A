import { useState } from "react";
import { useWorldStore } from "../state/world-store";
import type { OperatorControls } from "../hooks/useOperatorControls";
import type { SegmentOption } from "../hooks/useSegments";

/** One selection source (the explorer/map), one existing operator command. */
export function RoundControls({ operator, segments, mode = "session" }: {
  operator: OperatorControls; segments: SegmentOption[]; mode?: "session" | "segment";
}) {
  const snapshot = useWorldStore(s => s.currentSnapshot);
  const selection = useWorldStore(s => s.selection);
  const receipts = useWorldStore(s => s.receipts);
  const [reason, setReason] = useState("");
  const selected = selection?.kind === "segment" ? segments.find(s => s.segmentoId === selection.id) : undefined;
  const closed = snapshot?.blockedEdges.some(s => s.segmentoId === selected?.segmentoId && s.desbloqueadaEnTurno === null) ?? false;
  const started = snapshot?.status === "running" || snapshot?.status === "paused";
  const latest = receipts.find(r => r.segmentoId === selected?.segmentoId);
  const waiting = receipts.some(r => r.segmentoId === selected?.segmentoId &&
    (r.phase === "sending" || (r.phase === "scheduled" && (snapshot?.turnId ?? 0) < (r.effectiveTurnId ?? Infinity))));

  if (mode === "session") {
    if (operator.authState === "checking") return <p className="sidebar-session">Verificando acceso de operador…</p>;
    if (!started) return <div className="simple-round-controls">
      <label htmlFor="start-round">Ronda<select id="start-round" aria-label="Ronda" value={operator.roundId} disabled={operator.busy || operator.loggingIn}
        onChange={e => operator.setRoundId(Number(e.target.value) as 1 | 2 | 3)}>
        <option value={1}>1 · Anochecer</option><option value={2}>2 · Medianoche</option><option value={3}>3 · Apocalipsis</option>
      </select></label>
      <details className="selection-technical"><summary>Opciones de partida</summary>
        <label htmlFor="round-seed">Semilla reproducible (opcional)</label>
        <input id="round-seed" value={operator.customSeed ?? ""} maxLength={256} disabled={operator.busy || operator.loggingIn}
          onChange={event => operator.setCustomSeed(event.target.value)} placeholder="Automática" />
        <p>Déjala vacía para generar un escenario nuevo.</p>
      </details>
      <button type="button" className="command-button button-green" disabled={operator.busy || operator.loggingIn} onClick={async () => {
        if (operator.authState === "in" || await operator.login()) await operator.iniciar();
      }}>{operator.startStage === "validating" ? "Validando…" : operator.busy || operator.loggingIn ? "Iniciando…" : "Iniciar ronda"}</button>
    </div>;
    if (operator.authState === "out") return <div className="sidebar-session">
      <span>Modo consulta</span>
      <button type="button" className="command-button button-green" disabled={operator.loggingIn} onClick={operator.login}>
        {operator.loggingIn ? "Accediendo…" : "Acceder"}
      </button>
    </div>;
    return <div className="sidebar-session"><span className="session-active">● Controles habilitados</span><button type="button" className="text-button" onClick={operator.logout}>Salir</button></div>;
  }

  if (!selected) return null;
  if (!started) return <p className="segment-action-hint">{snapshot?.status === "completed" ? "La partida finalizó." : "No hay partida iniciada."} Inicia una partida para gestionar esta calle.</p>;
  if (operator.authState !== "in") return <p className="segment-action-hint">Accede como operador desde la parte superior del panel para cerrar o abrir esta calle.</p>;

  return <form className="segment-actions" aria-label="Gestionar calle seleccionada" onSubmit={event => {
    event.preventDefault();
    if (operator.busy || waiting || !reason.trim()) return;
    void operator.bloquearSegmento(selected, !closed, reason.trim()).then(response => { if (response) setReason(""); });
  }}>
    <label htmlFor="segment-reason">{closed ? "Motivo de apertura" : "Motivo de cierre"}</label>
    <div className="segment-action-row">
      <input id="segment-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Escribe el motivo" disabled={waiting || operator.busy} />
      <button type="submit" className={`command-button ${closed ? "button-green" : "button-rose"}`} disabled={operator.busy || waiting || !reason.trim()}>
        {waiting ? "Programado" : operator.busy ? "Enviando…" : closed ? "Abrir calle" : "Cerrar calle"}
      </button>
    </div>
    {latest?.phase === "scheduled" ? <p className="segment-feedback" role="status">
      {latest.blocked ? "Cierre programado" : "Apertura programada"} para el turno {latest.effectiveTurnId}.
      {snapshot.status === "paused" ? " Reanuda la partida para aplicarlo." : " Esperando el estado del mundo."}
    </p> : latest?.phase === "observed" ? <p className="segment-feedback observed" role="status">Estado esperado observado en el turno {latest.observedAtTurnId}.</p>
      : latest?.phase === "error" ? <p className="segment-feedback error" role="alert">{latest.error}</p>
        : <p className="segment-action-hint">Afecta al segmento completo. {snapshot.status === "paused" ? "Se aplicará en el siguiente turno al reanudar." : "Se programa para un próximo turno."}</p>}
  </form>;
}
