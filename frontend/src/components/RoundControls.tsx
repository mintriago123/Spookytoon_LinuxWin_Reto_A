import { useState } from "react";
import { useWorldStore } from "../state/world-store";
import type { OperatorControls } from "../hooks/useOperatorControls";
import type { SegmentOption } from "../hooks/useSegments";

/** Same controller as the command bar; closures always use the existing operator endpoint. */
export function RoundControls({ operator, segments }: { operator: OperatorControls; segments: SegmentOption[] }) {
  const snapshot = useWorldStore(s => s.currentSnapshot);
  const selection = useWorldStore(s => s.selection);
  const selectEntity = useWorldStore(s => s.selectEntity);
  const [reason, setReason] = useState("");
  const selected = selection?.kind === "segment" ? segments.find(s => s.segmentoId === selection.id) : undefined;
  const closed = snapshot?.blockedEdges.find(s => s.segmentoId === selected?.segmentoId && s.desbloqueadaEnTurno === null);
  const started = snapshot?.status === "running" || snapshot?.status === "paused";
  const waiting = useWorldStore(s => s.receipts.some(r => r.segmentoId === selected?.segmentoId &&
    (r.phase === "sending" || (r.phase === "scheduled" && (snapshot?.turnId ?? 0) < (r.effectiveTurnId ?? Infinity)))));

  if (operator.authState === "checking") return <p>Verificando sesión de operador…</p>;
  if (operator.authState === "out") return <form className="operator-form" onSubmit={e => { e.preventDefault(); void operator.login(); }}>
    <h3>Acceso de operador</h3>
    <p>Accede para iniciar una ronda o gestionar los cierres.</p>
    <label>Contraseña de demostración<input type="password" value={operator.password} readOnly autoComplete="off" /></label>
    <button type="submit" className="command-button button-green" disabled={operator.loggingIn}>{operator.loggingIn ? "Accediendo…" : "Acceder"}</button>
  </form>;

  return <div className="operator-form">
    <h3>Operación</h3>
    {!started ? <>
      <label>Ronda<select aria-label="Ronda" value={operator.roundId} disabled={operator.busy} onChange={e => operator.setRoundId(Number(e.target.value) as 1 | 2 | 3)}>
        <option value={1}>1 · Anochecer</option><option value={2}>2 · Medianoche</option><option value={3}>3 · Apocalipsis</option>
      </select></label>
      <button type="button" className="command-button button-green" disabled={operator.busy} onClick={operator.iniciar}>
        {operator.busy ? "Iniciando…" : snapshot?.status === "completed" ? "Iniciar nueva partida" : "Iniciar partida"}
      </button>
    </> : <>
      <p>Pausa y reanudación disponibles en la barra superior.</p>
      <label>Segmento a gestionar<select aria-label="Segmento a gestionar" value={selected?.segmentoId ?? ""} onChange={e => selectEntity(e.target.value ? { kind: "segment", id: e.target.value } : null)}>
        <option value="">Selecciona un segmento…</option>
        {segments.map(s => <option key={s.segmentoId} value={s.segmentoId}>{s.label}</option>)}
      </select></label>
      {selected && <>
        <p className="selection-hint">Tramo marcado en cian. {closed ? "Cerrado en el mundo." : "Sin cierre activo en el snapshot."}</p>
        <label>Motivo<input value={reason} onChange={e => setReason(e.target.value)} placeholder={closed ? "Motivo de apertura" : "Motivo de cierre"} /></label>
        <button type="button" className={`command-button ${closed ? "button-green" : "button-rose"}`} disabled={operator.busy || waiting || !reason.trim()}
          onClick={() => { void operator.bloquearSegmento(selected, !closed, reason.trim()).then(response => { if (response) setReason(""); }); }}>
          {waiting ? "Esperando estado observado" : operator.busy ? "Enviando…" : closed ? "Abrir segmento" : "Cerrar segmento"}
        </button>
        <p>Se solicita para todo el segmento, en ambos sentidos. La bandeja muestra el turno programado y el estado observado.</p>
        {snapshot.status === "paused" && <p>Se programa para el siguiente turno, al reanudar la partida.</p>}
      </>}
    </>}
    <button type="button" className="text-button" onClick={operator.logout}>Cerrar sesión de operador</button>
  </div>;
}
