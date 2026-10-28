import { useWorldStore } from "../state/world-store";
import type { SegmentOption } from "../hooks/useSegments";

const PHASE_LABELS = { sending: "Solicitud en curso", scheduled: "Programado", observed: "Estado esperado observado", error: "Error de solicitud" };

export function EventTray({ segments }: { segments: SegmentOption[] }) {
  const snapshot = useWorldStore(s => s.currentSnapshot);
  const receipts = useWorldStore(s => s.receipts);
  const selectEntity = useWorldStore(s => s.selectEntity);
  const closed = snapshot?.blockedEdges.filter(b => b.desbloqueadaEnTurno === null) ?? [];
  const observations = snapshot?.cameraObservations ?? [];
  const count = receipts.length + closed.length + observations.length;
  return <details className="event-tray">
    <summary><span>Eventos y señales <b>{count}</b></span><span className="tray-summary">{closed.length} cierres activos · {observations.length} detecciones simuladas</span></summary>
    <div className="event-tray-content">
      <p className="muted">Recibos locales de esta partida: hasta 50; se pierden al recargar. Un estado observado no identifica el comando que lo causó.</p>
      {!count && <p>Sin señales ni solicitudes locales.</p>}
      {receipts.map(r => <article key={r.eventId} className={`event-item receipt-${r.phase}`}>
        <div><b>{PHASE_LABELS[r.phase]}</b> · {r.blocked ? "Cierre" : "Apertura"} {r.effectiveTurnId !== undefined ? `· turno ${r.effectiveTurnId}` : ""}</div>
        <button type="button" className="text-button" onClick={() => selectEntity({ kind: "segment", id: r.segmentoId })}>{r.label}</button>
        <p>{r.reason}</p>
        {r.phase === "observed" && <p>Se observó el estado esperado en el turno {r.observedAtTurnId}; el snapshot no publica eventId.</p>}
        {r.phase === "scheduled" && <p>{snapshot && snapshot.turnId >= (r.effectiveTurnId ?? Infinity) ? "Aún no se observa el estado esperado en el snapshot recibido." : "Aceptado para un turno futuro; todavía no observado."}</p>}
        {r.error && <p role="alert">{r.error}</p>}
      </article>)}
      {closed.map(b => <article className="event-item" key={b.segmentoId}>
        <b>Cierre observado · turno {b.bloqueadaDesdeTurno}</b><br />
        <button type="button" className="text-button" onClick={() => selectEntity({ kind: "segment", id: b.segmentoId })}>{segments.find(s => s.segmentoId === b.segmentoId)?.label ?? b.segmentoId}</button>
        <p>{b.motivo}</p>
      </article>)}
      {observations.map(o => <article className="event-item" key={`${o.cameraId}-${o.zombieId}-${o.detectedTurnId}`}>
        <b>Detección simulada · {snapshot?.cameras.find(c => c.id === o.cameraId)?.name ?? o.cameraId}</b>
        <p>Nodo <code>{o.nodeId}</code> · zombie {o.zombieId}</p>
        <p>Detectado en turno {o.detectedTurnId}; vence al iniciar el turno {o.expiresAfterTurnId}. No es video.</p>
      </article>)}
    </div>
  </details>;
}
